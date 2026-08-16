import { describe, expect, it } from 'vitest';

import { ALL_PARTIAL_IDS, generatePartialFile } from '../partials-generator';

describe('partials-generator', () => {
  describe('ALL_PARTIAL_IDS', () => {
    it('is a non-empty array of strings', () => {
      expect(Array.isArray(ALL_PARTIAL_IDS)).toBe(true);
      expect(ALL_PARTIAL_IDS.length).toBeGreaterThan(0);
      for (const id of ALL_PARTIAL_IDS) {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    });

    it('is sorted alphabetically', () => {
      const sorted = [...ALL_PARTIAL_IDS].sort((a, b) => a.localeCompare(b));
      expect(ALL_PARTIAL_IDS).toEqual(sorted);
    });

    it('contains no duplicates', () => {
      expect(new Set(ALL_PARTIAL_IDS).size).toBe(ALL_PARTIAL_IDS.length);
    });

    it('uses snake_case naming', () => {
      for (const id of ALL_PARTIAL_IDS) {
        expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });

  describe('generatePartialFile', () => {
    it('returns non-empty content for each partial', () => {
      for (const id of ALL_PARTIAL_IDS) {
        const content = generatePartialFile(id);
        expect(content.trim().length).toBeGreaterThan(0);
      }
    });

    it('throws on nonexistent partial ID', () => {
      expect(() => generatePartialFile('nonexistent_partial_xyz')).toThrow();
    });

    it('returns identical content for same partial on consecutive calls', () => {
      const id = ALL_PARTIAL_IDS[0];
      expect(generatePartialFile(id)).toBe(generatePartialFile(id));
    });
  });
});
