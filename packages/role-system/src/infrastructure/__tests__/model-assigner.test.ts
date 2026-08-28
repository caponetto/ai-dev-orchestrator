import { describe, expect, it } from 'vitest';

import { ModelAssignmentError } from '../../domain/errors';
import { ModelAssigner } from '../model-assigner';
import type { ModelAssignmentConfig, ModelTierConfig } from '../model-assigner';

function createConfig(overrides?: Partial<ModelAssignmentConfig>): ModelAssignmentConfig {
  return {
    assignments: {
      planner: { model: 'claude-opus-4-8' },
      implementer: { model: 'gpt-4o', maxTokens: 32768 },
    },
    defaultAssignment: {
      model: 'claude-opus-4-8',
    },
    ...overrides,
  };
}

describe('ModelAssigner', () => {
  it('returns explicit assignment for configured role', () => {
    const assigner = new ModelAssigner(createConfig());
    const assignment = assigner.getModelAssignment('planner');

    expect(assignment.roleId).toBe('planner');
    expect(assignment.model).toBe('claude-opus-4-8');
  });

  it('returns explicit assignment with maxTokens', () => {
    const assigner = new ModelAssigner(createConfig());
    const assignment = assigner.getModelAssignment('implementer');

    expect(assignment.roleId).toBe('implementer');
    expect(assignment.maxTokens).toBe(32768);
  });

  it('falls back to default for unconfigured role', () => {
    const assigner = new ModelAssigner(createConfig());
    const assignment = assigner.getModelAssignment('verifier');

    expect(assignment.roleId).toBe('verifier');
    expect(assignment.model).toBe('claude-opus-4-8');
  });

  it('throws ModelAssignmentError when no assignment and no default', () => {
    const assigner = new ModelAssigner({ assignments: {} });
    expect(() => assigner.getModelAssignment('unknown')).toThrow(ModelAssignmentError);
  });

  it('explicit assignment overrides default', () => {
    const assigner = new ModelAssigner(createConfig());
    const explicit = assigner.getModelAssignment('planner');
    const defaulted = assigner.getModelAssignment('verifier');

    expect(explicit.model).toBe('claude-opus-4-8');
    expect(defaulted.model).toBe('claude-opus-4-8');
  });
});

describe('ModelAssigner — tier escalation', () => {
  const tierConfig: ModelTierConfig = {
    tiers: [
      { model: 'claude-haiku-4-5-20251001', tier: 1 },
      { model: 'claude-sonnet-5', tier: 2, maxTokens: 65536 },
      { model: 'claude-opus-5', tier: 3, maxTokens: 131072 },
    ],
  };

  function createTieredConfig(): ModelAssignmentConfig {
    return {
      assignments: {
        implementer: { model: 'claude-haiku-4-5-20251001' },
        judge: { model: 'claude-opus-5' },
      },
      defaultAssignment: { model: 'claude-haiku-4-5-20251001' },
      tierConfig,
    };
  }

  it('returns next tier up for a role at tier 1', () => {
    const assigner = new ModelAssigner(createTieredConfig());
    const next = assigner.getNextTier('implementer');
    expect(next).not.toBeNull();
    expect(next?.model).toBe('claude-sonnet-5');
  });

  it('returns null when role is already at max tier', () => {
    const assigner = new ModelAssigner(createTieredConfig());
    const next = assigner.getNextTier('judge');
    expect(next).toBeNull();
  });

  it('returns null when no tier config is provided', () => {
    const assigner = new ModelAssigner(createConfig());
    const next = assigner.getNextTier('implementer');
    expect(next).toBeNull();
  });

  it('getRecommendedModel returns higher tier when calibration shows low success rate', () => {
    const assigner = new ModelAssigner(createTieredConfig());
    const result = assigner.getRecommendedModel('implementer', [
      {
        roleId: 'implementer',
        model: 'claude-haiku-4-5-20251001',
        successRate: 0.4,
        avgConfidence: 0.35,
        escalationRate: 0.6,
        sampleSize: 5,
      },
    ]);
    expect(result.model).toBe('claude-sonnet-5');
  });

  it('getRecommendedModel uses default when calibration sample size is too small', () => {
    const assigner = new ModelAssigner(createTieredConfig());
    const result = assigner.getRecommendedModel('implementer', [
      {
        roleId: 'implementer',
        model: 'claude-haiku-4-5-20251001',
        successRate: 0.2,
        avgConfidence: 0.1,
        escalationRate: 0.8,
        sampleSize: 2,
      },
    ]);
    expect(result.model).toBe('claude-haiku-4-5-20251001');
  });

  it('getRecommendedModel uses default when no calibration data', () => {
    const assigner = new ModelAssigner(createTieredConfig());
    const result = assigner.getRecommendedModel('implementer');
    expect(result.model).toBe('claude-haiku-4-5-20251001');
  });
});
