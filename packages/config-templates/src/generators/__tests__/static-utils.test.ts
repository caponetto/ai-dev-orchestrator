import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { PARTIALS_DIR, ROLES_DIR, TEMPLATES_DIR, WORKFLOWS_DIR } from '../../paths';
import { configSchema } from '../../schemas/static-schemas';
import {
  listStaticFiles,
  readAndValidateStaticYaml,
  readStaticFile,
  stringifyYaml,
} from '../static-utils';

describe('static-utils', () => {
  describe('stringifyYaml', () => {
    it('serializes a simple object to valid YAML', () => {
      const input = { name: 'test', version: '1.0' };
      const result = stringifyYaml(input);
      const parsed = parseYaml(result) as Record<string, unknown>;
      expect(parsed).toEqual(input);
    });

    it('serializes nested objects preserving structure', () => {
      const input = {
        parent: {
          child: { key: 'value' },
          list: [1, 2, 3],
        },
      };
      const result = stringifyYaml(input);
      const parsed = parseYaml(result) as Record<string, unknown>;
      expect(parsed).toEqual(input);
    });

    it('serializes arrays at the top level', () => {
      const input = [{ id: 'a' }, { id: 'b' }];
      const result = stringifyYaml(input);
      const parsed = parseYaml(result) as Array<Record<string, unknown>>;
      expect(parsed).toEqual(input);
    });

    it('handles null and undefined values', () => {
      const input = { key: null, other: 'value' };
      const result = stringifyYaml(input);
      const parsed = parseYaml(result) as Record<string, unknown>;
      expect(parsed).toEqual({ key: null, other: 'value' });
    });

    it('handles empty objects', () => {
      const result = stringifyYaml({});
      const parsed = parseYaml(result) as Record<string, unknown>;
      expect(parsed).toEqual({});
    });

    it('handles boolean values', () => {
      const input = { enabled: true, disabled: false };
      const result = stringifyYaml(input);
      const parsed = parseYaml(result) as Record<string, unknown>;
      expect(parsed).toEqual(input);
    });

    it('handles numeric values', () => {
      const input = { integer: 42, float: 3.14, negative: -1 };
      const result = stringifyYaml(input);
      const parsed = parseYaml(result) as Record<string, unknown>;
      expect(parsed).toEqual(input);
    });

    it('returns a string', () => {
      expect(typeof stringifyYaml({ key: 'value' })).toBe('string');
    });

    it('handles deeply nested structures', () => {
      const input = { a: { b: { c: { d: { e: 'deep' } } } } };
      const result = stringifyYaml(input);
      const parsed = parseYaml(result) as Record<string, unknown>;
      expect(parsed).toEqual(input);
    });
  });

  describe('listStaticFiles', () => {
    it('lists files with extension stripped by default', () => {
      const result = listStaticFiles(TEMPLATES_DIR, '.md');
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((f) => !f.endsWith('.md'))).toBe(true);
    });

    it('lists files without stripping extension when stripExtension is false', () => {
      const result = listStaticFiles(ROLES_DIR, '.yaml', false);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((f) => f.endsWith('.yaml'))).toBe(true);
    });

    it('returns sorted results', () => {
      const result = listStaticFiles(TEMPLATES_DIR, '.md');
      expect(result).toEqual([...result].sort());
    });

    it('filters by extension', () => {
      const mdFiles = listStaticFiles(PARTIALS_DIR, '.md');
      const yamlFiles = listStaticFiles(PARTIALS_DIR, '.yaml');
      expect(mdFiles.length).toBeGreaterThan(0);
      expect(yamlFiles.length).toBe(0);
    });

    it('returns consistent results across calls', () => {
      const first = listStaticFiles(WORKFLOWS_DIR, '.yaml');
      const second = listStaticFiles(WORKFLOWS_DIR, '.yaml');
      expect(first).toEqual(second);
    });
  });

  describe('readStaticFile', () => {
    it('reads a file from a subdirectory', () => {
      const content = readStaticFile(PARTIALS_DIR, 'agent_time_management.md');
      expect(content).toBeTruthy();
      expect(typeof content).toBe('string');
    });

    it('reads a root-level file when subdir is empty', () => {
      const content = readStaticFile('', 'config.yaml');
      expect(content).toBeTruthy();
      expect(typeof content).toBe('string');
    });

    it('throws for nonexistent files', () => {
      expect(() => readStaticFile(PARTIALS_DIR, 'nonexistent.md')).toThrow();
    });
  });

  describe('readAndValidateStaticYaml', () => {
    it('returns content and validated data', () => {
      const result = readAndValidateStaticYaml(configSchema, '', 'config.yaml');
      expect(typeof result.content).toBe('string');
      expect(result.data).toBeDefined();
      expect(result.data.log_level).toBeDefined();
      expect(result.data.default_workflow).toBeDefined();
    });

    it('throws StaticFileValidationError for invalid data', () => {
      const badSchema = configSchema.extend({
        nonexistent_required_field: configSchema.shape.log_level,
      });
      expect(() => readAndValidateStaticYaml(badSchema, '', 'config.yaml')).toThrow(
        /Invalid config\.yaml/,
      );
    });

    it('includes subdir in error label', () => {
      const badSchema = configSchema.extend({
        nonexistent_required_field: configSchema.shape.log_level,
      });
      expect(() => readAndValidateStaticYaml(badSchema, ROLES_DIR, 'implementer.yaml')).toThrow(
        /Invalid roles\/implementer\.yaml/,
      );
    });
  });
});
