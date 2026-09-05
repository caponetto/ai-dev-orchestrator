import { describe, expect, it } from 'vitest';

import { createRunId, createWorkerId } from '../branded-types';

describe('createRunId', () => {
  it('generates an id with a cryptographic Base64URL suffix when no value provided', () => {
    const id = createRunId();
    expect(String(id)).toMatch(/^\d{8}-\d{6}-[A-Za-z0-9_-]{22}$/);
  });

  it('generates unique ids on successive calls', () => {
    const a = createRunId();
    const b = createRunId();
    expect(String(a)).not.toBe(String(b));
  });

  it('returns the provided value as a RunId when given a string', () => {
    const id = createRunId('my-custom-run');
    expect(String(id)).toBe('my-custom-run');
  });
});

describe('createWorkerId', () => {
  it('returns the provided value as a WorkerId', () => {
    const id = createWorkerId('worker-1');
    expect(String(id)).toBe('worker-1');
  });
});
