import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { RuntimeDirectoryManager } from '@ai-orchestrator/ports';
import { RUN_LOCK_FILENAME } from '@ai-orchestrator/schemas';
import {
  STATE_FILENAME,
  type DiscoveredRunStatus,
  type RunDirectoryInfo,
} from '@ai-orchestrator/schemas';
import { getErrorMessage } from '@ai-orchestrator/utils';

import {
  RuntimeDirectoryError,
  RunDirectoryNotWritableError,
} from '../../domain/repository-model/errors';

const RUN_DIR_PATTERN = /^\d{8}-/;
const RUN_SUBDIRS = ['artifacts'] as const;

/**
 * Manages run directories on the local filesystem under the global `~/.ai/runs/` directory.
 */
export class FilesystemRuntimeDirectoryManager implements RuntimeDirectoryManager {
  constructor(private readonly runsDir: string) {}

  getRunDirectory(runId: string): string {
    const runDir = join(this.runsDir, runId);

    try {
      mkdirSync(runDir, { recursive: true });
      for (const sub of RUN_SUBDIRS) {
        mkdirSync(join(runDir, sub), { recursive: true });
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (message.includes('EACCES') || message.includes('permission')) {
        throw new RunDirectoryNotWritableError(runDir);
      }
      throw new RuntimeDirectoryError(runDir, message);
    }

    return runDir;
  }

  listRuns(): RunDirectoryInfo[] {
    if (!existsSync(this.runsDir)) {
      return [];
    }

    const entries = readdirSync(this.runsDir, { withFileTypes: true });
    const runs: RunDirectoryInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !RUN_DIR_PATTERN.test(entry.name)) {
        continue;
      }

      const runPath = join(this.runsDir, entry.name);
      const stat = statSync(runPath);
      const status = this.detectRunStatus(runPath);

      runs.push({
        runId: entry.name,
        path: runPath,
        createdAt: stat.birthtime.toISOString(),
        sizeBytes: this.getDirectorySize(runPath),
        status,
      });
    }

    return runs.sort((a, b) => a.runId.localeCompare(b.runId));
  }

  removeRun(runId: string): void {
    const runDir = join(this.runsDir, runId);
    if (!existsSync(runDir)) {
      return;
    }

    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      throw new RuntimeDirectoryError(runDir, message);
    }
  }

  getRuntimeRoot(): string {
    return this.runsDir;
  }

  private detectRunStatus(runDir: string): DiscoveredRunStatus {
    if (existsSync(join(runDir, RUN_LOCK_FILENAME))) {
      return 'active';
    }
    if (existsSync(join(runDir, STATE_FILENAME))) {
      return 'completed';
    }
    return 'aborted';
  }

  private getDirectorySize(dirPath: string): number {
    let totalSize = 0;

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isFile()) {
          totalSize += statSync(fullPath).size;
        } else if (entry.isDirectory()) {
          totalSize += this.getDirectorySize(fullPath);
        }
      }
    } catch {
      // If we can't read the directory, return what we have so far
    }

    return totalSize;
  }
}
