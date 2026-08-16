import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  FRONTMATTER_REGEX,
  parseArtifactContent,
  parseFrontmatter,
  parseJson,
  parseYaml,
  safeJsonParse,
} from '../content-parser';

describe('safeJsonParse', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('parses valid JSON matching the schema', () => {
    const result = safeJsonParse('{"name":"Alice","age":30}', schema);
    expect(result).toEqual({ success: true, data: { name: 'Alice', age: 30 } });
  });

  it('returns error for invalid JSON syntax', () => {
    const result = safeJsonParse('{bad json}', schema);
    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('Expected');
  });

  it('returns error when JSON does not match schema', () => {
    const result = safeJsonParse('{"name":"Alice","age":"thirty"}', schema);
    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('age');
  });

  it('returns error for empty string', () => {
    const result = safeJsonParse('', schema);
    expect(result.success).toBe(false);
  });

  it('strips unknown keys via default Zod behavior', () => {
    const result = safeJsonParse('{"name":"Bob","age":25,"extra":"ignored"}', schema);
    expect(result.success).toBe(true);
    expect((result as { data: unknown }).data).toEqual({ name: 'Bob', age: 25 });
  });

  it('preserves unknown keys with loose schema', () => {
    const loose = schema.loose();
    const result = safeJsonParse('{"name":"Bob","age":25,"extra":"kept"}', loose);
    expect(result.success).toBe(true);
    expect((result as { data: Record<string, unknown> }).data).toHaveProperty('extra', 'kept');
  });
});

describe('FRONTMATTER_REGEX', () => {
  it('matches YAML frontmatter delimited by ---', () => {
    const content = '---\ntitle: hello\n---\nbody text';
    const match = FRONTMATTER_REGEX.exec(content);
    expect(match?.[1]).toBe('title: hello');
  });

  it('does not match when frontmatter is absent', () => {
    expect(FRONTMATTER_REGEX.exec('no frontmatter here')).toBeNull();
  });

  it('does not match incomplete delimiters', () => {
    expect(FRONTMATTER_REGEX.exec('---\ntitle: hello\nbody')).toBeNull();
  });
});

describe('parseFrontmatter', () => {
  it('extracts YAML frontmatter as an object', () => {
    const content = '---\nversion: 1\nstatus: draft\n---\n# Document body';
    expect(parseFrontmatter(content)).toEqual({ version: 1, status: 'draft' });
  });

  it('returns null when no frontmatter is present', () => {
    expect(parseFrontmatter('just plain text')).toBeNull();
  });

  it('returns null for malformed YAML in frontmatter', () => {
    const content = '---\n: [invalid yaml\n---\nbody';
    expect(parseFrontmatter(content)).toBeNull();
  });

  it('handles empty frontmatter block', () => {
    const content = '---\n\n---\nbody';
    expect(parseFrontmatter(content)).toBeNull();
  });

  it('handles multiline values in frontmatter', () => {
    const content = '---\ntitle: hello\ndescription: line one\ntags:\n  - a\n  - b\n---\nbody';
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      title: 'hello',
      description: 'line one',
      tags: ['a', 'b'],
    });
  });
});

describe('parseJson', () => {
  it('parses valid JSON into a record', () => {
    expect(parseJson('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('returns null for invalid JSON', () => {
    expect(parseJson('not json')).toBeNull();
  });

  it('returns null for JSON arrays', () => {
    expect(parseJson('[1, 2, 3]')).toBeNull();
  });

  it('returns null for JSON primitives', () => {
    expect(parseJson('"just a string"')).toBeNull();
  });

  it('handles nested objects', () => {
    const result = parseJson('{"a":{"b":1}}');
    expect(result).toEqual({ a: { b: 1 } });
  });
});

describe('parseYaml', () => {
  it('parses valid YAML into a record', () => {
    expect(parseYaml('key: value\ncount: 3')).toEqual({ key: 'value', count: 3 });
  });

  it('returns null for invalid YAML', () => {
    expect(parseYaml(':\n  - [invalid')).toBeNull();
  });

  it('handles YAML with nested structures', () => {
    const yaml = 'parent:\n  child: value\n  list:\n    - a\n    - b';
    expect(parseYaml(yaml)).toEqual({
      parent: { child: 'value', list: ['a', 'b'] },
    });
  });
});

describe('parseArtifactContent', () => {
  it('prefers frontmatter over JSON', () => {
    const content = '---\nsource: frontmatter\n---\n{"source":"json"}';
    expect(parseArtifactContent(content)).toEqual({ source: 'frontmatter' });
  });

  it('falls back to JSON when no frontmatter is present', () => {
    expect(parseArtifactContent('{"source":"json"}')).toEqual({ source: 'json' });
  });

  it('returns null when neither format is parseable', () => {
    expect(parseArtifactContent('plain text with no structure')).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parseArtifactContent('')).toBeNull();
  });
});
