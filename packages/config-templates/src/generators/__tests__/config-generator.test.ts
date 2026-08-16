import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { generateConfigYaml } from '../config-generator';

describe('config-generator', () => {
  it('returns a non-empty string', () => {
    const yaml = generateConfigYaml();
    expect(yaml.length).toBeGreaterThan(0);
  });

  it('parses as valid YAML', () => {
    const yaml = generateConfigYaml();
    expect(() => parseYaml(yaml) as unknown).not.toThrow();
  });

  it('contains all required config fields', () => {
    const parsed = parseYaml(generateConfigYaml()) as Record<string, unknown>;
    expect(parsed).toHaveProperty('log_level');
    expect(parsed).toHaveProperty('default_workflow');
    expect(parsed).toHaveProperty('workflow_version');
    expect(parsed).toHaveProperty('global_transition_limit');
  });

  it('has valid log_level enum value', () => {
    const parsed = parseYaml(generateConfigYaml()) as { log_level: string };
    expect(['debug', 'info', 'warn', 'error']).toContain(parsed.log_level);
  });

  it('has a positive integer global_transition_limit', () => {
    const parsed = parseYaml(generateConfigYaml()) as { global_transition_limit: number };
    expect(parsed.global_transition_limit).toBeGreaterThan(0);
    expect(Number.isInteger(parsed.global_transition_limit)).toBe(true);
  });

  it('has non-empty default_workflow string', () => {
    const parsed = parseYaml(generateConfigYaml()) as { default_workflow: string };
    expect(parsed.default_workflow.length).toBeGreaterThan(0);
  });

  it('has non-empty workflow_version string', () => {
    const parsed = parseYaml(generateConfigYaml()) as { workflow_version: string };
    expect(parsed.workflow_version.length).toBeGreaterThan(0);
  });

  it('returns identical content on consecutive calls', () => {
    const first = generateConfigYaml();
    const second = generateConfigYaml();
    expect(first).toBe(second);
  });
});
