import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FilesystemRepositoryDiscovery } from '../filesystem-repository-discovery';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'repo-discovery-'));
}

describe('FilesystemRepositoryDiscovery', () => {
  it('returns found=false when global ~/.ai does not exist', () => {
    const dir = tempDir();
    const globalAiDir = join(dir, 'missing-ai');
    const discovery = new FilesystemRepositoryDiscovery({ globalAiDir });

    const result = discovery.discover(dir);

    expect(result.found).toBe(false);
    expect(result.aiConfigDir).toBeUndefined();
  });

  it('discovers global ~/.ai regardless of cwd', () => {
    const home = tempDir();
    const globalAiDir = join(home, '.ai');
    mkdirSync(globalAiDir);
    const cwd = tempDir();
    const discovery = new FilesystemRepositoryDiscovery({ globalAiDir });

    const result = discovery.discover(cwd);

    expect(result.found).toBe(true);
    expect(result.aiConfigDir).toBe(globalAiDir);
  });

  it('does not treat a project-local .ai/ as config', () => {
    const home = tempDir();
    const globalAiDir = join(home, '.ai'); // does not exist
    const project = tempDir();
    mkdirSync(join(project, '.ai'));
    const discovery = new FilesystemRepositoryDiscovery({ globalAiDir });

    const result = discovery.discover(project);

    expect(result.found).toBe(false);
    expect(result.aiConfigDir).toBeUndefined();
  });

  it('detects .git/ and sets repoRoot to the git repository root', () => {
    const home = tempDir();
    const globalAiDir = join(home, '.ai');
    mkdirSync(globalAiDir);
    const project = tempDir();
    mkdirSync(join(project, '.git'));
    const nested = join(project, 'src', 'components');
    mkdirSync(nested, { recursive: true });
    const discovery = new FilesystemRepositoryDiscovery({ globalAiDir });

    const result = discovery.discover(nested);

    expect(result.found).toBe(true);
    expect(result.repoRoot).toBe(project);
    expect(result.gitRoot).toBe(join(project, '.git'));
  });

  it('warns when global ~/.ai exists without a .git/ ancestor', () => {
    const home = tempDir();
    const globalAiDir = join(home, '.ai');
    mkdirSync(globalAiDir);
    const cwd = tempDir();
    const discovery = new FilesystemRepositoryDiscovery({ globalAiDir });

    const result = discovery.discover(cwd);

    expect(result.found).toBe(true);
    expect(result.errors).toBeDefined();
    expect(result.errors?.some((e) => e.includes('.git/'))).toBe(true);
  });

  it('detects .git file (worktree) as gitRoot', () => {
    const home = tempDir();
    const globalAiDir = join(home, '.ai');
    mkdirSync(globalAiDir);
    const project = tempDir();
    writeFileSync(join(project, '.git'), 'gitdir: /some/worktree/path');
    const discovery = new FilesystemRepositoryDiscovery({ globalAiDir });

    const result = discovery.discover(project);

    expect(result.found).toBe(true);
    expect(result.gitRoot).toBe(join(project, '.git'));
    expect(result.repoRoot).toBe(project);
  });

  it('returns no errors when global ~/.ai and .git/ both exist', () => {
    const home = tempDir();
    const globalAiDir = join(home, '.ai');
    mkdirSync(globalAiDir);
    const project = tempDir();
    mkdirSync(join(project, '.git'));
    const discovery = new FilesystemRepositoryDiscovery({ globalAiDir });

    const result = discovery.discover(project);

    expect(result.errors).toBeUndefined();
  });

  it('ignores a global .ai path that is a file, not a directory', () => {
    const home = tempDir();
    const globalAiDir = join(home, '.ai');
    writeFileSync(globalAiDir, 'not a directory');
    const discovery = new FilesystemRepositoryDiscovery({ globalAiDir });

    const result = discovery.discover(tempDir());

    expect(result.found).toBe(false);
  });
});
