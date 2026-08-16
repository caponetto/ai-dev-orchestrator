import { describe, expect, it } from 'vitest';

import { ContextReadError, ContextStoreInitError, ContextWriteError } from '../errors';

describe('project-context errors', () => {
  it('ContextStoreInitError has correct code', () => {
    const err = new ContextStoreInitError('init failed');
    expect(err.code).toBe('CONTEXT_STORE_INIT_ERROR');
    expect(err.message).toBe('init failed');
  });

  it('ContextReadError has correct code', () => {
    const err = new ContextReadError('read failed');
    expect(err.code).toBe('CONTEXT_READ_ERROR');
  });

  it('ContextWriteError has correct code', () => {
    const err = new ContextWriteError('write failed');
    expect(err.code).toBe('CONTEXT_WRITE_ERROR');
  });
});
