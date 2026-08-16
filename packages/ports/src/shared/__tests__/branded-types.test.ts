import { describe, expect, it } from 'vitest';

import { createRunId, createWorkerId } from '../branded-types';

describe('createRunId', () => {
  it('generates an id in YYYYMMDD-HHMMSS-random format when no value provided', () => {
    const id = createRunId();
    expect(String(id)).toMatch(/^\d{8}-\d{6}-[a-z0-9]{6}$/);
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
