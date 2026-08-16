import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

import { safeJsonParse } from '@ai-orchestrator/artifacts';
import type { AgentStreamEvent, HistoryCapableStreamBus } from '@ai-orchestrator/ports';
import { z } from 'zod';

export const agentStreamEventSchema = z.object({
  runId: z.string(),
  stateId: z.string(),
  roleId: z.string(),
  dispatchId: z.string(),
  timestamp: z.string(),
  type: z.enum(['stdout', 'stderr', 'status', 'permission_request', 'clarification_request']),
  content: z.string(),
  structuredData: z.record(z.string(), z.unknown()).optional(),
  requestMessageId: z.string().optional(),
});

const STREAM_FILENAME = 'agent-stream.jsonl';
const POLL_INTERVAL_MS = 500;

export interface ChangedFileInfo {
  streamFile: string;
  offset: number;
  size: number;
}

export function discoverChangedFiles(
  runsDir: string,
  fileOffsets: ReadonlyMap<string, number>,
): ChangedFileInfo[] {
  let entries: string[];
  try {
    entries = readdirSync(runsDir);
  } catch {
    return [];
  }

  const results: ChangedFileInfo[] = [];
  for (const entry of entries) {
    const streamFile = join(runsDir, entry, STREAM_FILENAME);
    let size: number;
    try {
      size = statSync(streamFile).size;
    } catch {
      continue;
    }
    const offset = fileOffsets.get(streamFile) ?? 0;
    if (size > offset) {
      results.push({ streamFile, offset, size });
    }
  }
  return results;
}

export function readNewEvents(
  streamFile: string,
  offset: number,
  size: number,
): AgentStreamEvent[] {
  const bytesToRead = size - offset;
  const buffer = Buffer.alloc(bytesToRead);
  let fd: number;
  try {
    fd = openSync(streamFile, 'r');
  } catch {
    return [];
  }
  try {
    readSync(fd, buffer, 0, bytesToRead, offset);
  } finally {
    closeSync(fd);
  }

  const events: AgentStreamEvent[] = [];
  const lines = buffer.toString().split('\n').filter(Boolean);
  for (const line of lines) {
    const parseResult = safeJsonParse(line, agentStreamEventSchema);
    if (parseResult.success) {
      events.push(parseResult.data);
    }
  }
  return events;
}

export function dispatchToClients(
  events: readonly AgentStreamEvent[],
  clients: ReadonlyMap<string, (event: AgentStreamEvent) => void>,
): void {
  for (const event of events) {
    for (const [, callback] of clients) {
      try {
        callback(event);
      } catch {
        // Swallow individual client errors
      }
    }
  }
}

/**
 * File-backed agent stream bus that persists events to JSONL files in the runs
 * directory. Enables cross-process streaming: the workflow engine (publisher)
 * and the dashboard (subscriber) can be separate CLI processes sharing the
 * same runs directory on disk.
 */
export class FileBackedAgentStreamBus implements HistoryCapableStreamBus {
  private readonly runsDir: string;
  private readonly clients = new Map<string, (event: AgentStreamEvent) => void>();
  private nextId = 1;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly fileOffsets = new Map<string, number>();

  constructor(runsDir: string) {
    this.runsDir = runsDir;
  }

  publish(event: AgentStreamEvent): void {
    const dir = join(this.runsDir, event.runId);
    mkdirSync(dir, { recursive: true });
    const streamFile = join(dir, STREAM_FILENAME);
    const serialized = JSON.stringify(event) + '\n';
    appendFileSync(streamFile, serialized);

    const currentOffset = this.fileOffsets.get(streamFile) ?? 0;
    this.fileOffsets.set(streamFile, currentOffset + Buffer.byteLength(serialized));

    dispatchToClients([event], this.clients);
  }

  subscribe(callback: (event: AgentStreamEvent) => void): string {
    const clientId = `agent-stream-${String(this.nextId++)}`;
    this.clients.set(clientId, callback);
    if (this.clients.size === 1) {
      this.startPolling();
    }
    return clientId;
  }

  unsubscribe(clientId: string): void {
    this.clients.delete(clientId);
    if (this.clients.size === 0) {
      this.stopPolling();
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getRunHistory(runId: string): readonly AgentStreamEvent[] {
    const streamFile = join(this.runsDir, runId, STREAM_FILENAME);
    if (!existsSync(streamFile)) {
      return [];
    }

    try {
      return readFileSync(streamFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          const result = safeJsonParse(line, agentStreamEventSchema);
          return result.success ? [result.data] : [];
        });
    } catch {
      return [];
    }
  }

  dispose(): void {
    this.stopPolling();
    this.clients.clear();
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      this.poll();
    }, POLL_INTERVAL_MS);
    if (typeof this.pollTimer === 'object' && 'unref' in this.pollTimer) {
      this.pollTimer.unref();
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private poll(): void {
    if (this.clients.size === 0) {
      return;
    }

    const changed = discoverChangedFiles(this.runsDir, this.fileOffsets);
    for (const { streamFile, offset, size } of changed) {
      const events = readNewEvents(streamFile, offset, size);
      this.fileOffsets.set(streamFile, size);
      dispatchToClients(events, this.clients);
    }
  }
}
