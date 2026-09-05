import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';

/** Thrown when a journal write operation fails. */
export class JournalWriteError extends NonRecoverableErrorBase {
  readonly code = 'JOURNAL_WRITE_ERROR';

  constructor(readonly cause: string) {
    super(`Journal write failed: ${cause}`);
  }
}

/** Thrown when a journal read operation fails. */
export class JournalReadError extends NonRecoverableErrorBase {
  readonly code = 'JOURNAL_READ_ERROR';

  constructor(readonly cause: string) {
    super(`Journal read failed: ${cause}`);
  }
}

/** Thrown when the journal file is corrupted. */
export class JournalCorruptionError extends NonRecoverableErrorBase {
  readonly code = 'JOURNAL_CORRUPTION_ERROR';

  constructor(readonly cause: string) {
    super(`Journal corruption detected: ${cause}`);
  }
}
