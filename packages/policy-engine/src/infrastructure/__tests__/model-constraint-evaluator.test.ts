import type { PolicyContext, PolicyDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { ModelConstraintEvaluator } from '../model-constraint-evaluator';

const POLICY = {
  id: 'builtin:model_constraint',
  type: 'model_constraint' as const,
  scope: {},
  config: {
    allowedModels: ['claude-opus-4-8', 'gpt-4o'],
  },
  enabled: true,
} satisfies PolicyDefinition;

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    runId: 'run-001',
    currentState: 'IMPLEMENTATION',
    artifacts: [],
    ...overrides,
  };
}

describe('ModelConstraintEvaluator', () => {
  const evaluator = new ModelConstraintEvaluator();

  it('passes when model is in allowed list', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({ metadata: { model: 'claude-opus-4-8' } }),
    );
    expect(result.outcome).toBe('pass');
    expect(result.policyId).toBe('builtin:model_constraint');
    expect(result.policyType).toBe('model_constraint');
    expect(result.source.layer).toBe('builtin');
  });

  it('fails when model is not in allowed list', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({ metadata: { model: 'gpt-3.5-turbo' } }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('not in the allowed models list');
  });

  it('warns when no model is specified in context', () => {
    const result = evaluator.evaluate(POLICY, makeContext());
    expect(result.outcome).toBe('warn');
    expect(result.reason).toContain('No model specified');
  });

  it('passes when allowed models list is empty', () => {
    const emptyPolicy: PolicyDefinition = {
      ...POLICY,
      config: { allowedModels: [] as string[] },
    };
    const result = evaluator.evaluate(
      emptyPolicy,
      makeContext({ metadata: { model: 'any-model' } }),
    );
    expect(result.outcome).toBe('pass');
    expect(result.reason).toContain('No model constraints configured');
  });

  it('passes for second allowed model', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ metadata: { model: 'gpt-4o' } }));
    expect(result.outcome).toBe('pass');
  });
});
