import { describe, expect, it } from 'vitest';

import { NonRecoverableErrorBase, OrchestratorError, RecoverableErrorBase } from '../errors';

class TestRecoverableError extends RecoverableErrorBase {
  readonly code = 'TEST_RECOVERABLE';
}

class TestNonRecoverableError extends NonRecoverableErrorBase {
  readonly code = 'TEST_NON_RECOVERABLE';
}

describe('OrchestratorError hierarchy', () => {
  it('RecoverableErrorBase sets recoverable to true', () => {
    const err = new TestRecoverableError('something went wrong');
    expect(err.recoverable).toBe(true);
    expect(err.code).toBe('TEST_RECOVERABLE');
    expect(err.message).toBe('something went wrong');
    expect(err.name).toBe('TestRecoverableError');
    expect(err).toBeInstanceOf(OrchestratorError);
    expect(err).toBeInstanceOf(Error);
  });

  it('NonRecoverableErrorBase sets recoverable to false', () => {
    const err = new TestNonRecoverableError('fatal');
    expect(err.recoverable).toBe(false);
    expect(err.code).toBe('TEST_NON_RECOVERABLE');
    expect(err.message).toBe('fatal');
    expect(err.name).toBe('TestNonRecoverableError');
    expect(err).toBeInstanceOf(OrchestratorError);
    expect(err).toBeInstanceOf(Error);
  });
});
