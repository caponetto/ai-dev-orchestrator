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
  expiresAt: z.string().optional(),
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
  writeResponse(response: LiveResponse): Promise<void>;
  awaitResponse(runId: string, messageId: string, timeoutMs: number): Promise<LiveResponse | null>;
  listPendingRequests(runId: string): Promise<readonly LiveRequest[]>;
  cleanupResolved(runId: string): Promise<number>;
}

const POLL_INTERVAL_MS = 500;

export class FileBackedLiveRequestStore implements LiveRequestStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async writeRequest(request: LiveRequest): Promise<void> {
    this.validateIdentifier(request.messageId);
    const dir = this.requestsDir(request.runId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${request.messageId}.json`);
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(request, null, 2), { flag: 'wx', flush: true });
      try {
        await link(temporary, filePath);
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
          throw new Error(`Request ${request.messageId} already identifies a different request`);
        }
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async writeResponse(response: LiveResponse): Promise<void> {
    this.validateIdentifier(response.messageId);
    const previous = await this.readResponse(response.runId, response.messageId);
    if (previous) {
      if (!isDeepStrictEqual(previous.payload, response.payload)) {
        throw new Error(`Request ${response.messageId} already has a response`);
      }
      return;
    }
    await this.validateResponseRequest(response);
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
        const previous = await this.readResponse(response.runId, response.messageId);
        if (!previous || !isDeepStrictEqual(previous.payload, response.payload)) {
          throw new Error(`Request ${response.messageId} already has a response`);
        }
      }
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

    const now = new Date().toISOString();
    const pending: LiveRequest[] = [];
    for (const file of requestFiles) {
      if (!file.endsWith('.json')) {
        continue;
      }
      if (responseFiles.has(file) && (await this.readResponse(runId, file.slice(0, -5)))) {
        continue;
      }
      try {
        const content = await readFile(join(reqDir, file), 'utf-8');
        const parsed = safeJsonParse(content, liveRequestSchema);
        if (!parsed.success) {
          continue;
        }
        const request = parsed.data as LiveRequest;
        if (request.runId !== runId || file !== `${request.messageId}.json`) {
          continue;
        }
        if (request.expiresAt && request.expiresAt < now) {
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
        await unlink(join(reqDir, file));
        await unlink(join(respDir, file));
        cleaned++;
      } catch {
        // skip files that can't be removed
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

  private async validateResponseRequest(response: LiveResponse): Promise<void> {
    let content: string;
    try {
      content = await readFile(
        join(this.requestsDir(response.runId), `${response.messageId}.json`),
        'utf8',
      );
    } catch (error: unknown) {
      // A streamed request can be answered before its catalog entry is published.
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
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
      throw new Error('Live response request identity is invalid');
    }
    if (response.payload['timedOut'] === true || response.payload['aborted'] === true) {
      return;
    }
    if (parsed.data.expiresAt && Date.parse(parsed.data.expiresAt) <= Date.now()) {
      throw new Error(`Request ${response.messageId} has expired`);
    }
    const valid =
      parsed.data.kind === 'permission'
        ? typeof response.payload['granted'] === 'boolean' &&
          response.payload['answer'] === undefined
        : typeof response.payload['answer'] === 'string' &&
          response.payload['granted'] === undefined;
    if (!valid) {
      throw new Error(`Request ${response.messageId} response kind does not match`);
    }
  }

  private requestsDir(runId: string): string {
    this.validateIdentifier(runId);
    return join(this.baseDir, runId, 'live-requests');
  }

  private responsesDir(runId: string): string {
    this.validateIdentifier(runId);
    return join(this.baseDir, runId, 'live-responses');
  }

  private validateIdentifier(value: string): void {
    if (!value || value === '.' || value === '..' || /[/\\]/.test(value)) {
      throw new Error('Live request identifier must be a non-empty path segment');
    }
  }
}
