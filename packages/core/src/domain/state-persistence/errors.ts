import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';

/** Thrown when a state persistence operation fails. */
export class StatePersistenceError extends NonRecoverableErrorBase {
  readonly code = 'STATE_PERSISTENCE_ERROR';

  constructor(readonly cause: string) {
    super(`State persistence failed: ${cause}`);
  }
}

/** Thrown when a persisted state's checksum does not match. */
export class StateCorruptionError extends NonRecoverableErrorBase {
  readonly code = 'STATE_CORRUPTION_ERROR';

  constructor(
    readonly checksumExpected: string,
    readonly checksumActual: string,
  ) {
    super(
      `State corruption detected: expected checksum ${checksumExpected}, got ${checksumActual}`,
    );
  }
}

/** Thrown when a lock cannot be acquired. */
export class LockAcquisitionError extends NonRecoverableErrorBase {
  readonly code = 'LOCK_ACQUISITION_ERROR';

  constructor(
    readonly runId: string,
    readonly cause: string,
  ) {
    super(`Failed to acquire lock for run "${runId}": ${cause}`);
  }
}

/** Thrown when a run is already active with a different process. */
export class RunAlreadyActiveError extends NonRecoverableErrorBase {
  readonly code = 'RUN_ALREADY_ACTIVE';

  constructor(
    readonly runId: string,
    readonly existingPid: number,
  ) {
    super(`Run "${runId}" is already active (PID: ${String(existingPid)})`);
  }
}

/** Thrown when a persisted state has an incompatible schema version. */
export class SchemaIncompatibleError extends NonRecoverableErrorBase {
  readonly code = 'SCHEMA_INCOMPATIBLE';

  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Schema version mismatch: expected ${String(expected)}, got ${String(actual)}`);
  }
}
