import type { ArtifactContextBlock, TokenBudget } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { TokenBudgetExceededError } from '../../domain/errors';
import { DefaultTokenEstimator } from '../default-token-estimator';
import { TokenBudgetManager } from '../token-budget-manager';

function makeArtifact(
  type: 'implementation' | 'plan' | 'static_review',
  content: string,
): ArtifactContextBlock {
  const estimator = new DefaultTokenEstimator();
  return {
    ref: { type, name: `${type}-1`, version: 1, checksum: 'abc' },
    content,
    tokenEstimate: estimator.estimate(content),
  };
}

function makeBudget(maxInput = 1000, reservedOutput = 200): TokenBudget {
  return {
    maxInputTokens: maxInput,
    reservedOutputTokens: reservedOutput,
    artifactPriority: [],
  };
}

describe('TokenBudgetManager', () => {
  it('returns artifacts unchanged when within budget', () => {
    const manager = new TokenBudgetManager(new DefaultTokenEstimator());
    const artifacts = [makeArtifact('implementation', 'short')];
    const result = manager.applyBudget(artifacts, 10, makeBudget());

    expect(result.artifacts).toEqual(artifacts);
    expect(result.truncations).toEqual([]);
  });

  it('throws TokenBudgetExceededError when non-artifact tokens exceed budget', () => {
    const manager = new TokenBudgetManager(new DefaultTokenEstimator());
    expect(() => manager.applyBudget([], 900, makeBudget(1000, 200))).toThrow(
      TokenBudgetExceededError,
    );
  });

  it('truncates artifacts using tail strategy by default', () => {
    const manager = new TokenBudgetManager(new DefaultTokenEstimator());
    const longContent = 'x'.repeat(4000);
    const artifacts = [makeArtifact('implementation', longContent)];

    const result = manager.applyBudget(artifacts, 100, makeBudget(1000, 200));

    expect(result.truncations).toHaveLength(1);
    expect(result.truncations[0].strategy).toBe('tail');
    expect(result.truncations[0].truncatedTokens).toBeLessThan(
      result.truncations[0].originalTokens,
    );
  });

  it('omits lowest-priority artifacts first', () => {
    const manager = new TokenBudgetManager(new DefaultTokenEstimator());
    const high = makeArtifact('static_review', 'x'.repeat(800));
    const low = makeArtifact('plan', 'x'.repeat(800));

    const budget: TokenBudget = {
      maxInputTokens: 350,
      reservedOutputTokens: 50,
      artifactPriority: [
        { artifactType: 'static_review', priority: 10, truncationStrategy: 'tail' },
        { artifactType: 'plan', priority: 1, truncationStrategy: 'omit' },
      ],
    };

    const result = manager.applyBudget([low, high], 50, budget);

    const omitted = result.truncations.find((t) => t.strategy === 'omit');
    expect(omitted).toBeDefined();
    expect(result.artifacts.some((a) => a.ref.type === 'static_review')).toBe(true);
  });

  it('uses summary strategy when configured', () => {
    const manager = new TokenBudgetManager(new DefaultTokenEstimator());
    const artifact = makeArtifact('implementation', 'x'.repeat(4000));

    const budget: TokenBudget = {
      maxInputTokens: 500,
      reservedOutputTokens: 100,
      artifactPriority: [
        { artifactType: 'implementation', priority: 5, truncationStrategy: 'summary' },
      ],
    };

    const result = manager.applyBudget([artifact], 50, budget);

    expect(result.truncations).toHaveLength(1);
    expect(result.truncations[0].strategy).toBe('summary');
    if (result.artifacts.length > 0) {
      expect(result.artifacts[0].content).toContain('truncated');
    }
  });

  it('handles empty artifacts list', () => {
    const manager = new TokenBudgetManager(new DefaultTokenEstimator());
    const result = manager.applyBudget([], 100, makeBudget());

    expect(result.artifacts).toEqual([]);
    expect(result.truncations).toEqual([]);
  });
});
