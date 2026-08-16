import { describe, expect, it } from 'vitest';

import { parseDiffToHunks } from '../diff-parser';

describe('parseDiffToHunks', () => {
  it('parses a simple unified diff into hunks', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index abc123..def456 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -10,6 +10,8 @@ export function foo() {',
      '   const a = 1;',
      '+  const b = 2;',
      '+  const c = 3;',
      '   return a;',
      ' }',
    ].join('\n');

    const hunks = parseDiffToHunks(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].filePath).toBe('src/foo.ts');
    expect(hunks[0].startLine).toBe(10);
    expect(hunks[0].endLine).toBe(17);
  });

  it('handles multiple files', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      "+import { x } from './x';",
      ' const a = 1;',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -5,3 +5,4 @@',
      '+export const y = 2;',
      ' const b = 1;',
    ].join('\n');

    const hunks = parseDiffToHunks(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].filePath).toBe('src/a.ts');
    expect(hunks[1].filePath).toBe('src/b.ts');
  });

  it('handles multiple hunks in one file', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      '+import { x }',
      ' const a = 1;',
      '@@ -20,3 +21,4 @@',
      '+export const y = 2;',
      ' const b = 1;',
    ].join('\n');

    const hunks = parseDiffToHunks(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].startLine).toBe(1);
    expect(hunks[1].startLine).toBe(21);
  });

  it('returns empty array for empty diff', () => {
    expect(parseDiffToHunks('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseDiffToHunks('   \n  ')).toEqual([]);
  });
});
