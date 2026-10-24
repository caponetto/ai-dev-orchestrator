import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { safeJsonParse } from '@ai-dev-orchestrator/artifacts';
import type { LiveRequestKind } from '@ai-dev-orchestrator/schemas';
import { liveRequestKindSchema } from '@ai-dev-orchestrator/schemas';
import { sleep } from '@ai-dev-orchestrator/utils';
import { z } from 'zod';

export interface LiveRequest {
  readonly runId: string;
  readonly messageId: string;
  readonly kind: LiveRequestKind;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly payload: Record<string, unknown>;
}

export interface LiveResponse {
  readonly runId: string;
  readonly messageId: string;
  readonly respondedAt: string;
  readonly payload: Record<string, unknown>;
}

const liveRequestSchema = z.object({
  runId: z.string(),
  messageId: z.string(),
  kind: liveRequestKindSchema,
  createdAt: z.string(),
  expiresAt: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)), 'Invalid expiry')
    .optional(),
  payload: z.record(z.string(), z.unknown()),
});

const liveResponseSchema = z.object({
  runId: z.string(),
  messageId: z.string(),
  respondedAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

export interface LiveRequestStore {
  writeRequest(request: LiveRequest): Promise<void>;
  writeResponse(
    response: LiveResponse,
    options?: { readonly requireRequest?: boolean },
  ): Promise<void> | Promise<'response_written' | 'already_responded'>;
  awaitResponse(runId: string, messageId: string, timeoutMs: number): Promise<LiveResponse | null>;
  listPendingRequests(runId: string): Promise<readonly LiveRequest[]>;
  cleanupResolved(runId: string): Promise<number>;
}

const POLL_INTERVAL_MS = 500;

function responseError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function sameDecision(previous: LiveResponse, response: LiveResponse): 'already_responded' {
  if (!isDeepStrictEqual(previous.payload, response.payload)) {
    throw responseError(
      'LIVE_RESPONSE_CONFLICT',
      `Request ${response.messageId} already has a response`,
    );
  }
  return 'already_responded';
}

export class FileBackedLiveRequestStore implements LiveRequestStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async writeRequest(request: LiveRequest): Promise<void> {
    this.validateIdentifier(request.messageId);
    if (!liveRequestSchema.safeParse(request).success) {
      throw responseError('LIVE_REQUEST_INVALID', 'Live request catalog entry is invalid');
    }
    if (await this.readResolvedResponse(request.runId, request.messageId)) {
      throw responseError('LIVE_REQUEST_RETIRED', `Request ${request.messageId} is retired`);
    }
    const dir = this.requestsDir(request.runId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${request.messageId}.json`);
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    let published = false;
    try {
      await writeFile(temporary, JSON.stringify(request, null, 2), { flag: 'wx', flush: true });
      try {
        await link(temporary, filePath);
        published = true;
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
          throw error;
        }
        const previous = safeJsonParse(await readFile(filePath, 'utf8'), liveRequestSchema);
        if (
          !previous.success ||
          previous.data.runId !== request.runId ||
          previous.data.messageId !== request.messageId ||
          previous.data.kind !== request.kind ||
          !isDeepStrictEqual(previous.data.payload, request.payload)
        ) {
          throw responseError(
            'LIVE_REQUEST_CONFLICT',
            `Request ${request.messageId} already identifies a different request`,
          );
        }
      }
      if (await this.readResolvedResponse(request.runId, request.messageId)) {
        if (published) {
          await unlink(filePath).catch(() => undefined);
        }
        throw responseError('LIVE_REQUEST_RETIRED', `Request ${request.messageId} is retired`);
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async writeResponse(
    response: LiveResponse,
    options?: { readonly requireRequest?: boolean },
  ): Promise<'response_written' | 'already_responded'> {
    this.validateIdentifier(response.messageId);
    const resolved = await this.readResolvedResponse(response.runId, response.messageId);
    if (resolved) {
      return sameDecision(resolved, response);
    }
    const previous = await this.readResponse(response.runId, response.messageId);
    if (previous) {
      return sameDecision(previous, response);
    }
    try {
      await this.validateResponseRequest(response, options?.requireRequest ?? false);
    } catch (error: unknown) {
      const retired = await this.readResolvedResponse(response.runId, response.messageId);
      if (retired) {
        return sameDecision(retired, response);
      }
      throw error;
    }
    const dir = this.responsesDir(response.runId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${response.messageId}.json`);
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(response, null, 2), { flag: 'wx', flush: true });
      try {
        // Linking a complete file publishes it atomically without replacing an earlier answer.
        await link(temporary, filePath);
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
          throw error;
        }
        const previous =
          (await this.readResolvedResponse(response.runId, response.messageId)) ??
          (await this.readResponse(response.runId, response.messageId));
        if (!previous) {
          throw responseError(
            'LIVE_RESPONSE_CONFLICT',
            `Request ${response.messageId} already has a response`,
          );
        }
        return sameDecision(previous, response);
      }
      const retired = await this.readResolvedResponse(response.runId, response.messageId);
      if (retired) {
        await unlink(filePath).catch(() => undefined);
        return sameDecision(retired, response);
      }
      return 'response_written';
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async awaitResponse(
    runId: string,
    messageId: string,
    timeoutMs: number,
  ): Promise<LiveResponse | null> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await this.readResponse(runId, messageId);
      if (response) {
        return response;
      }
      await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
    }
    return this.readResponse(runId, messageId);
  }

  async listPendingRequests(runId: string): Promise<readonly LiveRequest[]> {
    const reqDir = this.requestsDir(runId);
    const respDir = this.responsesDir(runId);

    let requestFiles: string[];
    try {
      requestFiles = await readdir(reqDir);
    } catch {
      return [];
    }

    let responseFiles: Set<string>;
    try {
      responseFiles = new Set(await readdir(respDir));
    } catch {
      responseFiles = new Set();
    }

    const now = Date.now();
    const pending: LiveRequest[] = [];
    for (const file of requestFiles) {
      if (!file.endsWith('.json')) {
        continue;
      }
      if (responseFiles.has(file) && (await this.readResponse(runId, file.slice(0, -5)))) {
        continue;
      }
      try {
        if (await this.readResolvedResponse(runId, file.slice(0, -5))) {
          continue;
        }
        const content = await readFile(join(reqDir, file), 'utf-8');
        const parsed = safeJsonParse(content, liveRequestSchema);
        if (!parsed.success) {
          continue;
        }
        const request = parsed.data as LiveRequest;
        if (request.runId !== runId || file !== `${request.messageId}.json`) {
          continue;
        }
        if (request.expiresAt && Date.parse(request.expiresAt) <= now) {
          continue;
        }
        pending.push(request);
      } catch {
        // skip unreadable files
      }
    }

    return pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async cleanupResolved(runId: string): Promise<number> {
    const reqDir = this.requestsDir(runId);
    const respDir = this.responsesDir(runId);

    let requestFiles: string[];
    try {
      requestFiles = await readdir(reqDir);
    } catch {
      return 0;
    }

    let responseFiles: Set<string>;
    try {
      responseFiles = new Set(await readdir(respDir));
    } catch {
      return 0;
    }

    let cleaned = 0;
    for (const file of requestFiles) {
      if (!file.endsWith('.json')) {
        continue;
      }
      if (!responseFiles.has(file)) {
        continue;
      }
      if (!(await this.readResponse(runId, file.slice(0, -5)))) {
        continue;
      }
      try {
        const resolvedDir = this.resolvedDir(runId);
        await mkdir(resolvedDir, { recursive: true });
        try {
          await link(join(respDir, file), join(resolvedDir, file));
        } catch (error: unknown) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
            throw error;
          }
          const retired = await this.readResolvedResponse(runId, file.slice(0, -5));
          const active = await this.readResponse(runId, file.slice(0, -5));
          if (!retired || !active) {
            continue;
          }
          sameDecision(retired, active);
        }
        await unlink(join(reqDir, file));
        await unlink(join(respDir, file));
        cleaned++;
      } catch {
        // skip files that can't be removed
      }
    }

    // Finish a cleanup interrupted after request removal, without deleting early responses.
    for (const file of responseFiles) {
      if (!file.endsWith('.json') || requestFiles.includes(file)) {
        continue;
      }
      try {
        if (await this.readResolvedResponse(runId, file.slice(0, -5))) {
          await unlink(join(respDir, file));
        }
      } catch {
        // Preserve unreadable receipts and retry storage cleanup later.
      }
    }
    return cleaned;
  }

  private async readResponse(runId: string, messageId: string): Promise<LiveResponse | null> {
    try {
      this.validateIdentifier(messageId);
      const content = await readFile(join(this.responsesDir(runId), `${messageId}.json`), 'utf8');
      const parsed = safeJsonParse(content, liveResponseSchema);
      return parsed.success && parsed.data.runId === runId && parsed.data.messageId === messageId
        ? parsed.data
        : null;
    } catch {
      return null;
    }
  }

  private async readResolvedResponse(
    runId: string,
    messageId: string,
  ): Promise<LiveResponse | null> {
    let content: string;
    try {
      content = await readFile(join(this.resolvedDir(runId), `${messageId}.json`), 'utf8');
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    const parsed = safeJsonParse(content, liveResponseSchema);
    if (!parsed.success || parsed.data.runId !== runId || parsed.data.messageId !== messageId) {
      throw responseError('LIVE_RESPONSE_CORRUPT', `Resolved receipt ${messageId} is invalid`);
    }
    return parsed.data;
  }

  private async validateResponseRequest(
    response: LiveResponse,
    requireRequest: boolean,
  ): Promise<void> {
    let content: string;
    try {
      content = await readFile(
        join(this.requestsDir(response.runId), `${response.messageId}.json`),
        'utf8',
      );
    } catch (error: unknown) {
      // A streamed request can be answered before its catalog entry is published.
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        if (requireRequest) {
          throw responseError('LIVE_REQUEST_NOT_FOUND', `Request ${response.messageId} not found`);
        }
        return;
      }
      throw error;
    }
    const parsed = safeJsonParse(content, liveRequestSchema);
    if (
      !parsed.success ||
      parsed.data.runId !== response.runId ||
      parsed.data.messageId !== response.messageId
    ) {
      throw responseError('LIVE_REQUEST_INVALID', 'Live response request identity is invalid');
    }
    if (
      !requireRequest &&
      (response.payload['timedOut'] === true || response.payload['aborted'] === true)
    ) {
      return;
    }
    if (parsed.data.expiresAt && Date.parse(parsed.data.expiresAt) <= Date.now()) {
      throw responseError('LIVE_REQUEST_EXPIRED', `Request ${response.messageId} has expired`);
    }
    const valid =
      parsed.data.kind === 'permission'
        ? typeof response.payload['granted'] === 'boolean' &&
          response.payload['answer'] === undefined
        : typeof response.payload['answer'] === 'string' &&
          response.payload['granted'] === undefined;
    if (!valid) {
      throw responseError(
        'LIVE_RESPONSE_KIND_MISMATCH',
        `Request ${response.messageId} response kind does not match`,
      );
    }
  }

  private requestsDir(runId: string): string {
    this.validateIdentifier(runId);
    return join(this.baseDir, runId, 'live-requests');
  }

  private resolvedDir(runId: string): string {
    this.validateIdentifier(runId);
    return join(this.baseDir, runId, 'live-resolved');
  }

  private responsesDir(runId: string): string {
    this.validateIdentifier(runId);
    return join(this.baseDir, runId, 'live-responses');
  }

  private validateIdentifier(value: string): void {
    if (!value || value === '.' || value === '..' || /[/\\]/.test(value)) {
      throw responseError(
        'LIVE_REQUEST_INVALID',
        'Live request identifier must be a non-empty path segment',
      );
    }
  }
}
