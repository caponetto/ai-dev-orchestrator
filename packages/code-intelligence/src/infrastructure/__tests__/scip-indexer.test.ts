import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScipIndexer } from '../scip-indexer';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

describe('ScipIndexer', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('reports not indexed for unknown repo root', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scip-test-'));
    const indexer = new ScipIndexer({ cacheDir: tmpDir });
    expect(indexer.isIndexed('/nonexistent')).toBe(false);
  });

  it('reports indexed when cache file exists', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scip-test-'));
    const indexer = new ScipIndexer({ cacheDir: tmpDir });
    const cachePath = indexer.getCachePath('/some/repo');
    mkdirSync(join(tmpDir), { recursive: true });
    writeFileSync(cachePath, 'fake-index');
    expect(indexer.isIndexed('/some/repo')).toBe(true);
  });

  it('produces deterministic cache paths for the same repo', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scip-test-'));
    const indexer = new ScipIndexer({ cacheDir: tmpDir });
    const path1 = indexer.getCachePath('/my/repo');
    const path2 = indexer.getCachePath('/my/repo');
    expect(path1).toBe(path2);
  });

  it('produces different cache paths for different repos', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scip-test-'));
    const indexer = new ScipIndexer({ cacheDir: tmpDir });
    const path1 = indexer.getCachePath('/repo/a');
    const path2 = indexer.getCachePath('/repo/b');
    expect(path1).not.toBe(path2);
  });

  it('calls npx scip-typescript index and returns cache path', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scip-test-'));
    const indexer = new ScipIndexer({ cacheDir: tmpDir });
    const repoRoot = '/my/project';
    const expectedPath = indexer.getCachePath(repoRoot);

    const result = indexer.index(repoRoot);

    expect(result).toBe(expectedPath);
    expect(execFileSync).toHaveBeenCalledWith(
      'scip-typescript',
      ['index', '--pnpm-workspaces', '--output', expectedPath],
      expect.objectContaining({
        cwd: repoRoot,
        stdio: 'pipe',
      }),
    );
  });

  it('propagates errors from scip-typescript indexer', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scip-test-'));
    const indexer = new ScipIndexer({ cacheDir: tmpDir });
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('scip-typescript not found');
    });

    expect(() => indexer.index('/my/project')).toThrow('scip-typescript not found');
  });
});
