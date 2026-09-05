import type { RoleRegistry } from '@ai-dev-orchestrator/ports';
import { DefaultRoleRegistry } from '@ai-dev-orchestrator/role-system';
import type { RoleContract } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { TEST_ROLES } from '../../../../test/fixtures/test-defaults';
import { DefaultCollaborationModel } from '../default-collaboration-model';

function makeRegistry(roles: readonly RoleContract[] = TEST_ROLES): RoleRegistry {
  return new DefaultRoleRegistry(roles, {
    assignments: {},
    defaultAssignment: { model: 'fixture-model' },
  });
}

describe('DefaultCollaborationModel', () => {
  describe('getInteractions', () => {
    it('returns production interactions for a known role', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const interactions = model.getInteractions('planner');

      const producesFor = interactions.filter((i) => i.relationship === 'produces_for');
      expect(producesFor.length).toBeGreaterThan(0);
      expect(producesFor.every((i) => i.producerRole === 'planner')).toBe(true);
      expect(producesFor.every((i) => i.artifactType === 'plan')).toBe(true);
    });

    it('returns empty for unknown role', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      expect(model.getInteractions('nonexistent')).toEqual([]);
    });

    it('includes review interactions when role reviews other roles', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const interactions = model.getInteractions('plan_reviewer');

      const reviews = interactions.filter((i) => i.relationship === 'reviews');
      expect(reviews.length).toBeGreaterThan(0);
      expect(reviews.some((i) => i.producerRole === 'planner')).toBe(true);
    });
  });

  describe('getFlowDefinitions', () => {
    it('returns flows for all owned artifact types', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const flows = model.getFlowDefinitions();

      expect(flows.length).toBeGreaterThan(0);
      const planFlow = flows.find((f) => f.artifactType === 'plan');
      expect(planFlow).toBeDefined();
      expect(planFlow?.producedBy).toBe('planner');
      expect(planFlow?.reviewedBy).toContain('plan_reviewer');
    });

    it('lists consumers that have readable access', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const flows = model.getFlowDefinitions();

      const planFlow = flows.find((f) => f.artifactType === 'plan');
      expect(planFlow?.consumedBy.length).toBeGreaterThan(0);
    });
  });

  describe('checkVisibility', () => {
    it('allows when artifact is in readableArtifacts', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const result = model.checkVisibility('planner', 'plan_review');

      expect(result.allowed).toBe(true);
    });

    it('allows when artifact is in ownedArtifacts', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const result = model.checkVisibility('planner', 'plan');

      expect(result.allowed).toBe(true);
    });

    it('denies when artifact is in forbiddenArtifacts', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const result = model.checkVisibility('planner', 'implementation');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('forbidden');
    });

    it('denies when artifact is not in readable or owned', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const result = model.checkVisibility('planner', 'verification');

      expect(result.allowed).toBe(false);
    });

    it('denies for unknown role', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const result = model.checkVisibility('nonexistent', 'plan');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  describe('getProducerFor', () => {
    it('returns the owning role', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      expect(model.getProducerFor('plan')).toBe('planner');
    });
  });

  describe('getConsumersFor', () => {
    it('returns all roles with readable access', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const consumers = model.getConsumersFor('plan');

      expect(consumers.length).toBeGreaterThan(0);
      expect(consumers).toContain('plan_reviewer');
    });
  });

  describe('getReviewersFor', () => {
    it('returns reviewedBy list for known role', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const reviewers = model.getReviewersFor('planner');

      expect(reviewers).toContain('plan_reviewer');
    });

    it('returns empty for unknown role', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      expect(model.getReviewersFor('nonexistent')).toEqual([]);
    });

    it('returns multiple reviewers for implementer', () => {
      const model = new DefaultCollaborationModel(makeRegistry());
      const reviewers = model.getReviewersFor('implementer');

      expect(reviewers).toContain('static_reviewer');
      expect(reviewers).toContain('security_reviewer');
      expect(reviewers).toContain('performance_reviewer');
    });
  });
});
