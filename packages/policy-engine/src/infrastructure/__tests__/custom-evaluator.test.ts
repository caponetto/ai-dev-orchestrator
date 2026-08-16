import type { PolicyContext, PolicyDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { CustomEvaluator } from '../custom-evaluator';

const POLICY: PolicyDefinition = {
  id: 'custom:my_policy',
  type: 'custom',
  scope: {},
  config: {
    someKey: 'someValue',
  },
  enabled: true,
};

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    runId: 'run-001',
    currentState: 'IMPLEMENTATION',
    artifacts: [],
    ...overrides,
  };
}

describe('CustomEvaluator', () => {
  const evaluator = new CustomEvaluator();

  it('always returns pass', () => {
    const result = evaluator.evaluate(POLICY, makeContext());
    expect(result.outcome).toBe('pass');
    expect(result.policyId).toBe('custom:my_policy');
    expect(result.policyType).toBe('custom');
    expect(result.source.layer).toBe('builtin');
  });

  it('passes regardless of context state', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({ currentState: 'CODE_REVIEW', iterationCount: 100 }),
    );
    expect(result.outcome).toBe('pass');
  });

  it('passes with different policy config', () => {
    const otherPolicy: PolicyDefinition = {
      ...POLICY,
      id: 'custom:other',
      config: { key: 'value' },
    };
    const result = evaluator.evaluate(otherPolicy, makeContext());
    expect(result.outcome).toBe('pass');
    expect(result.policyId).toBe('custom:other');
  });
});
