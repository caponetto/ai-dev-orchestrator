import type { RoleContract } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { TEST_ROLES } from '../../../test/fixtures/test-defaults';
import { validateContracts } from '../contract-validator';

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
    requiredCapabilities: ['reasoning'],
    dispatchType: 'agent',
    ...overrides,
  };
}

describe('contract-validator', () => {
  it('built-in roles pass validation', () => {
    const result = validateContracts(TEST_ROLES);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  describe('ownership uniqueness', () => {
    it('warns when two roles own the same artifact type', () => {
      const roles = [
        makeRole({ id: 'role_a', ownedArtifacts: ['plan'] }),
        makeRole({ id: 'role_b', ownedArtifacts: ['plan'] }),
      ];
      const result = validateContracts(roles);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.message.includes('plan'))).toBe(true);
    });

    it('allows different types owned by different roles', () => {
      const roles = [
        makeRole({ id: 'role_a', ownedArtifacts: ['plan'] }),
        makeRole({ id: 'role_b', ownedArtifacts: ['implementation'] }),
      ];
      const result = validateContracts(roles);
      expect(result.valid).toBe(true);
    });
  });

  describe('forbidden disjointness', () => {
    it('detects owned and forbidden overlap', () => {
      const roles = [
        makeRole({ id: 'role_a', ownedArtifacts: ['plan'], forbiddenArtifacts: ['plan'] }),
      ];
      const result = validateContracts(roles);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('both owned and forbidden'))).toBe(true);
    });

    it('detects readable and forbidden overlap', () => {
      const roles = [
        makeRole({
          id: 'role_a',
          readableArtifacts: ['implementation', 'plan'],
          forbiddenArtifacts: ['implementation'],
        }),
      ];
      const result = validateContracts(roles);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('both readable and forbidden'))).toBe(
        true,
      );
    });

    it('passes when readable and forbidden are disjoint', () => {
      const roles = [
        makeRole({
          id: 'role_a',
          readableArtifacts: ['canonical_specification'],
          forbiddenArtifacts: ['implementation'],
        }),
      ];
      const result = validateContracts(roles);
      expect(result.errors.filter((e) => e.field === 'forbiddenArtifacts')).toHaveLength(0);
    });
  });

  describe('review reciprocity', () => {
    it('warns when reviewedBy is not reciprocal', () => {
      const roles = [
        makeRole({ id: 'producer', reviewedBy: ['reviewer'] }),
        makeRole({ id: 'reviewer', reviews: [] }),
      ];
      const result = validateContracts(roles);
      expect(result.warnings.some((w) => w.message.includes('reviewedBy'))).toBe(true);
    });

    it('warns when reviews is not reciprocal', () => {
      const roles = [
        makeRole({ id: 'reviewer', reviews: ['producer'] }),
        makeRole({ id: 'producer', reviewedBy: [] }),
      ];
      const result = validateContracts(roles);
      expect(result.warnings.some((w) => w.message.includes('reviews'))).toBe(true);
    });

    it('errors on references to unknown roles', () => {
      const roles = [makeRole({ id: 'role_a', reviewedBy: ['nonexistent'] })];
      const result = validateContracts(roles);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('unknown role'))).toBe(true);
    });
  });

  describe('circular review detection', () => {
    it('detects direct circular review (A reviews B, B reviews A)', () => {
      const roles = [
        makeRole({ id: 'role_a', reviews: ['role_b'] }),
        makeRole({ id: 'role_b', reviews: ['role_a'] }),
      ];
      const result = validateContracts(roles);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Circular review chain'))).toBe(true);
    });

    it('no circular review in valid setup', () => {
      const roles = [
        makeRole({ id: 'producer', reviewedBy: ['reviewer'] }),
        makeRole({ id: 'reviewer', reviews: ['producer'] }),
      ];
      const result = validateContracts(roles);
      expect(result.errors.filter((e) => e.message.includes('Circular'))).toHaveLength(0);
    });
  });

  describe('review reciprocity — reviews referencing unknown role', () => {
    it('errors when reviews references a nonexistent role', () => {
      const roles = [makeRole({ id: 'role_a', reviews: ['nonexistent'] })];
      const result = validateContracts(roles);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'reviews' && e.message.includes('unknown role "nonexistent"'),
        ),
      ).toBe(true);
    });
  });

  describe('circular review — DFS edge cases', () => {
    it('handles already-visited nodes in review DFS without false circular detection', () => {
      // Diamond: A reviews B and C, both B and C review D.
      // D is visited twice via two paths but neither path is circular.
      const roles = [
        makeRole({ id: 'role_a', reviews: ['role_b', 'role_c'] }),
        makeRole({ id: 'role_b', reviews: ['role_d'] }),
        makeRole({ id: 'role_c', reviews: ['role_d'] }),
        makeRole({ id: 'role_d', reviews: [] }),
      ];
      const result = validateContracts(roles);
      expect(result.errors.filter((e) => e.message.includes('Circular'))).toHaveLength(0);
    });

    it('handles reviews referencing nonexistent role in DFS gracefully', () => {
      // role_a reviews role_b, role_b reviews nonexistent_role.
      // The DFS should handle the missing role without crashing or false circular detection.
      const roles = [
        makeRole({ id: 'role_a', reviews: ['role_b'] }),
        makeRole({ id: 'role_b', reviews: ['ghost_role'] }),
      ];
      const result = validateContracts(roles);
      // Should not report circular errors — just the unknown role error
      expect(result.errors.filter((e) => e.message.includes('Circular'))).toHaveLength(0);
      expect(result.errors.some((e) => e.message.includes('unknown role'))).toBe(true);
    });
  });

  describe('readable artifacts', () => {
    it('warns when readable artifact is not produced by any role', () => {
      const roles = [makeRole({ id: 'role_a', readableArtifacts: ['run_manifest'] })];
      const result = validateContracts(roles);
      expect(result.warnings.some((w) => w.message.includes('not owned by any role'))).toBe(true);
    });

    it('does not warn for clarification_answers even when not owned', () => {
      const roles = [makeRole({ id: 'role_a', readableArtifacts: ['clarification_answers'] })];
      const result = validateContracts(roles);
      expect(
        result.warnings.some(
          (w) => w.message.includes('clarification_answers') && w.message.includes('not owned'),
        ),
      ).toBe(false);
    });

    it('does not warn when readable artifact is owned by another role', () => {
      const roles = [
        makeRole({ id: 'producer', ownedArtifacts: ['plan'] }),
        makeRole({ id: 'consumer', readableArtifacts: ['plan'] }),
      ];
      const result = validateContracts(roles);
      expect(
        result.warnings.some((w) => w.message.includes('plan') && w.message.includes('not owned')),
      ).toBe(false);
    });
  });
});
