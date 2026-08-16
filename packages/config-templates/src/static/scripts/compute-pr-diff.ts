#!/usr/bin/env -S node --experimental-strip-types --experimental-detect-module
/**
 * Pre-computes the PR diff and stores it as a `pr_diff_context` artifact.
 *
 * Reads `canonical_specification` to extract PR metadata (baseRefName,
 * headRefName, prNumber), fetches the diff via local git refs or `gh pr diff`,
 * then writes the result in the FilesystemArtifactStore format so that
 * RunnerContextAssembler can resolve it for downstream reviewers.
 *
 * Expects:
 *   ORCHESTRATOR_ARTIFACTS_DIR — run artifacts directory ({runDir}/artifacts)
 *   ORCHESTRATOR_REPO_ROOT — repository root path
 *   ORCHESTRATOR_RUN_ID
 *   ORCHESTRATOR_SCRIPT_RESULT — optional path; write {"message":"..."} for chat display
 *
 * Requires: git, optional gh CLI. Node >= 22.6.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types (self-contained — no monorepo imports)
// ---------------------------------------------------------------------------

interface ChangedFile {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed';
  readonly additions?: number;
  readonly deletions?: number;
}

interface PrDiffArtifact {
  readonly version: number;
  readonly prNumber?: number;
  readonly baseRef: string;
  readonly headRef: string;
  readonly repositoryUrl?: string;
  readonly diff: string;
  readonly changedFiles: readonly ChangedFile[];
  readonly createdAt: string;
}

interface PrMetadata {
  readonly number?: number;
  readonly baseRefName?: string;
  readonly headRefName?: string;
  readonly repositoryUrl?: string;
}

interface CanonicalSpec {
  readonly prMetadata?: PrMetadata;
}

// ---------------------------------------------------------------------------
// Exported utilities (tested directly)
// ---------------------------------------------------------------------------

export function parseNumstat(numstatOutput: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const lines = numstatOutput.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!match) {
      continue;
    }

    const additions = match[1] === '-' ? undefined : parseInt(match[1], 10);
    const deletions = match[2] === '-' ? undefined : parseInt(match[2], 10);
    const rawPath = match[3];

    if (rawPath.includes('=>')) {
      const cleanPath = rawPath.replace(/\{[^}]*=> ([^}]*)\}/, '$1').trim();
      files.push({ path: cleanPath, status: 'renamed', additions, deletions });
    } else if (additions !== undefined && deletions === 0) {
      files.push({ path: rawPath, status: 'added', additions, deletions });
    } else if (additions === 0 && deletions !== undefined && deletions > 0) {
      files.push({ path: rawPath, status: 'deleted', additions, deletions });
    } else {
      files.push({ path: rawPath, status: 'modified', additions, deletions });
    }
  }

  return files;
}

export function buildPrDiffArtifact(params: {
  baseRef: string;
  headRef: string;
  prNumber?: number;
  repositoryUrl?: string;
  diff: string;
  changedFiles: readonly ChangedFile[];
}): PrDiffArtifact {
  return {
    version: 1,
    prNumber: params.prNumber,
    baseRef: params.baseRef,
    headRef: params.headRef,
    repositoryUrl: params.repositoryUrl,
    diff: params.diff,
    changedFiles: params.changedFiles,
    createdAt: new Date().toISOString(),
  };
}

export function parseUnifiedDiff(diffText: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const sections = diffText.split(/^diff --git /m).slice(1);

  for (const section of sections) {
    const headerEnd = section.indexOf('\n@@');
    const header = headerEnd === -1 ? section : section.slice(0, headerEnd);

    const pathMatch = /^a\/.+ b\/(.+)/.exec(header);
    if (!pathMatch) {
      continue;
    }
    const filePath = pathMatch[1];

    let status: ChangedFile['status'] = 'modified';
    if (header.includes('new file mode')) {
      status = 'added';
    } else if (header.includes('deleted file mode')) {
      status = 'deleted';
    } else if (header.includes('\nrename from ') || header.includes('\nrename to ')) {
      status = 'renamed';
    }

    let additions = 0;
    let deletions = 0;
    const hunkStart = section.indexOf('\n@@');
    if (hunkStart !== -1) {
      const hunkContent = section.slice(hunkStart);
      const lines = hunkContent.split('\n');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          additions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
        }
      }
    }

    files.push({ path: filePath, status, additions, deletions });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function findArtifactContent(artifactsDir: string, type: string): string | null {
  const typeDir = join(artifactsDir, type);
  if (!existsSync(typeDir)) {
    return null;
  }

  const files = readdirSync(typeDir)
    .filter((f) => f.endsWith('.md') && !f.endsWith('.meta.yaml'))
    .sort()
    .reverse();

  return files[0] ? join(typeDir, files[0]) : null;
}

function git(repoRoot: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf-8',
    timeout: 30_000,
  }).trim();
}

function ghPrDiff(prNumber: number, repoUrl: string): string {
  const repoSlug = repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  return execFileSync('gh', ['pr', 'diff', String(prNumber), '--repo', repoSlug], {
    encoding: 'utf-8',
    timeout: 30_000,
  }).trim();
}

// ---------------------------------------------------------------------------
// Main (only runs when executed as a script, not when imported for tests)
// ---------------------------------------------------------------------------

const isMainModule = process.argv[1]?.endsWith('compute-pr-diff.ts');

if (isMainModule) {
  const artifactsDir = process.env.ORCHESTRATOR_ARTIFACTS_DIR;
  const repoRoot = process.env.ORCHESTRATOR_REPO_ROOT;
  const runId = process.env.ORCHESTRATOR_RUN_ID;

  if (!artifactsDir || !repoRoot || !runId) {
    console.error(
      'Missing required env: ORCHESTRATOR_ARTIFACTS_DIR, ORCHESTRATOR_REPO_ROOT, ORCHESTRATOR_RUN_ID',
    );
    process.exit(1);
  }

  const specFile = findArtifactContent(artifactsDir, 'canonical_specification');
  if (!specFile) {
    console.error('canonical_specification artifact not found');
    process.exit(1);
  }

  const spec = JSON.parse(readFileSync(specFile, 'utf-8')) as CanonicalSpec;
  const prMeta = spec.prMetadata;

  if (!prMeta || !prMeta.baseRefName || !prMeta.headRefName) {
    console.error('prMetadata missing baseRefName or headRefName');
    process.exit(1);
  }

  const baseRef = prMeta.baseRefName;
  const headRef = prMeta.headRefName;

  let diff = '';
  let numstat = '';

  try {
    const remoteOutput = git(repoRoot, 'remote', '-v');
    const remoteName = remoteOutput.split('\n')[0]?.split(/\s/)[0] ?? 'origin';
    const remoteBranches = git(repoRoot, 'branch', '-r');

    const hasBase = remoteBranches.includes(`${remoteName}/${baseRef}`);
    const hasHead = remoteBranches.includes(`${remoteName}/${headRef}`);

    if (hasBase && hasHead) {
      diff = git(repoRoot, 'diff', `${remoteName}/${baseRef}...${remoteName}/${headRef}`);
      numstat = git(
        repoRoot,
        'diff',
        '--numstat',
        `${remoteName}/${baseRef}...${remoteName}/${headRef}`,
      );
    }
  } catch {
    // Fall through to gh CLI
  }

  if (!diff && prMeta.number && prMeta.repositoryUrl) {
    try {
      diff = ghPrDiff(prMeta.number, prMeta.repositoryUrl);
    } catch (err) {
      console.error(`gh pr diff failed: ${String(err)}`);
      process.exit(1);
    }
  }

  if (!diff) {
    console.error('Could not obtain PR diff via local git or gh CLI');
    process.exit(1);
  }

  const changedFiles = numstat ? parseNumstat(numstat) : parseUnifiedDiff(diff);
  const artifact = buildPrDiffArtifact({
    baseRef,
    headRef,
    prNumber: prMeta.number,
    repositoryUrl: prMeta.repositoryUrl,
    diff,
    changedFiles,
  });

  const content = JSON.stringify(artifact, null, 2);
  const artifactName = 'compute-pr-diff';
  const version = 1;
  const checksum = `sha256:${createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')}`;
  const createdAt = new Date().toISOString();
  const sizeBytes = Buffer.byteLength(content, 'utf8');

  const outDir = join(artifactsDir, 'pr_diff_context');
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, `${artifactName}_v${String(version)}.md`), content, 'utf-8');

  const meta = [
    `type: pr_diff_context`,
    `name: ${artifactName}`,
    `version: ${String(version)}`,
    `checksum: ${checksum}`,
    `producedBy: compute-pr-diff`,
    `predecessorRef: null`,
    `createdAt: ${createdAt}`,
    `sizeBytes: ${String(sizeBytes)}`,
    '',
  ].join('\n');
  writeFileSync(join(outDir, `${artifactName}_v${String(version)}.meta.yaml`), meta, 'utf-8');

  const totalAdditions = changedFiles.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const totalDeletions = changedFiles.reduce((sum, f) => sum + (f.deletions ?? 0), 0);
  const message = `Pre-computed PR diff: ${String(changedFiles.length)} files (+${String(totalAdditions)} -${String(totalDeletions)})`;
  console.log(message);

  const scriptResultPath = process.env.ORCHESTRATOR_SCRIPT_RESULT;
  if (scriptResultPath) {
    writeFileSync(scriptResultPath, JSON.stringify({ message }), 'utf-8');
  }
}
