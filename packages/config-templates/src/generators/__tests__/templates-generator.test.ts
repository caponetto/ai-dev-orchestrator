import { describe, expect, it } from 'vitest';

import { ALL_ROLE_IDS, generateTemplateFile } from '../templates-generator';

describe('templates-generator', () => {
  describe('ALL_ROLE_IDS', () => {
    it('is a non-empty array of strings', () => {
      expect(Array.isArray(ALL_ROLE_IDS)).toBe(true);
      expect(ALL_ROLE_IDS.length).toBeGreaterThan(0);
      for (const id of ALL_ROLE_IDS) {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    });

    it('is sorted alphabetically', () => {
      const sorted = [...ALL_ROLE_IDS].sort((a, b) => a.localeCompare(b));
      expect(ALL_ROLE_IDS).toEqual(sorted);
    });

    it('contains no duplicates', () => {
      expect(new Set(ALL_ROLE_IDS).size).toBe(ALL_ROLE_IDS.length);
    });

    it('uses snake_case naming', () => {
      for (const id of ALL_ROLE_IDS) {
        expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });

  describe('generateTemplateFile', () => {
    it('returns content with YAML frontmatter', () => {
      const content = generateTemplateFile(ALL_ROLE_IDS[0]);
      expect(content).toMatch(/^---\n/);
      expect(content).toContain('---');
    });

    it('includes role identifier in frontmatter', () => {
      for (const roleId of ALL_ROLE_IDS) {
        const content = generateTemplateFile(roleId);
        expect(content).toContain(`role: ${roleId}`);
      }
    });

    it('includes version in frontmatter', () => {
      for (const roleId of ALL_ROLE_IDS) {
        const content = generateTemplateFile(roleId);
        expect(content).toContain('version:');
      }
    });

    it('contains non-empty body after frontmatter', () => {
      for (const roleId of ALL_ROLE_IDS) {
        const content = generateTemplateFile(roleId);
        const parts = content.split('---');
        expect(parts.length).toBeGreaterThanOrEqual(3);
        const body = parts.slice(2).join('---').trim();
        expect(body.length).toBeGreaterThan(0);
      }
    });

    it('throws on nonexistent role ID', () => {
      expect(() => generateTemplateFile('nonexistent_role_xyz')).toThrow();
    });

    it('returns identical content for same role on consecutive calls', () => {
      const roleId = ALL_ROLE_IDS[0];
      expect(generateTemplateFile(roleId)).toBe(generateTemplateFile(roleId));
    });
  });
});
