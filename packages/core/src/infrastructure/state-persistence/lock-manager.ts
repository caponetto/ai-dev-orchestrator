import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

import { RUN_LOCK_FILENAME, lockHandleSchema } from '@ai-orchestrator/schemas';
import type { LockHandle, RunId } from '@ai-orchestrator/schemas';
import { parse, stringify } from 'yaml';

import { LockAcquisitionError, RunAlreadyActiveError } from '../../domain/state-persistence/errors';

export class LockManager {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  acquire(runId: RunId): LockHandle {
    const lockPath = this.lockPath(runId);

    const handle: LockHandle = {
      runId,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      lockPath,
      hostname: hostname(),
    };

    mkdirSync(dirname(lockPath), { recursive: true });
    const data = stringify(handle);

    try {
      writeFileSync(lockPath, data, { encoding: 'utf8', flag: 'wx' });
      return handle;
    } catch (err: unknown) {
      if (!(err instanceof Error) || !err.message.includes('EEXIST')) {
        const message = err instanceof Error ? err.message : String(err);
        throw new LockAcquisitionError(runId, message);
      }
    }

    const existing = this.readLock(lockPath);
    if (!existing) {
      if (!existsSync(lockPath)) {
        try {
          writeFileSync(lockPath, data, { encoding: 'utf8', flag: 'wx' });
          return handle;
        } catch (retryErr: unknown) {
          this.throwContestationError(retryErr, runId, lockPath);
        }
      }
      throw new LockAcquisitionError(runId, 'Lock file exists but is unreadable');
    }

    if (existing.hostname !== hostname()) {
      throw new RunAlreadyActiveError(runId, existing.pid);
    }

    if (this.isProcessAlive(existing.pid)) {
      throw new RunAlreadyActiveError(runId, existing.pid);
    }

    this.removeStaleLock(lockPath);
    try {
      writeFileSync(lockPath, data, { encoding: 'utf8', flag: 'wx' });
    } catch (retryErr: unknown) {
      this.throwContestationError(retryErr, runId, lockPath);
    }

    return handle;
  }

  release(handle: LockHandle): void {
    if (existsSync(handle.lockPath)) {
      unlinkSync(handle.lockPath);
    }
  }

  probe(runId: RunId): {
    exists: boolean;
    pid: number;
    pidRunning: boolean;
    hostname: string;
    unreadable: boolean;
  } {
    const lockPath = this.lockPath(runId);
    const existing = this.readLock(lockPath);
    if (!existing) {
      if (existsSync(lockPath)) {
        return { exists: true, pid: 0, pidRunning: false, hostname: '', unreadable: true };
      }
      return { exists: false, pid: 0, pidRunning: false, hostname: '', unreadable: false };
    }
    const sameHost = existing.hostname === hostname();
    const pidRunning = sameHost && this.isProcessAlive(existing.pid);
    return {
      exists: true,
      pid: existing.pid,
      pidRunning,
      hostname: existing.hostname,
      unreadable: false,
    };
  }

  private lockPath(runId: RunId): string {
    return join(this.baseDir, runId, RUN_LOCK_FILENAME);
  }

  private readLock(lockPath: string): LockHandle | null {
    if (!existsSync(lockPath)) {
      return null;
    }
    try {
      const content = readFileSync(lockPath, 'utf8');
      const parsed: unknown = parse(content);
      const result = lockHandleSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private throwContestationError(err: unknown, runId: RunId, lockPath: string): never {
    if (err instanceof Error && err.message.includes('EEXIST')) {
      const winner = this.readLock(lockPath);
      if (winner) {
        throw new RunAlreadyActiveError(runId, winner.pid);
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new LockAcquisitionError(runId, message);
  }

  private removeStaleLock(lockPath: string): void {
    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort cleanup
    }
  }
}
