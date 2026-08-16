import { describe, expect, it } from 'vitest';

import { hashContent } from '../hash';

describe('hashContent', () => {
  it('produces a sha256-prefixed hex digest for strings', () => {
    const result = hashContent('hello');
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('produces a sha256-prefixed hex digest for buffers', () => {
    const result = hashContent(Buffer.from('hello'));
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('returns the same hash for the same input', () => {
    expect(hashContent('test')).toBe(hashContent('test'));
  });

  it('returns different hashes for different inputs', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});
