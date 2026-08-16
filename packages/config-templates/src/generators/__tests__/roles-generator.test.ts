import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { generateRolesYaml } from '../roles-generator';

interface RoleEntry {
  id: string;
  name: string;
  description: string;
  owned_artifacts: string[];
  readable_artifacts: string[];
  forbidden_artifacts: string[];
  required_capabilities: string[];
  model: string;
  dispatch_type: string;
  runner: string;
}

describe('roles-generator', () => {
  it('returns a non-empty string', () => {
    const yaml = generateRolesYaml();
    expect(yaml.length).toBeGreaterThan(0);
  });

  it('starts with header comments', () => {
    const yaml = generateRolesYaml();
    expect(yaml).toMatch(/^# Role definitions/);
  });

  it('parses as valid YAML with a roles array', () => {
    const parsed = parseYaml(generateRolesYaml()) as { roles: RoleEntry[] };
    expect(Array.isArray(parsed.roles)).toBe(true);
    expect(parsed.roles.length).toBeGreaterThan(0);
  });

  it('every role has required fields', () => {
    const parsed = parseYaml(generateRolesYaml()) as { roles: RoleEntry[] };
    for (const role of parsed.roles) {
      expect(role.id).toBeTruthy();
      expect(role.name).toBeTruthy();
      expect(role.description).toBeTruthy();
      expect(Array.isArray(role.owned_artifacts)).toBe(true);
      expect(Array.isArray(role.readable_artifacts)).toBe(true);
      expect(Array.isArray(role.required_capabilities)).toBe(true);
      expect(role.required_capabilities.length).toBeGreaterThan(0);
      expect(role.model).toBeTruthy();
      expect(role.dispatch_type).toBe('agent');
      expect(role.runner).toBeTruthy();
    }
  });

  it('all role IDs are unique', () => {
    const parsed = parseYaml(generateRolesYaml()) as { roles: RoleEntry[] };
    const ids = parsed.roles.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all role names are unique', () => {
    const parsed = parseYaml(generateRolesYaml()) as { roles: RoleEntry[] };
    const names = parsed.roles.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('roles are sorted alphabetically by filename (id)', () => {
    const parsed = parseYaml(generateRolesYaml()) as { roles: RoleEntry[] };
    const ids = parsed.roles.map((r) => r.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
  });

  it('contains key domain roles', () => {
    const parsed = parseYaml(generateRolesYaml()) as { roles: RoleEntry[] };
    const ids = parsed.roles.map((r) => r.id);
    expect(ids).toContain('implementer');
    expect(ids).toContain('planner');
    expect(ids).toContain('judge');
    expect(ids).toContain('verifier');
  });

  it('verifier role has dispatch_type agent and runner claude-code', () => {
    const parsed = parseYaml(generateRolesYaml()) as { roles: RoleEntry[] };
    const verifier = parsed.roles.find((r) => r.id === 'verifier');
    expect(verifier).toBeDefined();
    expect(verifier?.dispatch_type).toBe('agent');
    expect(verifier?.runner).toBe('claude-code');
  });

  it('generated YAML uses runner key (not agent_runner)', () => {
    const yaml = generateRolesYaml();
    expect(yaml).toContain('runner:');
    expect(yaml).not.toContain('agent_runner:');
  });

  it('returns identical content on consecutive calls', () => {
    expect(generateRolesYaml()).toBe(generateRolesYaml());
  });
});
