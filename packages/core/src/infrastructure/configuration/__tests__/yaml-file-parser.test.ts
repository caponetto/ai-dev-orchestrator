import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseYamlFile } from '../yaml-file-parser';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'yaml-test-'));
}

describe('parseYamlFile', () => {
  it('parses valid YAML', () => {
    const dir = tempDir();
    const file = join(dir, 'config.yaml');
    writeFileSync(file, 'name: test\nversion: "1.0"\n');
    const result = parseYamlFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: 'test', version: '1.0' });
    }
  });

  it('returns empty object for missing file', () => {
    const result = parseYamlFile('/nonexistent/path/config.yaml');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it('returns empty object for empty file', () => {
    const dir = tempDir();
    const file = join(dir, 'empty.yaml');
    writeFileSync(file, '');
    const result = parseYamlFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it('returns error for invalid YAML syntax', () => {
    const dir = tempDir();
    const file = join(dir, 'bad.yaml');
    writeFileSync(file, 'name: test\n  invalid indent: true\n');
    const result = parseYamlFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('YAML_PARSE_ERROR');
      expect(result.error.filePath).toBe(file);
    }
  });

  it('rejects non-object YAML (scalar)', () => {
    const dir = tempDir();
    const file = join(dir, 'scalar.yaml');
    writeFileSync(file, '"just a string"');
    const result = parseYamlFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('must be a YAML mapping');
    }
  });

  it('rejects non-object YAML (array)', () => {
    const dir = tempDir();
    const file = join(dir, 'array.yaml');
    writeFileSync(file, '- item1\n- item2\n');
    const result = parseYamlFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('must be a YAML mapping');
    }
  });

  it('handles nested YAML structures', () => {
    const dir = tempDir();
    const file = join(dir, 'nested.yaml');
    writeFileSync(file, 'roles:\n  planner:\n    model: claude\n    provider: anthropic\n');
    const result = parseYamlFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        roles: { planner: { model: 'claude', provider: 'anthropic' } },
      });
    }
  });
});
