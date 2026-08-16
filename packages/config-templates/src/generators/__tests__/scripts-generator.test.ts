import { describe, expect, it } from 'vitest';

import { ALL_SCRIPT_FILES, generateScriptFile } from '../scripts-generator';

describe('scripts-generator', () => {
  describe('ALL_SCRIPT_FILES', () => {
    it('is a non-empty array of strings', () => {
      expect(Array.isArray(ALL_SCRIPT_FILES)).toBe(true);
      expect(ALL_SCRIPT_FILES.length).toBeGreaterThan(0);
      for (const name of ALL_SCRIPT_FILES) {
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it('is sorted alphabetically', () => {
      const sorted = [...ALL_SCRIPT_FILES].sort((a, b) => a.localeCompare(b));
      expect(ALL_SCRIPT_FILES).toEqual(sorted);
    });

    it('contains no duplicates', () => {
      expect(new Set(ALL_SCRIPT_FILES).size).toBe(ALL_SCRIPT_FILES.length);
    });

    it('only contains .ts files', () => {
      for (const name of ALL_SCRIPT_FILES) {
        expect(name).toMatch(/\.ts$/);
      }
    });

    it('excludes test files', () => {
      for (const name of ALL_SCRIPT_FILES) {
        expect(name).not.toMatch(/\.test\.ts$/);
      }
    });

    it('uses kebab-case naming', () => {
      for (const name of ALL_SCRIPT_FILES) {
        expect(name).toMatch(/^[a-z][a-z0-9-]*\.ts$/);
      }
    });

    it('includes the review-findings-writer script', () => {
      expect(ALL_SCRIPT_FILES).toContain('review-findings-writer.ts');
    });
  });

  describe('generateScriptFile', () => {
    it('returns non-empty content for each script', () => {
      for (const name of ALL_SCRIPT_FILES) {
        const content = generateScriptFile(name);
        expect(content.length).toBeGreaterThan(0);
      }
    });

    it('returns valid TypeScript source (contains export or import)', () => {
      for (const name of ALL_SCRIPT_FILES) {
        const content = generateScriptFile(name);
        expect(content).toMatch(/\b(import|export)\b/);
      }
    });

    it('scripts are self-contained (no @ai-orchestrator imports)', () => {
      for (const name of ALL_SCRIPT_FILES) {
        const content = generateScriptFile(name);
        expect(content).not.toContain('@ai-orchestrator/');
      }
    });

    it('throws on nonexistent script name', () => {
      expect(() => generateScriptFile('nonexistent-script.ts')).toThrow();
    });

    it('returns identical content on consecutive calls', () => {
      const name = ALL_SCRIPT_FILES[0];
      expect(name).toBeDefined();
      expect(generateScriptFile(name)).toBe(generateScriptFile(name));
    });
  });
});
