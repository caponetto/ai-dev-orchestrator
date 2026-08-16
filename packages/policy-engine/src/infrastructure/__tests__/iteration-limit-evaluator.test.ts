import type { PolicyContext, PolicyDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { IterationLimitEvaluator } from '../iteration-limit-evaluator';

const POLICY: PolicyDefinition = {
  id: 'builtin:iteration_limit',
  type: 'iteration_limit',
  scope: {},
  config: {
    maxReviewIterations: 2,
    maxJudgeArbitrations: 1,
    maxClarificationRounds: 3,
    maxAcceptanceIterations: 3,
  },
  enabled: true,
};

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    runId: 'run-001',
    currentState: 'PLAN_REVIEW',
    artifacts: [],
    ...overrides,
  };
}

describe('IterationLimitEvaluator', () => {
  const evaluator = new IterationLimitEvaluator();

  it('passes when iteration count is below review limit', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ iterationCount: 1 }));
    expect(result.outcome).toBe('pass');
    expect(result.policyId).toBe('builtin:iteration_limit');
    expect(result.policyType).toBe('iteration_limit');
    expect(result.source.layer).toBe('builtin');
  });

  it('fails when iteration count reaches review limit', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ iterationCount: 2 }));
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('exceeded');
    expect(result.escalationTrigger).toBe('iteration_limit_exceeded');
  });

  it('fails when iteration count exceeds review limit', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ iterationCount: 5 }));
    expect(result.outcome).toBe('fail');
  });

  it('uses clarification limit for WAITING_FOR_HUMAN state', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({ currentState: 'WAITING_FOR_HUMAN', iterationCount: 2 }),
    );
    expect(result.outcome).toBe('pass');
  });

  it('fails clarification at limit 3', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({ currentState: 'WAITING_FOR_HUMAN', iterationCount: 3 }),
    );
    expect(result.outcome).toBe('fail');
  });

  it('uses clarification limit for REFINEMENT state', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({ currentState: 'REFINEMENT', iterationCount: 2 }),
    );
    expect(result.outcome).toBe('pass');
  });

  it('defaults iteration count to 0 when not provided', () => {
    const result = evaluator.evaluate(POLICY, makeContext());
    expect(result.outcome).toBe('pass');
  });
});
