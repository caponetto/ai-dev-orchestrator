import { OrchestratorError } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import {
  LockAcquisitionError,
  RunAlreadyActiveError,
  SchemaIncompatibleError,
  StateCorruptionError,
  StatePersistenceError,
} from '../errors';

describe('state persistence errors', () => {
  it('StatePersistenceError includes cause', () => {
    const error = new StatePersistenceError('disk full');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('STATE_PERSISTENCE_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.cause).toBe('disk full');
    expect(error.message).toContain('disk full');
  });

  it('StateCorruptionError includes checksums', () => {
    const error = new StateCorruptionError('sha256:expected', 'sha256:actual');
    expect(error.code).toBe('STATE_CORRUPTION_ERROR');
    expect(error.checksumExpected).toBe('sha256:expected');
    expect(error.checksumActual).toBe('sha256:actual');
    expect(error.message).toContain('sha256:expected');
    expect(error.message).toContain('sha256:actual');
  });

  it('LockAcquisitionError includes runId and cause', () => {
    const error = new LockAcquisitionError('run-001', 'already locked');
    expect(error.code).toBe('LOCK_ACQUISITION_ERROR');
    expect(error.runId).toBe('run-001');
    expect(error.cause).toBe('already locked');
    expect(error.message).toContain('run-001');
  });

  it('RunAlreadyActiveError includes runId and existingPid', () => {
    const error = new RunAlreadyActiveError('run-001', 99999);
    expect(error.code).toBe('RUN_ALREADY_ACTIVE');
    expect(error.runId).toBe('run-001');
    expect(error.existingPid).toBe(99999);
    expect(error.message).toContain('99999');
  });

  it('SchemaIncompatibleError includes expected and actual versions', () => {
    const error = new SchemaIncompatibleError(2, 1);
    expect(error.code).toBe('SCHEMA_INCOMPATIBLE');
    expect(error.expected).toBe(2);
    expect(error.actual).toBe(1);
    expect(error.message).toContain('2');
    expect(error.message).toContain('1');
  });

  it('all errors have correct name from constructor', () => {
    expect(new StatePersistenceError('x').name).toBe('StatePersistenceError');
    expect(new StateCorruptionError('a', 'b').name).toBe('StateCorruptionError');
    expect(new LockAcquisitionError('a', 'b').name).toBe('LockAcquisitionError');
    expect(new RunAlreadyActiveError('a', 1).name).toBe('RunAlreadyActiveError');
    expect(new SchemaIncompatibleError(1, 2).name).toBe('SchemaIncompatibleError');
  });
});
