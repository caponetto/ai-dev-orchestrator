import type { PolicyContext, PolicyDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { TokenBudgetEvaluator } from '../token-budget-evaluator';

const POLICY: PolicyDefinition = {
  id: 'builtin:token_budget',
  type: 'token_budget',
  scope: {},
  config: {
    maxTokens: 100000,
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

describe('TokenBudgetEvaluator', () => {
  const evaluator = new TokenBudgetEvaluator();

  it('passes when token usage is within budget', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        tokenUsage: { inputTokens: 30000, outputTokens: 20000, totalTokens: 50000 },
      }),
    );
    expect(result.outcome).toBe('pass');
    expect(result.policyId).toBe('builtin:token_budget');
    expect(result.policyType).toBe('token_budget');
    expect(result.source.layer).toBe('builtin');
  });

  it('passes when token usage exactly equals budget', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        tokenUsage: { inputTokens: 50000, outputTokens: 50000, totalTokens: 100000 },
      }),
    );
    expect(result.outcome).toBe('pass');
  });

  it('fails when token usage exceeds budget', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        tokenUsage: { inputTokens: 60000, outputTokens: 50000, totalTokens: 110000 },
      }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('exceeded');
    expect(result.escalationTrigger).toBe('token_budget_exceeded');
  });

  it('defaults token usage to 0 when not provided', () => {
    const result = evaluator.evaluate(POLICY, makeContext());
    expect(result.outcome).toBe('pass');
  });
});
