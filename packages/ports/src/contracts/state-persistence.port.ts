import type {
  JournalEvent,
  LockHandle,
  PersistedState,
  RunId,
  StateValidationResult,
} from '@ai-orchestrator/schemas';

export interface LockProbeResult {
  readonly exists: boolean;
  readonly pid: number;
  readonly pidRunning: boolean;
  readonly hostname: string;
  readonly unreadable: boolean;
}

/** Port for persisting and restoring workflow run state. */
export interface StatePersistence {
  save(state: PersistedState): Promise<void>;
  load(runId: RunId): PersistedState | null;
  exists(runId: RunId): boolean;
  validate(state: PersistedState): StateValidationResult;
  probeLock(runId: RunId): LockProbeResult;
  acquireLock(runId: RunId): LockHandle;
  releaseLock(handle: LockHandle): void;
  reconstructFromJournal(runId: RunId, events: readonly JournalEvent[]): PersistedState | null;
}
