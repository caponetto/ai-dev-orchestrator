import type { PolicyContext, PolicyDefinition } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { RetryLimitEvaluator } from '../retry-limit-evaluator';

const POLICY: PolicyDefinition = {
  id: 'builtin:retry_limit',
  type: 'retry_limit',
  scope: {},
  config: {
    maxRetries: 3,
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

describe('RetryLimitEvaluator', () => {
  const evaluator = new RetryLimitEvaluator();

  it('passes when retry count is below limit', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ metadata: { retryCount: 1 } }));
    expect(result.outcome).toBe('pass');
    expect(result.policyId).toBe('builtin:retry_limit');
    expect(result.policyType).toBe('retry_limit');
    expect(result.source.layer).toBe('builtin');
  });

  it('fails when retry count reaches limit', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ metadata: { retryCount: 3 } }));
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('exceeded');
    expect(result.escalationTrigger).toBe('retry_limit_exceeded');
  });

  it('fails when retry count exceeds limit', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ metadata: { retryCount: 5 } }));
    expect(result.outcome).toBe('fail');
  });

  it('defaults retry count to 0 when not provided', () => {
    const result = evaluator.evaluate(POLICY, makeContext());
    expect(result.outcome).toBe('pass');
  });

  it('passes at zero retries', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ metadata: { retryCount: 0 } }));
    expect(result.outcome).toBe('pass');
  });
});
