import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseGitHubPrSource } from '../setup-pr-repo';

it.each(['clone', 'checkout', 'result'] as const)(
  'removes its temporary clone if %s fails before repoRoot can be checkpointed',
  (stage) => {
    const root = mkdtempSync(join(tmpdir(), 'pr-setup-failure-'));
    try {
      const executable = join(root, 'gh');
      writeFileSync(
        executable,
        stage === 'clone'
          ? '#!/bin/sh\nexit 1\n'
          : stage === 'checkout'
            ? '#!/bin/sh\n[ \"$1\" != pr ]\n'
            : '#!/bin/sh\nexit 0\n',
      );
      chmodSync(executable, 0o755);
      const result = spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          fileURLToPath(new URL('../setup-pr-repo.ts', import.meta.url)),
        ],
        {
          env: {
            ...process.env,
            TMPDIR: root,
            PATH: `${root}:${process.env.PATH ?? ''}`,
            ORCHESTRATOR_USER_PROMPT: 'github:acme/widgets#42',
            ...(stage === 'result'
              ? { ORCHESTRATOR_SCRIPT_RESULT: join(root, 'missing', 'result.json') }
              : {}),
          },
          encoding: 'utf8',
          timeout: 10_000,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Failed to clone/checkout');
      expect(readdirSync(root)).toEqual(['gh']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

describe('parseGitHubPrSource', () => {
  it('parses github:owner/repo#123', () => {
    const result = parseGitHubPrSource('github:acme/widgets#42');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets', prNumber: 42 });
  });

  it('parses github:owner/repo#123 with optional @base-branch', () => {
    const result = parseGitHubPrSource('github:acme/widgets#42@main');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets', prNumber: 42 });
  });

  it('parses https://github.com/owner/repo/pull/123', () => {
    const result = parseGitHubPrSource('https://github.com/opendatahub-io/elyra/pull/179');
    expect(result).toEqual({ owner: 'opendatahub-io', repo: 'elyra', prNumber: 179 });
  });

  it('extracts a PR URL from a prompt and ignores other URLs', () => {
    const result = parseGitHubPrSource(
      'Review https://github.com/opendatahub-io/odh-dashboard/pull/9863 considering https://gist.githubusercontent.com/user/id/raw/review.md',
    );
    expect(result).toEqual({ owner: 'opendatahub-io', repo: 'odh-dashboard', prNumber: 9863 });
  });

  it('parses GitHub PR URL with trailing slash', () => {
    const result = parseGitHubPrSource('https://github.com/acme/widgets/pull/42/');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets', prNumber: 42 });
  });

  it('parses GitHub PR URL with query params', () => {
    const result = parseGitHubPrSource('https://github.com/acme/widgets/pull/42?diff=split');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets', prNumber: 42 });
  });

  it('returns null for plain text', () => {
    expect(parseGitHubPrSource('fix the login bug')).toBeNull();
  });

  it('returns null for github-issue: source', () => {
    expect(parseGitHubPrSource('github-issue:acme/widgets#42')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseGitHubPrSource('')).toBeNull();
  });

  it('returns null for github: without PR number', () => {
    expect(parseGitHubPrSource('github:acme/widgets')).toBeNull();
  });

  it('trims whitespace before parsing', () => {
    const result = parseGitHubPrSource('  github:acme/widgets#42  ');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets', prNumber: 42 });
  });
});
