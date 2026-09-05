import { RecoverableErrorBase } from '@ai-dev-orchestrator/ports';
import type { ValidationError } from '@ai-dev-orchestrator/schemas';

/** Thrown when context assembly fails (missing artifact, access denied). */
export class ContextAssemblyError extends RecoverableErrorBase {
  readonly code = 'CONTEXT_ASSEMBLY_ERROR';

  constructor(message: string) {
    super(`Context assembly failed: ${message}`);
  }
}

/** Thrown when a worker exceeds its configured timeout. */
export class WorkerTimeoutError extends RecoverableErrorBase {
  readonly code = 'WORKER_TIMEOUT';

  constructor(
    readonly workerId: string,
    readonly timeoutMs: number,
  ) {
    super(`Worker "${workerId}" timed out after ${String(timeoutMs)}ms`);
  }
}

/** Thrown when a worker dispatch fails. */
export class WorkerDispatchError extends RecoverableErrorBase {
  readonly code = 'WORKER_DISPATCH_ERROR';

  constructor(
    readonly workerId: string,
    readonly role: string,
    message: string,
  ) {
    super(`Failed to dispatch worker "${workerId}" for role "${role}": ${message}`);
  }
}

/** Thrown when worker output fails validation against the output contract. */
export class InvalidOutputError extends RecoverableErrorBase {
  readonly code = 'INVALID_OUTPUT';
  override readonly recoverable = false;

  constructor(readonly validationErrors: readonly ValidationError[]) {
    const details = validationErrors.map((e) => `${e.path}: ${e.message}`).join('; ');
    super(`Invalid worker output: ${details}`);
  }
}

/** Thrown when a worker attempts to produce an artifact type it does not own. */
export class OutputOwnershipError extends RecoverableErrorBase {
  readonly code = 'OUTPUT_OWNERSHIP_ERROR';
  override readonly recoverable = false;

  constructor(
    readonly role: string,
    readonly artifactType: string,
  ) {
    super(`Role "${role}" is not authorized to produce artifact type "${artifactType}"`);
  }
}

/** Thrown when all retry attempts are exhausted for a transient failure. */
export class AllRetriesExhaustedError extends RecoverableErrorBase {
  readonly code = 'ALL_RETRIES_EXHAUSTED';
  override readonly recoverable = false;

  constructor(
    readonly attempts: number,
    readonly lastError: string,
  ) {
    super(`All ${String(attempts)} retry attempts exhausted; last error: ${lastError}`);
  }
}
