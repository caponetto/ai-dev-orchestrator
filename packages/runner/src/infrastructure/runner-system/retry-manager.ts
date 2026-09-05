import type { WorkerError } from '@ai-dev-orchestrator/schemas';
const RETRYABLE_TYPES: ReadonlySet<WorkerError['type']> = new Set(['agent_error', 'timeout']);

const NON_RETRYABLE_TYPES: ReadonlySet<WorkerError['type']> = new Set([
  'schema_violation',
  'ownership_violation',
  'invalid_output',
  'cancelled',
]);

export function isRetryableWorkerError(error: WorkerError): boolean {
  if (NON_RETRYABLE_TYPES.has(error.type)) {
    return false;
  }
  return RETRYABLE_TYPES.has(error.type) || error.retryable;
}
