import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadRolesFromFile, loadRolesFromYaml } from '../role-file-loader';

describe('role-file-loader', () => {
  it('parses unified role entries from YAML string', () => {
    const yaml = `
roles:
  - id: test_role
    name: Test Role
    description: A test role
    owned_artifacts: [test_artifact]
    readable_artifacts: []
    forbidden_artifacts: []
    reviewed_by: []
    reviews: []
    agreement_participation: []
    required_capabilities: [reasoning]
    model: claude-opus-4-8
    dispatch_type: agent
    runner: claude-code
`;
    const roles = loadRolesFromYaml(yaml);
    expect(roles).toHaveLength(1);
    expect(roles[0].id).toBe('test_role');
    expect(roles[0].name).toBe('Test Role');
    expect(roles[0].ownedArtifacts).toEqual(['test_artifact']);
    expect(roles[0].dispatchType).toBe('agent');
    expect(roles[0].runner).toBe('claude-code');
  });

  it('maps agreement participation and agent config fields', () => {
    const yaml = `
roles:
  - id: analyst
    name: Analyst
    description: Analyzes requirements
    owned_artifacts: [canonical_specification]
    readable_artifacts: []
    forbidden_artifacts: []
    reviewed_by: []
    reviews: []
    agreement_participation:
      - agreement_type: planning_agreement
        action: reviewed
    required_capabilities: [reasoning, structured_output]
    model: claude-opus-4-8
    dispatch_type: agent
    runner: cursor
    agent_config:
      model: gpt-5.4-medium
`;
    const roles = loadRolesFromYaml(yaml);
    expect(roles[0].agreementParticipation).toEqual([
      { agreementType: 'planning_agreement', action: 'reviewed' },
    ]);
    expect(roles[0].agentConfig).toEqual({ model: 'gpt-5.4-medium' });
  });

  it('loads roles from a file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-loader-test-'));
    const filePath = join(dir, 'roles.yaml');
    writeFileSync(
      filePath,
      `
roles:
  - id: file_role
    name: File Role
    description: Loaded from disk
    owned_artifacts: []
    readable_artifacts: []
    forbidden_artifacts: []
    reviewed_by: []
    reviews: []
    agreement_participation: []
    required_capabilities: []
    dispatch_type: agent
`,
      'utf-8',
    );

    const roles = loadRolesFromFile(filePath);
    expect(roles).toHaveLength(1);
    expect(roles[0].id).toBe('file_role');
  });

  it('throws on invalid YAML in loadRolesFromYaml', () => {
    expect(() => loadRolesFromYaml('invalid: [')).toThrow();
  });

  it('throws when roles array is missing', () => {
    expect(() => loadRolesFromYaml('something_else: true')).toThrow();
  });

  it('throws when YAML parses to null', () => {
    expect(() => loadRolesFromYaml('null')).toThrow('roles.yaml must contain a "roles" array');
  });

  it('throws when a role entry is not an object', () => {
    const yaml = `
roles:
  - not_an_object
`;
    expect(() => loadRolesFromYaml(yaml)).toThrow('Each role entry must be an object');
  });

  it('defaults agreement_participation to empty array when field is missing', () => {
    const yaml = `
roles:
  - id: minimal_role
    name: Minimal
    description: No agreement participation
    owned_artifacts: []
    readable_artifacts: []
    forbidden_artifacts: []
    reviewed_by: []
    reviews: []
    required_capabilities: []
`;
    const roles = loadRolesFromYaml(yaml);
    expect(roles[0].agreementParticipation).toEqual([]);
  });

  it('throws when agreement participation entry is not an object', () => {
    const yaml = `
roles:
  - id: bad_agreement
    name: Bad Agreement
    description: Has a non-object agreement entry
    owned_artifacts: []
    readable_artifacts: []
    forbidden_artifacts: []
    reviewed_by: []
    reviews: []
    agreement_participation:
      - just_a_string
    required_capabilities: []
`;
    expect(() => loadRolesFromYaml(yaml)).toThrow(
      'Each agreement participation entry must be an object',
    );
  });

  it('parses role without runner field', () => {
    const yaml = `
roles:
  - id: no_runner
    name: No Runner
    description: Role without runner
    owned_artifacts: []
    readable_artifacts: []
    forbidden_artifacts: []
    reviewed_by: []
    reviews: []
    agreement_participation: []
    required_capabilities: [reasoning]
`;
    const roles = loadRolesFromYaml(yaml);
    expect(roles[0].runner).toBeUndefined();
    expect(roles[0].dispatchType).toBe('agent');
  });

  describe('loadRolesFromFile error handling', () => {
    it('throws when file does not exist', () => {
      expect(() => loadRolesFromFile('/nonexistent/path/roles.yaml')).toThrow(
        'Cannot read roles file',
      );
    });

    it('throws when file is empty', () => {
      const dir = mkdtempSync(join(tmpdir(), 'role-loader-empty-'));
      const filePath = join(dir, 'roles.yaml');
      writeFileSync(filePath, '', 'utf-8');

      expect(() => loadRolesFromFile(filePath)).toThrow('roles.yaml must contain a "roles" array');
    });

    it('throws when file is whitespace-only', () => {
      const dir = mkdtempSync(join(tmpdir(), 'role-loader-ws-'));
      const filePath = join(dir, 'roles.yaml');
      writeFileSync(filePath, '   \n  \n  ', 'utf-8');

      expect(() => loadRolesFromFile(filePath)).toThrow('roles.yaml must contain a "roles" array');
    });

    it('throws when file contains invalid YAML', () => {
      const dir = mkdtempSync(join(tmpdir(), 'role-loader-bad-yaml-'));
      const filePath = join(dir, 'roles.yaml');
      writeFileSync(filePath, 'invalid: [', 'utf-8');

      expect(() => loadRolesFromFile(filePath)).toThrow();
    });

    it('throws when file YAML parses to empty object', () => {
      const dir = mkdtempSync(join(tmpdir(), 'role-loader-empty-obj-'));
      const filePath = join(dir, 'roles.yaml');
      writeFileSync(filePath, '---\n', 'utf-8');

      expect(() => loadRolesFromFile(filePath)).toThrow('roles.yaml must contain a "roles" array');
    });
  });
});
