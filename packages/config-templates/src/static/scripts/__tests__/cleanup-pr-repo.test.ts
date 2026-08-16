import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { shouldDelete } from '../cleanup-pr-repo';

describe('shouldDelete', () => {
  it('returns true for path under os.tmpdir() with pr-review- prefix', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pr-review-'));
    expect(shouldDelete(tempDir)).toBe(true);
  });

  it('returns false for path under os.tmpdir() without pr-review- prefix', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'other-'));
    expect(shouldDelete(tempDir)).toBe(false);
  });

  it('returns false for path not under os.tmpdir()', () => {
    expect(shouldDelete('/home/user/real-repo')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(shouldDelete('')).toBe(false);
  });

  it('returns false for os.tmpdir() itself', () => {
    expect(shouldDelete(tmpdir())).toBe(false);
  });
});
