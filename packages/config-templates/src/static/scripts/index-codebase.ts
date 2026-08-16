#!/usr/bin/env -S node --experimental-strip-types --experimental-detect-module
/**
 * Indexes the project's source code using SCIP for symbol-level intelligence.
 *
 * Detects the project language, runs the appropriate SCIP indexer, and caches
 * the result so that RunnerContextAssembler can load it for code-aware review.
 *
 * Currently supports TypeScript projects. Exits successfully with a skip
 * message for unsupported languages so the workflow continues.
 *
 * Expects:
 *   ORCHESTRATOR_REPO_ROOT — repository root path
 *   ORCHESTRATOR_SCRIPT_RESULT — optional path; write {"message":"..."} for chat display
 *
 * Requires: scip-typescript (installed as orchestrator dependency). Node >= 22.6.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_CACHE_DIR = join(homedir(), '.ai', 'cache', 'scip');
const INDEX_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Exported utilities (tested directly)
// ---------------------------------------------------------------------------

export function getCachePath(repoRoot: string, cacheDir: string = DEFAULT_CACHE_DIR): string {
  const hash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
  return join(cacheDir, `${hash}.scip`);
}

export interface ProjectProfile {
  readonly isTypeScript: boolean;
  readonly hasRootTsconfig: boolean;
  readonly workspaceManager: 'pnpm' | 'yarn' | 'npm' | 'none';
}

export function detectProject(repoRoot: string): ProjectProfile {
  let hasTsconfig = false;
  let hasRootTsconfig = false;
  try {
    const entries = readdirSync(repoRoot);
    hasTsconfig = entries.some((f) => /^tsconfig(\..+)?\.json$/.test(f));
    hasRootTsconfig = entries.includes('tsconfig.json');
  } catch {
    return { isTypeScript: false, hasRootTsconfig: false, workspaceManager: 'none' };
  }

  const isPnpm =
    existsSync(join(repoRoot, 'pnpm-workspace.yaml')) ||
    existsSync(join(repoRoot, 'pnpm-workspace.yml'));

  let hasWorkspacesField = false;
  let hasTypescriptDep = false;
  const pkgPath = join(repoRoot, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      hasWorkspacesField = Array.isArray(pkg['workspaces']);
      const deps = pkg['dependencies'] as Record<string, unknown> | undefined;
      const devDeps = pkg['devDependencies'] as Record<string, unknown> | undefined;
      hasTypescriptDep = !!(deps?.['typescript'] ?? devDeps?.['typescript']);
    } catch {
      // ignore malformed package.json
    }
  }

  let workspaceManager: ProjectProfile['workspaceManager'] = 'none';
  if (isPnpm) {
    workspaceManager = 'pnpm';
  } else if (hasWorkspacesField) {
    const hasYarnLock = existsSync(join(repoRoot, 'yarn.lock'));
    workspaceManager = hasYarnLock ? 'yarn' : 'npm';
  }

  return {
    isTypeScript: hasTsconfig || hasTypescriptDep,
    hasRootTsconfig,
    workspaceManager,
  };
}

export function buildIndexerArgs(outputPath: string, profile: ProjectProfile): string[] {
  const args = ['index', '--output', outputPath];
  if (profile.workspaceManager === 'pnpm') {
    args.push('--pnpm-workspaces');
  } else if (profile.workspaceManager === 'yarn') {
    args.push('--yarn-workspaces');
  }
  // npm workspaces: scip-typescript detects them automatically; no flag needed.
  if (!profile.hasRootTsconfig) {
    args.push('--infer-tsconfig');
  }
  return args;
}

// ---------------------------------------------------------------------------
// Main (only runs when executed as a script, not when imported for tests)
// ---------------------------------------------------------------------------

const isMainModule = process.argv[1]?.endsWith('index-codebase.ts');

if (isMainModule) {
  const writeResult = (message: string): void => {
    console.log(message);
    const resultPath = process.env.ORCHESTRATOR_SCRIPT_RESULT;
    if (resultPath) {
      writeFileSync(resultPath, JSON.stringify({ message }), 'utf-8');
    }
  };

  const repoRoot = process.env.ORCHESTRATOR_REPO_ROOT;
  if (!repoRoot) {
    console.error('Missing required env: ORCHESTRATOR_REPO_ROOT');
    process.exit(1);
  }

  const profile = detectProject(repoRoot);

  if (!profile.isTypeScript) {
    writeResult('SCIP indexing skipped: not a TypeScript project');
    process.exit(0);
  }

  const cachePath = getCachePath(repoRoot);
  if (existsSync(cachePath)) {
    writeResult('SCIP index loaded from cache');
    process.exit(0);
  }

  mkdirSync(DEFAULT_CACHE_DIR, { recursive: true });

  const args = buildIndexerArgs(cachePath, profile);

  try {
    await execFileAsync('scip-typescript', args, {
      cwd: repoRoot,
      timeout: INDEX_TIMEOUT_MS,
    });
    writeResult('SCIP index built successfully');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isNotFound = errMsg.includes('ENOENT');
    console.error(`SCIP indexing failed: ${errMsg}`);
    const reason = isNotFound ? 'scip-typescript binary not found on PATH' : errMsg.slice(0, 200);
    writeResult(`SCIP indexing skipped: ${reason}`);
    process.exit(0);
  }
}
