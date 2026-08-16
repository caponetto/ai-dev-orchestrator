#!/usr/bin/env -S node --experimental-strip-types --experimental-detect-module
/**
 * Clones a PR's repository and checks out the PR branch into a temp directory.
 *
 * Reads the source reference from ORCHESTRATOR_USER_PROMPT (e.g. github:owner/repo#123
 * or https://github.com/owner/repo/pull/123),
 * uses `gh` CLI to resolve the PR branch and clone the repo, then communicates the
 * temp directory path back to the engine via ORCHESTRATOR_SCRIPT_RESULT directives.
 *
 * Expects:
 *   ORCHESTRATOR_USER_PROMPT — source reference (github:owner/repo#NNN or GitHub PR URL)
 *   ORCHESTRATOR_SCRIPT_RESULT — path to write output JSON
 *
 * Requires: gh CLI authenticated, git, Node >= 22.6
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TEMP_DIR_PREFIX } from './pr-review-constants.ts';

const GITHUB_PR_SHORTHAND = /^github:([^/]+)\/([^#]+)#(\d+)(?:@(.+))?$/;
const GITHUB_PR_URL = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?(?:[?#].*)?$/;

export interface GitHubPrSource {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
}

export function parseGitHubPrSource(input: string): GitHubPrSource | null {
  const trimmed = input.trim();
  const match = GITHUB_PR_SHORTHAND.exec(trimmed) ?? GITHUB_PR_URL.exec(trimmed);
  if (!match) {
    return null;
  }
  return {
    owner: match[1],
    repo: match[2],
    prNumber: Number(match[3]),
  };
}

// ---------------------------------------------------------------------------
// Main (only runs when executed as a script, not when imported for tests)
// ---------------------------------------------------------------------------

const isMainModule = process.argv[1]?.endsWith('setup-pr-repo.ts');

if (isMainModule) {
  const userPrompt = process.env.ORCHESTRATOR_USER_PROMPT;
  const scriptResultPath = process.env.ORCHESTRATOR_SCRIPT_RESULT;

  if (!userPrompt) {
    console.error('Missing required env: ORCHESTRATOR_USER_PROMPT');
    process.exit(1);
  }

  const source = parseGitHubPrSource(userPrompt);
  if (!source) {
    console.error(
      `Invalid source reference: expected github:owner/repo#NNN or GitHub PR URL, got: ${userPrompt}`,
    );
    process.exit(1);
  }

  const repoSlug = `${source.owner}/${source.repo}`;

  const tempDir = mkdtempSync(join(tmpdir(), `${TEMP_DIR_PREFIX}${source.owner}-${source.repo}-`));

  try {
    execFileSync('gh', ['repo', 'clone', repoSlug, tempDir], {
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // gh pr checkout handles forks automatically: adds the fork as a remote,
    // fetches the branch, and checks it out.
    execFileSync('gh', ['pr', 'checkout', String(source.prNumber), '--repo', repoSlug], {
      encoding: 'utf-8',
      timeout: 60_000,
      cwd: tempDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.error(`Failed to clone/checkout: ${String(err)}`);
    process.exit(1);
  }

  const message = `Cloned ${repoSlug} and checked out PR #${String(source.prNumber)} at ${tempDir}`;
  console.log(message);

  if (scriptResultPath) {
    writeFileSync(
      scriptResultPath,
      JSON.stringify({
        message,
        directives: { repoRoot: tempDir },
      }),
      'utf-8',
    );
  }
}
