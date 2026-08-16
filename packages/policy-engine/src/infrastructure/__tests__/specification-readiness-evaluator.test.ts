import type { PolicyContext, PolicyDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { SpecificationReadinessEvaluator } from '../specification-readiness-evaluator';

function makePolicy(overrides: Partial<PolicyDefinition['config']> = {}): PolicyDefinition {
  return {
    id: 'builtin:specification_readiness',
    type: 'specification_readiness',
    scope: {},
    config: {
      minCompletenessScore: 0.8,
      ...overrides,
    },
    enabled: true,
  };
}

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    runId: 'run-001',
    currentState: 'INTAKE',
    artifacts: [{ type: 'canonical_specification', name: 'spec', version: 1, checksum: 'abc' }],
    metadata: {
      completenessScore: 0.9,
      ambiguityCount: 0,
    },
    ...overrides,
  };
}

describe('SpecificationReadinessEvaluator', () => {
  const evaluator = new SpecificationReadinessEvaluator();

  it('passes when all readiness criteria are met', () => {
    const result = evaluator.evaluate(makePolicy(), makeContext());
    expect(result.outcome).toBe('pass');
    expect(result.reason).toBe('Specification meets readiness criteria');
  });

  it('fails when canonical specification artifact is missing', () => {
    const result = evaluator.evaluate(makePolicy(), makeContext({ artifacts: [] }));
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('Canonical specification artifact is required');
  });

  it('fails when completeness score is below threshold', () => {
    const result = evaluator.evaluate(
      makePolicy(),
      makeContext({ metadata: { completenessScore: 0.5, ambiguityCount: 0 } }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('Completeness score 0.5 is below minimum 0.8');
  });

  it('fails when any ambiguities are present', () => {
    const result = evaluator.evaluate(
      makePolicy(),
      makeContext({ metadata: { completenessScore: 0.9, ambiguityCount: 1 } }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('1 ambiguities found; none are allowed');
  });

  it('reports multiple failures together', () => {
    const result = evaluator.evaluate(
      makePolicy(),
      makeContext({
        artifacts: [],
        metadata: { completenessScore: 0.3, ambiguityCount: 2 },
      }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('Canonical specification');
    expect(result.reason).toContain('Completeness score');
    expect(result.reason).toContain('ambiguities found');
  });

  it('passes when no completeness metadata is present', () => {
    const result = evaluator.evaluate(makePolicy(), makeContext({ metadata: {} }));
    expect(result.outcome).toBe('pass');
  });

  it('includes correct policy ID and type in result', () => {
    const result = evaluator.evaluate(makePolicy(), makeContext());
    expect(result.policyId).toBe('builtin:specification_readiness');
    expect(result.policyType).toBe('specification_readiness');
  });
});
