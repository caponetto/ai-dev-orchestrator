import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { StatePersistence } from '@ai-orchestrator/ports';
import {
  STATE_FILENAME,
  type JournalEvent,
  type LockHandle,
  type PersistedState,
  type RunId,
  type StateValidationResult,
} from '@ai-orchestrator/schemas';
import { stringify } from 'yaml';

import { atomicWriteState } from './atomic-writer';
import { computeStateChecksum, verifyStateChecksum } from './checksum-verifier';
import { LockManager } from './lock-manager';
import { MIN_SUPPORTED_SCHEMA_VERSION, SCHEMA_VERSION } from './schema-version';
import { readState } from './state-reader';
import { rebuildStateFromEvents } from './state-rebuilder';

/** Default implementation of StatePersistence using filesystem storage. */
export class DefaultStatePersistence implements StatePersistence {
  private readonly baseDir: string;
  private readonly lockManager: LockManager;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.lockManager = new LockManager(baseDir);
  }

  /** @inheritdoc */
  async save(state: PersistedState): Promise<void> {
    const checksum = computeStateChecksum(state);
    const stateWithChecksum: PersistedState = { ...state, checksum };
    const content = stringify(stateWithChecksum);
    const filePath = this.statePath(state.runId);
    await atomicWriteState(filePath, content);
  }

  /** @inheritdoc */
  load(runId: RunId): PersistedState | null {
    const filePath = this.statePath(runId);
    const state = readState(filePath);
    if (state) {
      verifyStateChecksum(state);
    }
    return state;
  }

  /** @inheritdoc */
  exists(runId: RunId): boolean {
    return existsSync(this.statePath(runId));
  }

  /** @inheritdoc */
  validate(state: PersistedState): StateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!state.runId) {
      errors.push('Missing runId');
    }
    if (!state.currentState) {
      errors.push('Missing currentState');
    }
    if (state.schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
      errors.push(
        `Schema version ${String(state.schemaVersion)} is below minimum supported ${String(MIN_SUPPORTED_SCHEMA_VERSION)}`,
      );
    } else if (state.schemaVersion < SCHEMA_VERSION) {
      warnings.push(
        `Schema version ${String(state.schemaVersion)} is older than current ${String(SCHEMA_VERSION)}`,
      );
    }
    if (state.transitionCount < 0) {
      errors.push('transitionCount must be non-negative');
    }

    try {
      verifyStateChecksum(state);
    } catch {
      errors.push('Checksum verification failed');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /** @inheritdoc */
  probeLock(runId: RunId): {
    exists: boolean;
    pid: number;
    pidRunning: boolean;
    hostname: string;
    unreadable: boolean;
  } {
    return this.lockManager.probe(runId);
  }

  /** @inheritdoc */
  acquireLock(runId: RunId): LockHandle {
    return this.lockManager.acquire(runId);
  }

  /** @inheritdoc */
  releaseLock(handle: LockHandle): void {
    this.lockManager.release(handle);
  }

  /** @inheritdoc */
  reconstructFromJournal(runId: RunId, events: readonly JournalEvent[]): PersistedState | null {
    const runEvents = events
      .filter((e) => e.runId === runId)
      .slice()
      .sort((a, b) => a.sequence - b.sequence);
    if (runEvents.length === 0) {
      return null;
    }

    return rebuildStateFromEvents(runId, runEvents);
  }

  private statePath(runId: RunId): string {
    return join(this.baseDir, runId, STATE_FILENAME);
  }
}
