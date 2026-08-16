import type { WorkerError } from '@ai-orchestrator/schemas';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isRetryableWorkerError } from '../retry-manager';
import { generateWorkerId, resetWorkerCounter } from '../worker-spawner';

describe('Runner System property-based tests', () => {
  it('worker IDs are unique across dispatches', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 200 }), (count) => {
        resetWorkerCounter();
        const ids = new Set<string>();

        for (let i = 0; i < count; i++) {
          ids.add(generateWorkerId());
        }

        expect(ids.size).toBe(count);
      }),
      { numRuns: 100 },
    );
  });

  it('non-retryable error types are never retryable', () => {
    const NON_RETRYABLE: WorkerError['type'][] = [
      'schema_violation',
      'ownership_violation',
      'invalid_output',
      'cancelled',
    ];

    fc.assert(
      fc.property(fc.constantFrom(...NON_RETRYABLE), (errorType) => {
        const error: WorkerError = {
          type: errorType,
          message: 'test',
          retryable: false,
        };
        expect(isRetryableWorkerError(error)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('retryable error types are always retryable', () => {
    const RETRYABLE: WorkerError['type'][] = ['agent_error', 'timeout'];

    fc.assert(
      fc.property(fc.constantFrom(...RETRYABLE), (errorType) => {
        const error: WorkerError = {
          type: errorType,
          message: 'test',
          retryable: true,
        };
        expect(isRetryableWorkerError(error)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
