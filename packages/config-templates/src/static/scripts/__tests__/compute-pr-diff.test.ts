import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPrDiffArtifact,
  findArtifactContent,
  parseNumstat,
  parseUnifiedDiff,
} from '../compute-pr-diff';

describe('parseNumstat', () => {
  it('parses standard numstat output', () => {
    const numstat = `10\t6\tsrc/foo.ts
3\t0\tsrc/bar.ts
0\t15\tsrc/old.ts`;
    const files = parseNumstat(numstat);
    expect(files).toHaveLength(3);
    expect(files[0]).toEqual({
      path: 'src/foo.ts',
      status: 'modified',
      additions: 10,
      deletions: 6,
    });
    expect(files[1]).toEqual({
      path: 'src/bar.ts',
      status: 'added',
      additions: 3,
      deletions: 0,
    });
    expect(files[2]).toEqual({
      path: 'src/old.ts',
      status: 'deleted',
      additions: 0,
      deletions: 15,
    });
  });

  it('parses renamed files', () => {
    const numstat = `5\t2\tsrc/{old-name.ts => new-name.ts}`;
    const files = parseNumstat(numstat);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('renamed');
    expect(files[0].path).toBe('src/new-name.ts');
  });

  it('handles binary files (- for additions/deletions)', () => {
    const numstat = `-\t-\tassets/logo.png`;
    const files = parseNumstat(numstat);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      path: 'assets/logo.png',
      status: 'modified',
      additions: undefined,
      deletions: undefined,
    });
  });

  it('returns empty array for empty input', () => {
    expect(parseNumstat('')).toEqual([]);
  });

  it('skips blank lines', () => {
    const numstat = `\n1\t1\tsrc/a.ts\n\n`;
    const files = parseNumstat(numstat);
    expect(files).toHaveLength(1);
  });
});

describe('parseUnifiedDiff', () => {
  it('extracts files with additions and deletions from unified diff', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index abc1234..def5678 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,5 @@',
      ' unchanged',
      '-old line',
      '+new line',
      '+added line',
    ].join('\n');

    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      path: 'src/foo.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
    });
  });

  it('detects new files', () => {
    const diff = [
      'diff --git a/new-file.ts b/new-file.ts',
      'new file mode 100644',
      'index 0000000..abc1234',
      '--- /dev/null',
      '+++ b/new-file.ts',
      '@@ -0,0 +1,3 @@',
      '+line 1',
      '+line 2',
      '+line 3',
    ].join('\n');

    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('added');
    expect(files[0].additions).toBe(3);
    expect(files[0].deletions).toBe(0);
  });

  it('detects deleted files', () => {
    const diff = [
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      'index abc1234..0000000',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line 1',
      '-line 2',
    ].join('\n');

    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('deleted');
    expect(files[0].deletions).toBe(2);
  });

  it('detects renamed files', () => {
    const diff = [
      'diff --git a/old-name.ts b/new-name.ts',
      'similarity index 95%',
      'rename from old-name.ts',
      'rename to new-name.ts',
      'index abc..def 100644',
      '--- a/old-name.ts',
      '+++ b/new-name.ts',
      '@@ -1,3 +1,3 @@',
      ' unchanged',
      '-old',
      '+new',
    ].join('\n');

    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('renamed');
    expect(files[0].path).toBe('new-name.ts');
  });

  it('handles multiple files', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/a.ts',
      '@@ -0,0 +1 @@',
      '+content',
      'diff --git a/b.ts b/b.ts',
      'index abc..def 100644',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');

    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('a.ts');
    expect(files[1].path).toBe('b.ts');
  });

  it('returns empty array for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  it('handles binary files with no hunk content', () => {
    const diff = [
      'diff --git a/image.png b/image.png',
      'new file mode 100644',
      'index 0000000..abc1234',
      'Binary files /dev/null and b/image.png differ',
    ].join('\n');

    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('added');
    expect(files[0].additions).toBe(0);
    expect(files[0].deletions).toBe(0);
  });
});

describe('findArtifactContent', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds .md files in the type subdirectory', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'artifact-test-'));
    const typeDir = join(tmpDir, 'canonical_specification');
    mkdirSync(typeDir, { recursive: true });
    writeFileSync(join(typeDir, 'context_analyst-output_v1.md'), '{"id":"test"}');
    writeFileSync(join(typeDir, 'context_analyst-output_v1.meta.yaml'), 'type: test');

    const result = findArtifactContent(tmpDir, 'canonical_specification');
    expect(result).toBe(join(typeDir, 'context_analyst-output_v1.md'));
  });

  it('returns null when type directory does not exist', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'artifact-test-'));
    expect(findArtifactContent(tmpDir, 'nonexistent')).toBeNull();
  });

  it('returns null when artifacts dir does not exist', () => {
    expect(findArtifactContent('/nonexistent/path', 'canonical_specification')).toBeNull();
  });
});

describe('buildPrDiffArtifact', () => {
  it('builds a well-formed pr_diff_context artifact', () => {
    const artifact = buildPrDiffArtifact({
      baseRef: 'main',
      headRef: 'feat/foo',
      prNumber: 42,
      repositoryUrl: 'https://github.com/org/repo',
      diff: 'diff --git a/foo.ts b/foo.ts\n...',
      changedFiles: [{ path: 'foo.ts', status: 'modified' }],
    });

    expect(artifact.version).toBe(1);
    expect(artifact.baseRef).toBe('main');
    expect(artifact.headRef).toBe('feat/foo');
    expect(artifact.prNumber).toBe(42);
    expect(artifact.diff).toContain('diff --git');
    expect(artifact.changedFiles).toHaveLength(1);
    expect(artifact.createdAt).toBeTruthy();
    expect(() => new Date(artifact.createdAt)).not.toThrow();
  });

  it('works without optional fields', () => {
    const artifact = buildPrDiffArtifact({
      baseRef: 'develop',
      headRef: 'fix/bug',
      diff: '...',
      changedFiles: [],
    });

    expect(artifact.prNumber).toBeUndefined();
    expect(artifact.repositoryUrl).toBeUndefined();
    expect(artifact.baseRef).toBe('develop');
  });
});
