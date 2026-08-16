import { describe, expect, it } from 'vitest';

import { ArtifactDiffGenerator } from '../artifact-diff-generator';

describe('ArtifactDiffGenerator', () => {
  const generator = new ArtifactDiffGenerator();

  describe('computeDiff', () => {
    it('returns unchanged when content is identical', () => {
      const content = 'function hello() { return "world"; }';
      const result = generator.computeDiff(content, content);

      expect(result.kind).toBe('unchanged');
      expect(result.diff).toBeUndefined();
    });

    it('returns changed with unified diff for modified text', () => {
      const previous = 'line 1\nline 2\nline 3';
      const current = 'line 1\nline 2 modified\nline 3';

      const result = generator.computeDiff(previous, current);

      expect(result.kind).toBe('changed');
      expect(result.diff).toContain('-line 2');
      expect(result.diff).toContain('+line 2 modified');
    });

    it('returns new when previous is undefined', () => {
      const result = generator.computeDiff(undefined, 'new content');

      expect(result.kind).toBe('new');
      expect(result.content).toBe('new content');
    });

    it('produces valid diff for JSON content', () => {
      const previous = JSON.stringify({ name: 'old', count: 1, nested: { a: 1 } }, null, 2);
      const current = JSON.stringify({ name: 'new', count: 1, nested: { a: 1 } }, null, 2);

      const result = generator.computeDiff(previous, current);

      expect(result.kind).toBe('changed');
      expect(result.diff).toBeDefined();
      expect(result.diff).toContain('-  "name": "old"');
      expect(result.diff).toContain('+  "name": "new"');
    });

    it('handles additions at end of content', () => {
      const previous = 'line 1\nline 2';
      const current = 'line 1\nline 2\nline 3\nline 4';

      const result = generator.computeDiff(previous, current);

      expect(result.kind).toBe('changed');
      expect(result.diff).toContain('+line 3');
      expect(result.diff).toContain('+line 4');
    });

    it('handles deletions', () => {
      const previous = 'line 1\nline 2\nline 3';
      const current = 'line 1\nline 3';

      const result = generator.computeDiff(previous, current);

      expect(result.kind).toBe('changed');
      expect(result.diff).toContain('-line 2');
    });

    it('strips file header from unified diff', () => {
      const previous = 'old content';
      const current = 'new content';

      const result = generator.computeDiff(previous, current);

      expect(result.kind).toBe('changed');
      expect(result.diff).not.toContain('---');
      expect(result.diff).not.toContain('+++');
      expect(result.diff).toContain('@@');
    });
  });
});
