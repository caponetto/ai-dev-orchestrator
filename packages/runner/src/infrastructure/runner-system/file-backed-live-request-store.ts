import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

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
    const dir = this.requestsDir(request.runId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${request.messageId}.json`);
    await writeFile(filePath, JSON.stringify(request, null, 2));
  }

  async writeResponse(response: LiveResponse): Promise<void> {
    const dir = this.responsesDir(response.runId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${response.messageId}.json`);
    await writeFile(filePath, JSON.stringify(response, null, 2));
  }

  async awaitResponse(
    runId: string,
    messageId: string,
    timeoutMs: number,
  ): Promise<LiveResponse | null> {
    const filePath = join(this.responsesDir(runId), `${messageId}.json`);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const result = safeJsonParse(content, liveResponseSchema);
        if (result.success) {
          return result.data;
        }
      } catch {
        // file doesn't exist yet
      }
      await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
    }
    return null;
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
      if (responseFiles.has(file)) {
        continue;
      }
      try {
        const content = await readFile(join(reqDir, file), 'utf-8');
        const parsed = safeJsonParse(content, liveRequestSchema);
        if (!parsed.success) {
          continue;
        }
        const request = parsed.data as LiveRequest;
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

  private requestsDir(runId: string): string {
    return join(this.baseDir, runId, 'live-requests');
  }

  private responsesDir(runId: string): string {
    return join(this.baseDir, runId, 'live-responses');
  }
}
