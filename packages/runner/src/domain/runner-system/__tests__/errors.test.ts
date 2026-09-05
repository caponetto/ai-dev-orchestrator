import { OrchestratorError, RecoverableErrorBase } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import {
  AllRetriesExhaustedError,
  ContextAssemblyError,
  InvalidOutputError,
  OutputOwnershipError,
  WorkerDispatchError,
  WorkerTimeoutError,
} from '../errors';

describe('Runner system errors', () => {
  it('ContextAssemblyError has correct properties', () => {
    const error = new ContextAssemblyError('artifact not found');
    expect(error.code).toBe('CONTEXT_ASSEMBLY_ERROR');
    expect(error.recoverable).toBe(true);
    expect(error.message).toContain('artifact not found');
    expect(error).toBeInstanceOf(RecoverableErrorBase);
    expect(error).toBeInstanceOf(OrchestratorError);
  });

  it('WorkerTimeoutError has correct properties', () => {
    const error = new WorkerTimeoutError('worker-001', 120000);
    expect(error.code).toBe('WORKER_TIMEOUT');
    expect(error.workerId).toBe('worker-001');
    expect(error.timeoutMs).toBe(120000);
    expect(error.recoverable).toBe(true);
  });

  it('WorkerDispatchError has correct properties', () => {
    const error = new WorkerDispatchError('worker-002', 'planner', 'driver failed');
    expect(error.code).toBe('WORKER_DISPATCH_ERROR');
    expect(error.workerId).toBe('worker-002');
    expect(error.role).toBe('planner');
    expect(error.recoverable).toBe(true);
  });

  it('InvalidOutputError is not recoverable', () => {
    const validationErrors = [
      { path: '/title', message: 'required', expected: 'string', actual: 'undefined' },
      { path: '/steps', message: 'must be array', expected: 'array', actual: 'string' },
    ];
    const error = new InvalidOutputError(validationErrors);
    expect(error.code).toBe('INVALID_OUTPUT');
    expect(error.validationErrors).toEqual(validationErrors);
    expect(error.recoverable).toBe(false);
    expect(error.message).toContain('/title');
    expect(error.message).toContain('/steps');
  });

  it('OutputOwnershipError is not recoverable', () => {
    const error = new OutputOwnershipError('implementer', 'plan');
    expect(error.code).toBe('OUTPUT_OWNERSHIP_ERROR');
    expect(error.role).toBe('implementer');
    expect(error.artifactType).toBe('plan');
    expect(error.recoverable).toBe(false);
  });

  it('AllRetriesExhaustedError is not recoverable', () => {
    const error = new AllRetriesExhaustedError(3, 'rate limited');
    expect(error.code).toBe('ALL_RETRIES_EXHAUSTED');
    expect(error.attempts).toBe(3);
    expect(error.lastError).toBe('rate limited');
    expect(error.recoverable).toBe(false);
  });
});
