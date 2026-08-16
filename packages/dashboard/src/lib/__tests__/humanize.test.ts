import { describe, expect, it } from 'vitest';

import { formatArtifactDisplayName, humanize } from '../humanize';

describe('humanize', () => {
  it('converts camelCase to Title Case', () => {
    expect(humanize('camelCase')).toBe('Camel Case');
  });

  it('converts snake_case to Title Case', () => {
    expect(humanize('snake_case')).toBe('Snake Case');
  });

  it('converts kebab-case to Title Case', () => {
    expect(humanize('kebab-case')).toBe('Kebab Case');
  });

  it('converts UPPER_CASE to Title Case', () => {
    expect(humanize('UPPER_CASE')).toBe('Upper Case');
  });

  it('handles single word', () => {
    expect(humanize('hello')).toBe('Hello');
  });

  it('handles already Title Case', () => {
    expect(humanize('Hello World')).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(humanize('')).toBe('');
  });

  it('handles multi-part camelCase', () => {
    expect(humanize('myLongVariableName')).toBe('My Long Variable Name');
  });

  it('preserves known acronyms', () => {
    expect(humanize('API')).toBe('API');
    expect(humanize('ux_reviewer')).toBe('UX Reviewer');
    expect(humanize('CI')).toBe('CI');
  });

  it('title-cases unknown all-caps words', () => {
    expect(humanize('UNKNOWN_ABBREV')).toBe('Unknown Abbrev');
  });
});

describe('formatArtifactDisplayName', () => {
  it('formats type and version', () => {
    expect(
      formatArtifactDisplayName({ type: 'canonical_specification', name: 'spec', version: 1 }),
    ).toBe('Canonical Specification v1');
  });

  it('handles camelCase type', () => {
    expect(formatArtifactDisplayName({ type: 'judgeDecision', name: 'decision', version: 3 })).toBe(
      'Judge Decision v3',
    );
  });

  it('handles version 0', () => {
    expect(formatArtifactDisplayName({ type: 'plan', name: 'main', version: 0 })).toBe('Plan v0');
  });
});
