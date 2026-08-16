import { existsSync, rmdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTempDir } from '../temp-dir';

describe('createTempDir', () => {
  it('creates a directory that exists on disk', () => {
    const dir = createTempDir('test-utils-');
    expect(existsSync(dir)).toBe(true);
    rmdirSync(dir);
  });

  it('includes the prefix in the path', () => {
    const dir = createTempDir('my-prefix-');
    expect(dir).toContain('my-prefix-');
    rmdirSync(dir);
  });
});
