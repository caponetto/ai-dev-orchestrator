import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VersionManager } from '../version-manager';

function tempArtifactsDir(): string {
  return mkdtempSync(join(tmpdir(), 'version-mgr-'));
}

function createArtifactFiles(dir: string, type: string, name: string, versions: number[]): void {
  const typeDir = join(dir, type);
  mkdirSync(typeDir, { recursive: true });
  for (const v of versions) {
    writeFileSync(join(typeDir, `${name}_v${String(v)}.md`), `content v${String(v)}`);
    writeFileSync(join(typeDir, `${name}_v${String(v)}.meta.yaml`), `version: ${String(v)}`);
  }
}

describe('VersionManager', () => {
  it('returns 1 for the first version of a new artifact', () => {
    const dir = tempArtifactsDir();
    const mgr = new VersionManager(dir);
    expect(mgr.nextVersion('plan', 'plan')).toBe(1);
  });

  it('returns null for latestVersion when no versions exist', () => {
    const dir = tempArtifactsDir();
    const mgr = new VersionManager(dir);
    expect(mgr.latestVersion('plan', 'plan')).toBeNull();
  });

  it('returns empty array for listVersions when no versions exist', () => {
    const dir = tempArtifactsDir();
    const mgr = new VersionManager(dir);
    expect(mgr.listVersions('plan', 'plan')).toEqual([]);
  });

  it('detects existing versions on disk', () => {
    const dir = tempArtifactsDir();
    createArtifactFiles(dir, 'plan', 'plan', [1, 2, 3]);
    const mgr = new VersionManager(dir);

    expect(mgr.listVersions('plan', 'plan')).toEqual([1, 2, 3]);
    expect(mgr.latestVersion('plan', 'plan')).toBe(3);
    expect(mgr.nextVersion('plan', 'plan')).toBe(4);
  });

  it('ignores meta.yaml files when scanning versions', () => {
    const dir = tempArtifactsDir();
    createArtifactFiles(dir, 'plan', 'plan', [1]);
    const mgr = new VersionManager(dir);
    expect(mgr.listVersions('plan', 'plan')).toEqual([1]);
  });

  it('returns sorted versions even if disk order differs', () => {
    const dir = tempArtifactsDir();
    createArtifactFiles(dir, 'plan', 'plan', [3, 1, 2]);
    const mgr = new VersionManager(dir);
    expect(mgr.listVersions('plan', 'plan')).toEqual([1, 2, 3]);
  });

  it('handles multiple artifact names in the same type directory', () => {
    const dir = tempArtifactsDir();
    createArtifactFiles(dir, 'plan', 'alpha', [1, 2]);
    createArtifactFiles(dir, 'plan', 'beta', [1]);
    const mgr = new VersionManager(dir);

    expect(mgr.listVersions('plan', 'alpha')).toEqual([1, 2]);
    expect(mgr.listVersions('plan', 'beta')).toEqual([1]);
    expect(mgr.nextVersion('plan', 'alpha')).toBe(3);
    expect(mgr.nextVersion('plan', 'beta')).toBe(2);
  });

  it('handles non-existent type directory', () => {
    const dir = tempArtifactsDir();
    const mgr = new VersionManager(dir);
    expect(mgr.listVersions('canonical_specification', 'spec')).toEqual([]);
  });
});
