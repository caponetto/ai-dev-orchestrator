import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseSourceReference, resolveIntakeSources } from '../intake-router';

describe('resolveIntakeSources', () => {
  it('converts a single-line source to IntermediateRequirements', () => {
    const result = resolveIntakeSources(['Build a login page']);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Build a login page');
    expect(result[0].description).toBeUndefined();
  });

  it('uses the first line as title for multi-line sources', () => {
    const source = 'Build a login page\nWith OAuth support\nAnd MFA';
    const result = resolveIntakeSources([source]);
    expect(result[0].title).toBe('Build a login page');
    expect(result[0].description).toBe(source.trim());
  });

  it('generates a sha256 checksum from the raw input', () => {
    const raw = 'Build a feature';
    const result = resolveIntakeSources([raw]);
    const expectedHash = createHash('sha256').update(raw).digest('hex');
    expect(result[0].sourceMetadata.checksum).toBe(`sha256:${expectedHash}`);
  });

  it('sets fetchedAt as an ISO timestamp', () => {
    const result = resolveIntakeSources(['task']);
    expect(result[0].sourceMetadata.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('handles multiple sources independently', () => {
    const result = resolveIntakeSources(['Task A', 'Task B', 'Task C']);
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('Task A');
    expect(result[1].title).toBe('Task B');
    expect(result[2].title).toBe('Task C');
  });

  it('trims whitespace from lines', () => {
    const result = resolveIntakeSources(['  padded title  ']);
    expect(result[0].title).toBe('padded title');
  });

  it('skips blank lines in multi-line input', () => {
    const result = resolveIntakeSources(['Title\n\n\nDetail']);
    expect(result[0].title).toBe('Title');
    expect(result[0].description).toBeDefined();
  });

  it('returns empty array for empty input', () => {
    const result = resolveIntakeSources([]);
    expect(result).toHaveLength(0);
  });

  it('handles source with only whitespace', () => {
    const result = resolveIntakeSources(['   ']);
    expect(result[0].title).toBe('');
  });

  it('parses github PR source into structured metadata', () => {
    const result = resolveIntakeSources(['github:owner/repo#42']);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('PR #42 in owner/repo');
    expect(result[0].rawFields).toEqual({
      sourceType: 'github_pr',
      owner: 'owner',
      repo: 'repo',
      prNumber: 42,
      baseBranch: undefined,
    });
  });

  it('parses github PR source with base branch', () => {
    const result = resolveIntakeSources(['github:org/project#100@main']);
    expect(result[0].title).toBe('PR #100 in org/project');
    expect(result[0].rawFields).toEqual({
      sourceType: 'github_pr',
      owner: 'org',
      repo: 'project',
      prNumber: 100,
      baseBranch: 'main',
    });
    expect(result[0].description).toBe('Base branch: main');
  });

  it('parses github issue source into structured metadata', () => {
    const result = resolveIntakeSources(['github-issue:myorg/myrepo#7']);
    expect(result[0].title).toBe('Issue #7 in myorg/myrepo');
    expect(result[0].rawFields).toEqual({
      sourceType: 'github_issue',
      owner: 'myorg',
      repo: 'myrepo',
      issueNumber: 7,
    });
  });

  it('falls back to plain text for unrecognized sources', () => {
    const result = resolveIntakeSources(['Fix the login bug']);
    expect(result[0].rawFields).toEqual({ sourceType: 'plain_text' });
    expect(result[0].title).toBe('Fix the login bug');
  });
});

describe('parseSourceReference', () => {
  it('recognizes github PR format', () => {
    const ref = parseSourceReference('github:facebook/react#12345');
    expect(ref.type).toBe('github_pr');
    expect(ref.owner).toBe('facebook');
    expect(ref.repo).toBe('react');
    expect(ref.number).toBe(12345);
  });

  it('recognizes github PR format with base branch', () => {
    const ref = parseSourceReference('github:org/repo#1@develop');
    expect(ref.type).toBe('github_pr');
    expect(ref.ref).toBe('develop');
  });

  it('recognizes github issue format', () => {
    const ref = parseSourceReference('github-issue:org/repo#99');
    expect(ref.type).toBe('github_issue');
    expect(ref.owner).toBe('org');
    expect(ref.repo).toBe('repo');
    expect(ref.number).toBe(99);
  });

  it('returns plain_text for unrecognized format', () => {
    const ref = parseSourceReference('just some text');
    expect(ref.type).toBe('plain_text');
    expect(ref.raw).toBe('just some text');
  });

  it('trims whitespace before matching', () => {
    const ref = parseSourceReference('  github:owner/repo#5  ');
    expect(ref.type).toBe('github_pr');
    expect(ref.number).toBe(5);
  });
});
