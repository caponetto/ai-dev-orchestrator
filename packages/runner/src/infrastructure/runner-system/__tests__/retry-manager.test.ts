import type { WorkerError } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { isRetryableWorkerError } from '../retry-manager';

function makeError(type: WorkerError['type'], retryable = true): WorkerError {
  return { type, message: 'test error', retryable };
}

describe('isRetryableWorkerError', () => {
  it('returns true for agent_error', () => {
    expect(isRetryableWorkerError(makeError('agent_error'))).toBe(true);
  });

  it('returns true for timeout', () => {
    expect(isRetryableWorkerError(makeError('timeout'))).toBe(true);
  });

  it('returns false for schema_violation', () => {
    expect(isRetryableWorkerError(makeError('schema_violation'))).toBe(false);
  });

  it('returns false for ownership_violation', () => {
    expect(isRetryableWorkerError(makeError('ownership_violation'))).toBe(false);
  });

  it('returns false for invalid_output', () => {
    expect(isRetryableWorkerError(makeError('invalid_output'))).toBe(false);
  });

  it('returns false for cancelled', () => {
    expect(isRetryableWorkerError(makeError('cancelled'))).toBe(false);
  });

  it('returns true for unknown type when retryable flag is true', () => {
    expect(isRetryableWorkerError(makeError('unknown' as WorkerError['type'], true))).toBe(true);
  });

  it('returns false for unknown type when retryable flag is false', () => {
    expect(isRetryableWorkerError(makeError('unknown' as WorkerError['type'], false))).toBe(false);
  });
});
