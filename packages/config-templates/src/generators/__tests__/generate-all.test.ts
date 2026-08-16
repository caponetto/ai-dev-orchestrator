import { describe, expect, it } from 'vitest';

import { generateAll, generateGlobalFiles } from '../../generate-all';

describe('generateAll', () => {
  const files = generateAll();

  it('returns a non-empty Map', () => {
    expect(files.size).toBeGreaterThan(0);
  });

  it('includes config, roles, governance, and runners files', () => {
    expect(files.has('config.yaml')).toBe(true);
    expect(files.has('roles.yaml')).toBe(true);
    expect(files.has('governance.yaml')).toBe(true);
    expect(files.has('runners.yaml')).toBe(true);
  });

  it('includes template files under templates/ prefix', () => {
    const templateKeys = [...files.keys()].filter((k) => k.startsWith('templates/'));
    expect(templateKeys.length).toBeGreaterThan(0);
    for (const key of templateKeys) {
      expect(key).toMatch(/^templates\/.*\.md$/);
    }
  });

  it('includes partial files under templates/partials/ prefix', () => {
    const partialKeys = [...files.keys()].filter((k) => k.startsWith('templates/partials/'));
    expect(partialKeys.length).toBeGreaterThan(0);
    for (const key of partialKeys) {
      expect(key).toMatch(/^templates\/partials\/.*\.md$/);
    }
  });

  it('includes script files under scripts/ prefix', () => {
    const scriptKeys = [...files.keys()].filter((k) => k.startsWith('scripts/'));
    expect(scriptKeys.length).toBeGreaterThan(0);
  });

  it('has non-empty string values for every entry', () => {
    for (const [key, value] of files) {
      expect(value, `expected non-empty string for "${key}"`).toBeTruthy();
      expect(typeof value).toBe('string');
      expect(value.length, `expected non-empty content for "${key}"`).toBeGreaterThan(0);
    }
  });
});

describe('generateGlobalFiles', () => {
  const files = generateGlobalFiles();

  it('returns an empty Map', () => {
    expect(files.size).toBe(0);
  });
});
