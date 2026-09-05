import type { PolicyContext, PolicyDefinition } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { StageSkipEvaluator } from '../stage-skip-evaluator';

const POLICY = {
  id: 'builtin:stage_skip',
  type: 'stage_skip' as const,
  scope: {},
  config: {
    skipWhen: [
      { field: 'state', equals: 'CODE_REVIEW', reason: 'security review not needed' },
      { field: 'role', equals: 'junior', reason: 'junior role skips this stage' },
      { field: 'workflowVariant', equals: 'fast', reason: 'fast variant skips' },
      { field: 'metadata', key: 'skipStage', equals: true, reason: 'metadata flag set' },
    ],
  },
  enabled: true,
} satisfies PolicyDefinition;

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    runId: 'run-001',
    currentState: 'PLAN_REVIEW',
    artifacts: [],
    ...overrides,
  };
}

describe('StageSkipEvaluator', () => {
  const evaluator = new StageSkipEvaluator();

  it('passes when no skip conditions match', () => {
    const result = evaluator.evaluate(POLICY, makeContext());
    expect(result.outcome).toBe('pass');
    expect(result.policyId).toBe('builtin:stage_skip');
    expect(result.policyType).toBe('stage_skip');
    expect(result.source.layer).toBe('builtin');
  });

  it('skips when state matches a skip condition', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ currentState: 'CODE_REVIEW' }));
    expect(result.outcome).toBe('skip');
    expect(result.reason).toContain('security review not needed');
  });

  it('skips when role matches a skip condition', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ role: 'junior' }));
    expect(result.outcome).toBe('skip');
    expect(result.reason).toContain('junior role skips this stage');
  });

  it('skips when workflowVariant matches a skip condition', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ workflowVariant: 'fast' }));
    expect(result.outcome).toBe('skip');
    expect(result.reason).toContain('fast variant skips');
  });

  it('skips when metadata key matches a skip condition', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ metadata: { skipStage: true } }));
    expect(result.outcome).toBe('skip');
    expect(result.reason).toContain('metadata flag set');
  });

  it('passes when metadata key does not match', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ metadata: { skipStage: false } }));
    expect(result.outcome).toBe('pass');
  });

  it('passes with empty skipWhen config', () => {
    const emptyPolicy: PolicyDefinition = {
      ...POLICY,
      config: {
        skipWhen: [] as { field: string; key?: string; equals?: unknown; reason?: string }[],
      },
    };
    const result = evaluator.evaluate(emptyPolicy, makeContext());
    expect(result.outcome).toBe('pass');
  });

  it('includes detail with skip_condition field', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ currentState: 'CODE_REVIEW' }));
    expect(result.detail).toContain('skip_condition:state');
  });
});
