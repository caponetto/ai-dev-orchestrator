import type { ArtifactType, RoleContract } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { TEST_ROLES } from '../../../test/fixtures/test-defaults';
import type { DispatchOverride } from '../role-registry';
import { DefaultRoleRegistry } from '../role-registry';

const DEFAULT_MODEL_CONFIG = {
  assignments: {},
  defaultAssignment: { model: 'claude-opus-4-8' },
};

function createRegistry(
  dispatchOverrides?: Readonly<Record<string, DispatchOverride>>,
): DefaultRoleRegistry {
  return new DefaultRoleRegistry(TEST_ROLES, DEFAULT_MODEL_CONFIG, dispatchOverrides);
}

describe('DefaultRoleRegistry', () => {
  describe('RoleRegistry interface', () => {
    it('getRole returns role by ID', () => {
      const registry = createRegistry();
      const role = registry.getRole('planner');
      expect(role).not.toBeNull();
      expect(role?.id).toBe('planner');
      expect(role?.name).toBe('Planner');
    });

    it('getRole returns null for unknown role', () => {
      const registry = createRegistry();
      expect(registry.getRole('nonexistent')).toBeNull();
    });

    it('listRoles returns all 14 built-in roles', () => {
      const registry = createRegistry();
      const roles = registry.listRoles();
      expect(roles).toHaveLength(14);
    });

    it('getModelAssignment returns default for any role', () => {
      const registry = createRegistry();
      const assignment = registry.getModelAssignment('planner');
      expect(assignment.roleId).toBe('planner');
      expect(assignment.model).toBe('claude-opus-4-8');
    });

    it('getModelAssignment returns explicit assignment when configured', () => {
      const registry = new DefaultRoleRegistry(TEST_ROLES, {
        assignments: {
          planner: { model: 'gpt-4o' },
        },
        defaultAssignment: DEFAULT_MODEL_CONFIG.defaultAssignment,
      });
      const assignment = registry.getModelAssignment('planner');
      expect(assignment.model).toBe('gpt-4o');
    });

    it('validate returns valid for built-in roles', () => {
      const registry = createRegistry();
      const result = registry.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('dispatchOverrides', () => {
    it('merges dispatchType override into role', () => {
      const overrides: Readonly<Record<string, DispatchOverride>> = {
        planner: { dispatchType: 'human' },
      };
      const registry = createRegistry(overrides);
      const role = registry.getRole('planner');
      expect(role).not.toBeNull();
      expect(role?.dispatchType).toBe('human');
      expect(role?.name).toBe('Planner');
    });

    it('merges runner override into role', () => {
      const overrides: Readonly<Record<string, DispatchOverride>> = {
        planner: { runner: 'cursor' },
      };
      const registry = createRegistry(overrides);
      const role = registry.getRole('planner');
      expect(role?.runner).toBe('cursor');
    });

    it('merges agentConfig override by spreading on top of existing config', () => {
      const baseRoles: RoleContract[] = [
        {
          id: 'test_role',
          name: 'Test',
          description: 'A test role',
          ownedArtifacts: [],
          readableArtifacts: [],
          forbiddenArtifacts: [],
          reviewedBy: [],
          reviews: [],
          agreementParticipation: [],
          requiredCapabilities: ['reasoning'],
          dispatchType: 'agent',
          runner: 'claude-code',
          agentConfig: { model: 'opus', temperature: '0.5' },
        },
      ];
      const overrides: Readonly<Record<string, DispatchOverride>> = {
        test_role: { agentConfig: { model: 'sonnet' } },
      };
      const registry = new DefaultRoleRegistry(baseRoles, DEFAULT_MODEL_CONFIG, overrides);
      const role = registry.getRole('test_role');
      expect(role?.agentConfig).toEqual({ model: 'sonnet', temperature: '0.5' });
    });

    it('preserves original agentConfig when override has no agentConfig', () => {
      const baseRoles: RoleContract[] = [
        {
          id: 'test_role',
          name: 'Test',
          description: 'A test role',
          ownedArtifacts: [],
          readableArtifacts: [],
          forbiddenArtifacts: [],
          reviewedBy: [],
          reviews: [],
          agreementParticipation: [],
          requiredCapabilities: ['reasoning'],
          dispatchType: 'agent',
          agentConfig: { model: 'opus' },
        },
      ];
      const overrides: Readonly<Record<string, DispatchOverride>> = {
        test_role: { runner: 'cursor' },
      };
      const registry = new DefaultRoleRegistry(baseRoles, DEFAULT_MODEL_CONFIG, overrides);
      const role = registry.getRole('test_role');
      expect(role?.agentConfig).toEqual({ model: 'opus' });
      expect(role?.runner).toBe('cursor');
    });

    it('falls back to role defaults when override fields are undefined', () => {
      const overrides: Readonly<Record<string, DispatchOverride>> = {
        planner: {},
      };
      const registry = createRegistry(overrides);
      const role = registry.getRole('planner');
      const originalRole = TEST_ROLES.find((r) => r.id === 'planner');
      expect(role?.dispatchType).toBe(originalRole?.dispatchType);
      expect(role?.runner).toBe(originalRole?.runner);
    });

    it('ignores overrides for roles that do not exist', () => {
      const overrides: Readonly<Record<string, DispatchOverride>> = {
        nonexistent_role: { dispatchType: 'human' },
      };
      const registry = createRegistry(overrides);
      expect(registry.getRole('nonexistent_role')).toBeNull();
      expect(registry.listRoles()).toHaveLength(14);
    });
  });

  describe('OwnershipRegistry interface', () => {
    it('getOwner returns correct owner for plan', () => {
      const registry = createRegistry();
      expect(registry.getOwner('plan')).toBe('planner');
    });

    it('getOwner returns null for artifact type not owned by any role', () => {
      const registry = createRegistry();
      expect(registry.getOwner('nonexistent_artifact_type' as ArtifactType)).toBeNull();
    });

    it('isAuthorized returns true for correct owner', () => {
      const registry = createRegistry();
      expect(registry.isAuthorized('planner', 'plan')).toBe(true);
    });

    it('isAuthorized returns false for wrong owner', () => {
      const registry = createRegistry();
      expect(registry.isAuthorized('implementer', 'plan')).toBe(false);
    });

    it('isAuthorized returns false for unknown role', () => {
      const registry = createRegistry();
      expect(registry.isAuthorized('unknown', 'plan')).toBe(false);
    });

    it('getOwnedTypes returns correct types for implementer', () => {
      const registry = createRegistry();
      const types = registry.getOwnedTypes('implementer');
      expect(types).toEqual(['implementation', 'test_plan']);
    });

    it('getOwnedTypes returns empty for unknown role', () => {
      const registry = createRegistry();
      expect(registry.getOwnedTypes('unknown')).toEqual([]);
    });
  });
});
