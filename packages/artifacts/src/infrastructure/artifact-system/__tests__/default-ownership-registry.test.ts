import type { ArtifactType, RoleContract } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { buildOwnershipOverrides, DefaultOwnershipRegistry } from '../default-ownership-registry';

const EXPECTED_MAPPINGS: readonly [ArtifactType, string][] = [
  ['intake_requirements', 'human'],
  ['canonical_specification', 'requirements_analyst'],
  ['clarification_questions', 'requirements_analyst'],
  ['clarification_answers', 'human'],
  ['plan', 'planner'],
  ['plan_review', 'plan_reviewer'],
  ['test_plan', 'implementer'],
  ['implementation', 'implementer'],
  ['static_review', 'static_reviewer'],
  ['security_review', 'security_reviewer'],
  ['performance_review', 'performance_reviewer'],
  ['verification', 'verifier'],
  ['planning_agreement', 'governance'],
  ['implementation_agreement', 'governance'],
  ['verification_agreement', 'governance'],
  ['release_agreement', 'governance'],
  ['escalation_context', 'governance'],
  ['run_manifest', 'workflow_engine'],
];

describe('DefaultOwnershipRegistry', () => {
  const registry = new DefaultOwnershipRegistry();

  describe('getOwner', () => {
    it.each(EXPECTED_MAPPINGS)('returns "%s" primary owner as "%s"', (type, owner) => {
      expect(registry.getOwner(type)).toBe(owner);
    });
  });

  describe('isAuthorized', () => {
    it.each(EXPECTED_MAPPINGS)('authorizes correct owner for "%s"', (type, owner) => {
      expect(registry.isAuthorized(owner, type)).toBe(true);
    });

    it('rejects unauthorized role', () => {
      expect(registry.isAuthorized('implementer', 'plan')).toBe(false);
    });

    it('authorizes context_analyst for canonical_specification', () => {
      expect(registry.isAuthorized('context_analyst', 'canonical_specification')).toBe(true);
    });

    it('rejects unknown role for registered type', () => {
      expect(registry.isAuthorized('unknown_role', 'canonical_specification')).toBe(false);
    });
  });

  describe('getOwnedTypes', () => {
    it('returns correct types for governance', () => {
      const types = registry.getOwnedTypes('governance');
      expect(types).toContain('planning_agreement');
      expect(types).toContain('implementation_agreement');
      expect(types).toContain('verification_agreement');
      expect(types).toContain('release_agreement');
      expect(types).toContain('escalation_context');
      expect(types).toHaveLength(5);
    });

    it('returns correct types for requirements_analyst', () => {
      const types = registry.getOwnedTypes('requirements_analyst');
      expect(types).toContain('canonical_specification');
      expect(types).toContain('clarification_questions');
      expect(types).toHaveLength(2);
    });

    it('returns canonical_specification for context_analyst', () => {
      const types = registry.getOwnedTypes('context_analyst');
      expect(types).toContain('canonical_specification');
      expect(types).toHaveLength(1);
    });

    it('returns empty array for unknown role', () => {
      expect(registry.getOwnedTypes('unknown_role')).toEqual([]);
    });
  });

  describe('overrides', () => {
    it('applies single-value ownership overrides by appending to existing owners', () => {
      const overrides = new Map<ArtifactType, string>([['plan', 'custom_planner']]);
      const custom = new DefaultOwnershipRegistry(overrides);
      expect(custom.getOwner('plan')).toBe('planner');
      expect(custom.isAuthorized('custom_planner', 'plan')).toBe(true);
      expect(custom.isAuthorized('planner', 'plan')).toBe(true);
      expect(custom.getOwner('implementation')).toBe('implementer');
    });

    it('applies array-value ownership overrides for multiple roles', () => {
      const overrides = new Map<ArtifactType, string[]>([
        ['canonical_specification', ['breakdown_analyst', 'task_spec_writer']],
      ]);
      const custom = new DefaultOwnershipRegistry(overrides);
      expect(custom.isAuthorized('requirements_analyst', 'canonical_specification')).toBe(true);
      expect(custom.isAuthorized('context_analyst', 'canonical_specification')).toBe(true);
      expect(custom.isAuthorized('breakdown_analyst', 'canonical_specification')).toBe(true);
      expect(custom.isAuthorized('task_spec_writer', 'canonical_specification')).toBe(true);
    });

    it('does not duplicate roles already in default owners', () => {
      const overrides = new Map<ArtifactType, string[]>([
        ['canonical_specification', ['requirements_analyst', 'breakdown_analyst']],
      ]);
      const custom = new DefaultOwnershipRegistry(overrides);
      const types = custom.getOwnedTypes('requirements_analyst');
      const specCount = types.filter((t) => t === 'canonical_specification').length;
      expect(specCount).toBe(1);
    });
  });
});

describe('buildOwnershipOverrides', () => {
  function makeRole(overrides: Partial<RoleContract> & { id: string }): RoleContract {
    return {
      name: overrides.id,
      description: `Test role: ${overrides.id}`,
      ownedArtifacts: [],
      readableArtifacts: [],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: [],
      dispatchType: 'agent',
      ...overrides,
    };
  }

  it('builds override map from role contracts', () => {
    const roles = [
      makeRole({ id: 'breakdown_analyst', ownedArtifacts: ['canonical_specification'] }),
      makeRole({ id: 'custom_planner', ownedArtifacts: ['plan'] }),
    ];
    const overrides = buildOwnershipOverrides(roles);
    expect(overrides.get('canonical_specification')).toEqual(['breakdown_analyst']);
    expect(overrides.get('plan')).toEqual(['custom_planner']);
  });

  it('aggregates multiple roles owning the same artifact type', () => {
    const roles = [
      makeRole({ id: 'breakdown_analyst', ownedArtifacts: ['canonical_specification'] }),
      makeRole({ id: 'context_analyst', ownedArtifacts: ['canonical_specification'] }),
      makeRole({ id: 'task_spec_writer', ownedArtifacts: ['canonical_specification'] }),
    ];
    const overrides = buildOwnershipOverrides(roles);
    expect(overrides.get('canonical_specification')).toEqual([
      'breakdown_analyst',
      'context_analyst',
      'task_spec_writer',
    ]);
  });

  it('does not duplicate role ids', () => {
    const roles = [
      makeRole({ id: 'planner', ownedArtifacts: ['plan'] }),
      makeRole({ id: 'planner', ownedArtifacts: ['plan'] }),
    ];
    const overrides = buildOwnershipOverrides(roles);
    expect(overrides.get('plan')).toEqual(['planner']);
  });

  it('returns empty map for empty roles array', () => {
    const overrides = buildOwnershipOverrides([]);
    expect(overrides.size).toBe(0);
  });

  it('integrates with DefaultOwnershipRegistry to authorize additional owners', () => {
    const roles = [
      makeRole({ id: 'breakdown_analyst', ownedArtifacts: ['canonical_specification'] }),
    ];
    const overrides = buildOwnershipOverrides(roles);
    const registry = new DefaultOwnershipRegistry(overrides);
    expect(registry.isAuthorized('breakdown_analyst', 'canonical_specification')).toBe(true);
    expect(registry.isAuthorized('requirements_analyst', 'canonical_specification')).toBe(true);
    expect(registry.isAuthorized('context_analyst', 'canonical_specification')).toBe(true);
  });
});
