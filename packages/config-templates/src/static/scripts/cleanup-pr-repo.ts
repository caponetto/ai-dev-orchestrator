#!/usr/bin/env -S node --experimental-strip-types --experimental-detect-module
/**
 * Removes the temporary cloned repository directory created by setup-pr-repo.ts.
 *
 * Expects:
 *   ORCHESTRATOR_REPO_ROOT — path to the temp directory to delete
 *   ORCHESTRATOR_SCRIPT_RESULT — optional path; write {"message":"..."} for chat display
 *
 * Safety: only deletes directories under os.tmpdir() to prevent accidental deletion
 * of real repositories.
 *
 * Requires: Node >= 22.6
 */

import { existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';

import { TEMP_DIR_PREFIX } from './pr-review-constants.ts';

function resolveReal(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

export function shouldDelete(dirPath: string): boolean {
  if (!dirPath) {
    return false;
  }
  const resolved = resolveReal(dirPath);
  const tmp = resolveReal(tmpdir());
  const isUnderTmp = resolved.startsWith(tmp + '/') || resolved.startsWith(tmp + '\\');
  const hasPrefix = basename(resolved).startsWith(TEMP_DIR_PREFIX);
  return isUnderTmp && hasPrefix;
}

// ---------------------------------------------------------------------------
// Main (only runs when executed as a script, not when imported for tests)
// ---------------------------------------------------------------------------

const isMainModule = process.argv[1]?.endsWith('cleanup-pr-repo.ts');

if (isMainModule) {
  const repoRoot = process.env.ORCHESTRATOR_REPO_ROOT;
  const scriptResultPath = process.env.ORCHESTRATOR_SCRIPT_RESULT;

  if (!repoRoot) {
    console.error('Missing required env: ORCHESTRATOR_REPO_ROOT');
    process.exit(1);
  }

  if (!shouldDelete(repoRoot)) {
    const message = `Skipped cleanup: ${repoRoot} is not under temp directory`;
    console.log(message);
    if (scriptResultPath) {
      writeFileSync(scriptResultPath, JSON.stringify({ message }), 'utf-8');
    }
    process.exit(0);
  }

  if (existsSync(repoRoot)) {
    rmSync(repoRoot, { recursive: true, force: true });
  }

  const message = `Cleaned up temp directory: ${repoRoot}`;
  console.log(message);

  if (scriptResultPath) {
    writeFileSync(scriptResultPath, JSON.stringify({ message }), 'utf-8');
  }
}
