import type { OutputContract } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { validateOutput } from '../output-validator';

function makeContract(
  format: OutputContract['format'] = 'json',
  artifactType: OutputContract['artifactType'] = 'static_review',
  schemaProvided = false,
): OutputContract {
  return {
    role: 'test',
    artifactType,
    schema: schemaProvided ? { type: 'object' } : {},
    format,
    required: true,
    repairEnabled: false,
    maxRepairAttempts: 0,
  };
}

const VALID_REVIEW_JSON = JSON.stringify({
  version: 1,
  approved: true,
  summary: 'Looks good',
  findings: [],
  createdAt: '2026-01-01T00:00:00Z',
});

describe('validateOutput', () => {
  it('accepts any output for freeform format', () => {
    const result = validateOutput('anything goes', makeContract('freeform'));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts valid JSON output with empty schema (no schema validation)', () => {
    const result = validateOutput('{"key": "value"}', makeContract('json'));
    expect(result.valid).toBe(true);
  });

  it('rejects invalid JSON output', () => {
    const result = validateOutput('not json', makeContract('json'));
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('not valid JSON');
  });

  it('accepts JSON wrapped in markdown code fences', () => {
    const fenced = '```json\n{"key": "value"}\n```';
    const result = validateOutput(fenced, makeContract('json'));
    expect(result.valid).toBe(true);
    expect(result.parsedContent).toEqual({ key: 'value' });
  });

  it('accepts JSON wrapped in untyped code fences', () => {
    const fenced = '```\n{"key": "value"}\n```';
    const result = validateOutput(fenced, makeContract('json'));
    expect(result.valid).toBe(true);
    expect(result.parsedContent).toEqual({ key: 'value' });
  });

  it('strips code fences and validates against schema', () => {
    const fenced = '```json\n' + VALID_REVIEW_JSON + '\n```';
    const result = validateOutput(fenced, makeContract('json', 'static_review', true));
    expect(result.valid).toBe(true);
  });

  it('validates JSON against Zod schema for artifact type', () => {
    const valid = validateOutput(VALID_REVIEW_JSON, makeContract('json', 'static_review', true));
    expect(valid.valid).toBe(true);

    const invalid = validateOutput('{"version": 1}', makeContract('json', 'static_review', true));
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  it('returns parsedContent for valid JSON', () => {
    const result = validateOutput('{"a": 1}', makeContract('json'));
    expect(result.parsedContent).toEqual({ a: 1 });
  });

  it('accepts markdown_with_frontmatter with valid delimiters and empty schema', () => {
    const output = '---\ntitle: Test\n---\n# Body';
    const result = validateOutput(output, makeContract('markdown_with_frontmatter'));
    expect(result.valid).toBe(true);
    expect(result.parsedContent).toEqual({ title: 'Test' });
  });

  it('validates markdown_with_frontmatter against Zod schema', () => {
    const frontmatter = [
      '---',
      'version: 1',
      'approved: true',
      'summary: All clear',
      'findings: []',
      'createdAt: "2026-01-01T00:00:00Z"',
      '---',
      '# Body',
    ].join('\n');
    const valid = validateOutput(
      frontmatter,
      makeContract('markdown_with_frontmatter', 'static_review', true),
    );
    expect(valid.valid).toBe(true);
    expect(valid.parsedContent).toEqual({
      version: 1,
      approved: true,
      summary: 'All clear',
      findings: [],
      createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('rejects markdown_with_frontmatter when required fields are missing', () => {
    const result = validateOutput(
      '---\nversion: 1\n---\n# Body',
      makeContract('markdown_with_frontmatter', 'static_review', true),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects markdown_with_frontmatter without opening delimiter', () => {
    const result = validateOutput('no frontmatter', makeContract('markdown_with_frontmatter'));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('frontmatter delimiter');
  });

  it('rejects markdown_with_frontmatter without closing delimiter', () => {
    const result = validateOutput(
      '---\ntitle: Test\nno closing',
      makeContract('markdown_with_frontmatter'),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('closing');
  });

  it('returns detailed validation errors from Zod schema', () => {
    const result = validateOutput(
      '{"version": "not a number"}',
      makeContract('json', 'static_review', true),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  describe('artifact content normalization', () => {
    it('coerces string numbers to numbers', () => {
      const input = JSON.stringify({
        version: '1',
        approved: true,
        summary: 'Looks good',
        findings: [],
        createdAt: '2026-01-01T00:00:00Z',
      });
      const result = validateOutput(input, makeContract('json', 'static_review', true));
      expect(result.valid).toBe(true);
      expect(result.parsedContent?.['version']).toBe(1);
    });

    it('coerces string booleans to booleans', () => {
      const input = JSON.stringify({
        version: 1,
        approved: 'true',
        summary: 'Looks good',
        findings: [],
        createdAt: '2026-01-01T00:00:00Z',
      });
      const result = validateOutput(input, makeContract('json', 'static_review', true));
      expect(result.valid).toBe(true);
      expect(result.parsedContent?.['approved']).toBe(true);
    });

    it('coerces multiple fields at once', () => {
      const input = JSON.stringify({
        version: '1',
        approved: 'false',
        summary: 'Issues found',
        findings: [],
        createdAt: '2026-01-01T00:00:00Z',
      });
      const result = validateOutput(input, makeContract('json', 'static_review', true));
      expect(result.valid).toBe(true);
      expect(result.parsedContent?.['version']).toBe(1);
      expect(result.parsedContent?.['approved']).toBe(false);
    });

    it('coerces nested number fields in plan artifacts', () => {
      const input = JSON.stringify({
        version: '2',
        specificationRef: { type: 'canonical_specification', name: 'spec', version: '3' },
        createdAt: '2026-01-01T00:00:00Z',
        summary: 'Plan summary',
        tasks: [{ taskId: 'T1', description: 'Task 1', files: ['a.ts'], dependencies: [] }],
      });
      const result = validateOutput(input, makeContract('json', 'plan', true));
      expect(result.valid).toBe(true);
      expect(result.parsedContent?.['version']).toBe(2);
    });

    it('still rejects genuinely invalid data after normalization attempt', () => {
      const input = JSON.stringify({
        version: 'not-a-number',
        approved: true,
        summary: 'Looks good',
        findings: [],
        createdAt: '2026-01-01T00:00:00Z',
      });
      const result = validateOutput(input, makeContract('json', 'static_review', true));
      expect(result.valid).toBe(false);
    });

    it('normalizes markdown_with_frontmatter content', () => {
      const frontmatter = [
        '---',
        'version: "1"',
        'approved: "true"',
        'summary: All clear',
        'findings: []',
        'createdAt: "2026-01-01T00:00:00Z"',
        '---',
        '# Body',
      ].join('\n');
      const result = validateOutput(
        frontmatter,
        makeContract('markdown_with_frontmatter', 'static_review', true),
      );
      expect(result.valid).toBe(true);
      expect(result.parsedContent?.['version']).toBe(1);
      expect(result.parsedContent?.['approved']).toBe(true);
    });
  });
});
