import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { generateRunnersYaml, loadRunnerRegistry } from '../runner-registry';

describe('runner-registry', () => {
  describe('loadRunnerRegistry', () => {
    it('returns an array of runner entries', () => {
      const runners = loadRunnerRegistry();
      expect(Array.isArray(runners)).toBe(true);
      expect(runners.length).toBeGreaterThan(0);
    });

    it('each runner has id, name, and models', () => {
      const runners = loadRunnerRegistry();
      for (const runner of runners) {
        expect(runner.id).toBeTruthy();
        expect(runner.name).toBeTruthy();
        expect(Array.isArray(runner.models)).toBe(true);
        expect(runner.models.length).toBeGreaterThan(0);
      }
    });

    it('all runner IDs are unique', () => {
      const runners = loadRunnerRegistry();
      const ids = runners.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('contains known runners', () => {
      const runners = loadRunnerRegistry();
      const ids = runners.map((r) => r.id);
      expect(ids).toContain('cursor');
      expect(ids).toContain('claude-code');
    });

    it('cursor runner has at least one model', () => {
      const runners = loadRunnerRegistry();
      const cursor = runners.find((r) => r.id === 'cursor');
      expect(cursor).toBeDefined();
      expect(cursor?.models.length).toBeGreaterThan(0);
    });

    it('returns same data on consecutive calls', () => {
      const first = loadRunnerRegistry();
      const second = loadRunnerRegistry();
      expect(first).toEqual(second);
    });
  });

  describe('generateRunnersYaml', () => {
    it('returns a non-empty string', () => {
      const yaml = generateRunnersYaml();
      expect(yaml.length).toBeGreaterThan(0);
    });

    it('parses as valid YAML', () => {
      const yaml = generateRunnersYaml();
      expect(() => parseYaml(yaml) as unknown).not.toThrow();
    });

    it('YAML contains runners array matching registry', () => {
      const yaml = generateRunnersYaml();
      const parsed = parseYaml(yaml) as { runners: Array<{ id: string }> };
      const registry = loadRunnerRegistry();
      expect(parsed.runners.length).toBe(registry.length);
      for (const runner of registry) {
        const found = parsed.runners.find((r) => r.id === runner.id);
        expect(found).toBeDefined();
      }
    });

    it('returns identical content on consecutive calls', () => {
      expect(generateRunnersYaml()).toBe(generateRunnersYaml());
    });
  });
});
