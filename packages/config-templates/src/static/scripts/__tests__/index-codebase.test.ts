import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndexerArgs, detectProject, getCachePath } from '../index-codebase';

describe('getCachePath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'index-codebase-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces deterministic paths for the same repo', () => {
    const path1 = getCachePath('/my/repo', tmpDir);
    const path2 = getCachePath('/my/repo', tmpDir);
    expect(path1).toBe(path2);
  });

  it('produces different paths for different repos', () => {
    const path1 = getCachePath('/repo/a', tmpDir);
    const path2 = getCachePath('/repo/b', tmpDir);
    expect(path1).not.toBe(path2);
  });

  it('produces paths ending in .scip', () => {
    const path = getCachePath('/my/repo', tmpDir);
    expect(path).toMatch(/\.scip$/);
  });

  it('places cache files in the specified directory', () => {
    const path = getCachePath('/my/repo', tmpDir);
    expect(path.startsWith(tmpDir)).toBe(true);
  });
});

describe('detectProject', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'index-codebase-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects non-TypeScript project in empty directory', () => {
    const profile = detectProject(tmpDir);
    expect(profile.isTypeScript).toBe(false);
    expect(profile.hasRootTsconfig).toBe(false);
    expect(profile.workspaceManager).toBe('none');
  });

  it('detects TypeScript via tsconfig.json', () => {
    writeFileSync(join(tmpDir, 'tsconfig.json'), '{}', 'utf-8');
    const profile = detectProject(tmpDir);
    expect(profile.isTypeScript).toBe(true);
    expect(profile.hasRootTsconfig).toBe(true);
  });

  it('detects TypeScript via tsconfig.base.json', () => {
    writeFileSync(join(tmpDir, 'tsconfig.base.json'), '{}', 'utf-8');
    const profile = detectProject(tmpDir);
    expect(profile.isTypeScript).toBe(true);
    expect(profile.hasRootTsconfig).toBe(false);
  });

  it('detects TypeScript via tsconfig.build.json', () => {
    writeFileSync(join(tmpDir, 'tsconfig.build.json'), '{}', 'utf-8');
    const profile = detectProject(tmpDir);
    expect(profile.isTypeScript).toBe(true);
    expect(profile.hasRootTsconfig).toBe(false);
  });

  it('detects TypeScript via package.json devDependencies', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { typescript: '^5.9.3' } }),
      'utf-8',
    );
    const profile = detectProject(tmpDir);
    expect(profile.isTypeScript).toBe(true);
    expect(profile.hasRootTsconfig).toBe(false);
  });

  it('detects TypeScript via package.json dependencies', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { typescript: '^5.0.0' } }),
      'utf-8',
    );
    const profile = detectProject(tmpDir);
    expect(profile.isTypeScript).toBe(true);
  });

  it('returns non-TypeScript when package.json has no typescript', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'utf-8',
    );
    const profile = detectProject(tmpDir);
    expect(profile.isTypeScript).toBe(false);
  });

  it('detects pnpm workspace via pnpm-workspace.yaml', () => {
    writeFileSync(join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n', 'utf-8');
    const profile = detectProject(tmpDir);
    expect(profile.workspaceManager).toBe('pnpm');
  });

  it('detects pnpm workspace via pnpm-workspace.yml', () => {
    writeFileSync(join(tmpDir, 'pnpm-workspace.yml'), 'packages:\n  - packages/*\n', 'utf-8');
    const profile = detectProject(tmpDir);
    expect(profile.workspaceManager).toBe('pnpm');
  });

  it('detects yarn workspace via package.json workspaces and yarn.lock', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] }),
      'utf-8',
    );
    writeFileSync(join(tmpDir, 'yarn.lock'), '', 'utf-8');
    const profile = detectProject(tmpDir);
    expect(profile.workspaceManager).toBe('yarn');
  });

  it('detects npm workspace when workspaces field present without yarn.lock', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] }),
      'utf-8',
    );
    const profile = detectProject(tmpDir);
    expect(profile.workspaceManager).toBe('npm');
  });

  it('detects npm workspace when package-lock.json present with workspaces', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] }),
      'utf-8',
    );
    writeFileSync(join(tmpDir, 'package-lock.json'), '{}', 'utf-8');
    const profile = detectProject(tmpDir);
    expect(profile.workspaceManager).toBe('npm');
  });

  it('prefers pnpm over yarn when both exist', () => {
    writeFileSync(join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n', 'utf-8');
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] }),
      'utf-8',
    );
    writeFileSync(join(tmpDir, 'yarn.lock'), '', 'utf-8');
    const profile = detectProject(tmpDir);
    expect(profile.workspaceManager).toBe('pnpm');
  });

  it('returns none when package.json has no workspaces', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    const profile = detectProject(tmpDir);
    expect(profile.workspaceManager).toBe('none');
  });
});

describe('buildIndexerArgs', () => {
  it('includes index command and output path', () => {
    const args = buildIndexerArgs('/tmp/output.scip', {
      isTypeScript: true,
      hasRootTsconfig: true,
      workspaceManager: 'none',
    });
    expect(args).toContain('index');
    expect(args).toContain('--output');
    expect(args).toContain('/tmp/output.scip');
  });

  it('includes --pnpm-workspaces for pnpm', () => {
    const args = buildIndexerArgs('/tmp/output.scip', {
      isTypeScript: true,
      hasRootTsconfig: true,
      workspaceManager: 'pnpm',
    });
    expect(args).toContain('--pnpm-workspaces');
    expect(args).not.toContain('--yarn-workspaces');
  });

  it('includes --yarn-workspaces for yarn', () => {
    const args = buildIndexerArgs('/tmp/output.scip', {
      isTypeScript: true,
      hasRootTsconfig: true,
      workspaceManager: 'yarn',
    });
    expect(args).toContain('--yarn-workspaces');
    expect(args).not.toContain('--pnpm-workspaces');
  });

  it('excludes workspace flags for npm workspaces', () => {
    const args = buildIndexerArgs('/tmp/output.scip', {
      isTypeScript: true,
      hasRootTsconfig: true,
      workspaceManager: 'npm',
    });
    expect(args).not.toContain('--pnpm-workspaces');
    expect(args).not.toContain('--yarn-workspaces');
  });

  it('includes --infer-tsconfig when no root tsconfig', () => {
    const args = buildIndexerArgs('/tmp/output.scip', {
      isTypeScript: true,
      hasRootTsconfig: false,
      workspaceManager: 'none',
    });
    expect(args).toContain('--infer-tsconfig');
  });

  it('excludes --infer-tsconfig when root tsconfig exists', () => {
    const args = buildIndexerArgs('/tmp/output.scip', {
      isTypeScript: true,
      hasRootTsconfig: true,
      workspaceManager: 'none',
    });
    expect(args).not.toContain('--infer-tsconfig');
  });

  it('excludes workspace flags for non-workspace projects', () => {
    const args = buildIndexerArgs('/tmp/output.scip', {
      isTypeScript: true,
      hasRootTsconfig: true,
      workspaceManager: 'none',
    });
    expect(args).not.toContain('--pnpm-workspaces');
    expect(args).not.toContain('--yarn-workspaces');
  });
});
