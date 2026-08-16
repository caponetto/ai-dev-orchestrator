import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { safeJsonParse } from '@ai-orchestrator/artifacts';
import type { AgentSessionStore } from '@ai-orchestrator/ports';
import type { AgentSessionSnapshot } from '@ai-orchestrator/schemas';
import { agentSessionSnapshotSchema } from '@ai-orchestrator/schemas';

/**
 * File-backed session store. Persists each session snapshot under:
 *   <baseDir>/<runId>/sessions/<sessionId>.json
 *
 * Uses atomic write semantics (write to .tmp then rename) matching
 * the existing persistence style.
 */
export class DefaultAgentSessionStore implements AgentSessionStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async saveSnapshot(snapshot: AgentSessionSnapshot): Promise<void> {
    const dir = this.sessionsDir(snapshot.ref.runId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${snapshot.ref.sessionId}.json`);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(snapshot, null, 2));
    await rename(tmpPath, filePath);
  }

  async loadSnapshot(sessionId: string, runId: string): Promise<AgentSessionSnapshot | null> {
    const filePath = join(this.sessionsDir(runId), `${sessionId}.json`);
    try {
      const content = await readFile(filePath, 'utf-8');
      const result = safeJsonParse(content, agentSessionSnapshotSchema);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  async listByRun(runId: string): Promise<readonly AgentSessionSnapshot[]> {
    const dir = this.sessionsDir(runId);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }

    const snapshots: AgentSessionSnapshot[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }
      try {
        const content = await readFile(join(dir, file), 'utf-8');
        const result = safeJsonParse(content, agentSessionSnapshotSchema);
        if (result.success) {
          snapshots.push(result.data);
        }
      } catch {
        // skip unreadable files
      }
    }
    return snapshots;
  }

  async listAll(): Promise<readonly AgentSessionSnapshot[]> {
    let runDirs: string[];
    try {
      runDirs = await readdir(this.baseDir);
    } catch {
      return [];
    }

    const all: AgentSessionSnapshot[] = [];
    for (const runDir of runDirs) {
      const snapshots = await this.listByRun(runDir);
      all.push(...snapshots);
    }
    return all;
  }

  async removeSnapshot(sessionId: string, runId: string): Promise<boolean> {
    const filePath = join(this.sessionsDir(runId), `${sessionId}.json`);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private sessionsDir(runId: string): string {
    return join(this.baseDir, runId, 'sessions');
  }
}
