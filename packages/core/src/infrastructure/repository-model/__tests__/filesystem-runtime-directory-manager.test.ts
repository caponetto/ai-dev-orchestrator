import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FilesystemRuntimeDirectoryManager } from '../filesystem-runtime-directory-manager';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'runtime-mgr-'));
}

describe('FilesystemRuntimeDirectoryManager', () => {
  it('creates a run directory with subdirectories', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    const runDir = mgr.getRunDirectory('20250115-103000-abc123');

    expect(existsSync(runDir)).toBe(true);
    expect(existsSync(join(runDir, 'artifacts'))).toBe(true);
  });

  it('is idempotent — calling getRunDirectory twice returns same path', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    const path1 = mgr.getRunDirectory('20250115-103000-abc123');
    const path2 = mgr.getRunDirectory('20250115-103000-abc123');
    expect(path1).toBe(path2);
  });

  it('lists run directories sorted by ID', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    mgr.getRunDirectory('20250115-103000-bbb222');
    mgr.getRunDirectory('20250115-103000-aaa111');

    const runs = mgr.listRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.runId).toBe('20250115-103000-aaa111');
    expect(runs[1]?.runId).toBe('20250115-103000-bbb222');
  });

  it('returns empty list when no runs exist', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    expect(mgr.listRuns()).toEqual([]);
  });

  it('removes a run directory', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    mgr.getRunDirectory('20250115-103000-abc123');
    mgr.removeRun('20250115-103000-abc123');

    expect(existsSync(join(root, '20250115-103000-abc123'))).toBe(false);
  });

  it('removeRun is a no-op for nonexistent runs', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    expect(() => {
      mgr.removeRun('nonexistent');
    }).not.toThrow();
  });

  it('returns the runtime root path', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    expect(mgr.getRuntimeRoot()).toBe(root);
  });

  it('detects active status from lock file', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    const runDir = mgr.getRunDirectory('20250115-103000-abc123');
    writeFileSync(join(runDir, 'run.lock'), '');

    const runs = mgr.listRuns();
    expect(runs[0]?.status).toBe('active');
  });

  it('detects completed status from state.yaml without lock', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    const runDir = mgr.getRunDirectory('20250115-103000-abc123');
    writeFileSync(join(runDir, 'state.yaml'), 'state: completed');

    const runs = mgr.listRuns();
    expect(runs[0]?.status).toBe('completed');
  });

  it('detects aborted status when no state files exist', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    mgr.getRunDirectory('20250115-103000-abc123');

    const runs = mgr.listRuns();
    expect(runs[0]?.status).toBe('aborted');
  });

  it('ignores non-run entries in runs directory', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    mgr.getRunDirectory('20250115-103000-abc123');
    mkdirSync(join(root, 'not-a-run'));
    writeFileSync(join(root, 'somefile.txt'), 'data');

    const runs = mgr.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe('20250115-103000-abc123');
  });

  it('computes directory size including nested files', () => {
    const root = tempDir();
    const mgr = new FilesystemRuntimeDirectoryManager(root);
    const runDir = mgr.getRunDirectory('20250115-103000-abc123');
    writeFileSync(join(runDir, 'state.yaml'), 'x'.repeat(100));
    writeFileSync(join(runDir, 'artifacts', 'file.txt'), 'y'.repeat(50));

    const runs = mgr.listRuns();
    expect(runs[0]?.sizeBytes).toBeGreaterThanOrEqual(150);
  });

  it('listRuns returns empty list when runsDir does not exist', () => {
    const nonexistent = join(tmpdir(), `nonexistent-dir-${String(Date.now())}`);
    const mgr = new FilesystemRuntimeDirectoryManager(nonexistent);
    expect(mgr.listRuns()).toEqual([]);
  });
});
