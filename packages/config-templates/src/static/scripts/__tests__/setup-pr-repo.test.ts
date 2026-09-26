import { describe, expect, it } from 'vitest';

import { parseGitHubPrSource } from '../setup-pr-repo';

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
