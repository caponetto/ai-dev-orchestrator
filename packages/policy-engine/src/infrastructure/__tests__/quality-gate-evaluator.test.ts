import type { PolicyContext, PolicyDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { QualityGateEvaluator } from '../quality-gate-evaluator';

const POLICY = {
  id: 'builtin:quality_gate',
  type: 'quality_gate' as const,
  scope: {},
  config: {
    maxHighSeverityFindings: 0,
    maxMediumSeverityFindings: 3,
  },
  enabled: true,
} satisfies PolicyDefinition;

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    runId: 'run-001',
    currentState: 'VERIFICATION',
    artifacts: [],
    ...overrides,
  };
}

describe('QualityGateEvaluator', () => {
  const evaluator = new QualityGateEvaluator();

  it('passes when no findings', () => {
    const result = evaluator.evaluate(POLICY, makeContext());
    expect(result.outcome).toBe('pass');
    expect(result.reason).toBe('All quality gates passed');
  });

  it('fails when high severity findings exceed limit', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        findings: [{ id: 'f1', severity: 'high', blocking: 'must_fix', status: 'open' }],
      }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('high-severity');
  });

  it('ignores resolved high severity findings', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        findings: [{ id: 'f1', severity: 'high', blocking: 'must_fix', status: 'addressed' }],
      }),
    );
    expect(result.outcome).toBe('pass');
  });

  it('fails when medium severity findings exceed limit', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        findings: [
          { id: 'f1', severity: 'medium', blocking: 'should_fix', status: 'open' },
          { id: 'f2', severity: 'medium', blocking: 'should_fix', status: 'open' },
          { id: 'f3', severity: 'medium', blocking: 'should_fix', status: 'open' },
          { id: 'f4', severity: 'medium', blocking: 'should_fix', status: 'open' },
        ],
      }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('medium-severity');
  });

  it('reports multiple failures at once', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        findings: [
          { id: 'f1', severity: 'high', blocking: 'must_fix', status: 'open' },
          { id: 'f2', severity: 'medium', blocking: 'should_fix', status: 'open' },
          { id: 'f3', severity: 'medium', blocking: 'should_fix', status: 'open' },
          { id: 'f4', severity: 'medium', blocking: 'should_fix', status: 'open' },
          { id: 'f5', severity: 'medium', blocking: 'should_fix', status: 'open' },
        ],
      }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('high-severity');
    expect(result.reason).toContain('medium-severity');
  });

  it('skips review artifact checks for pre-code-review states', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({ currentState: 'PLAN_REVIEW', artifacts: [] }),
    );
    expect(result.outcome).toBe('pass');
    expect(result.reason).toBe('All quality gates passed');
  });

  it('passes with relaxed finding thresholds', () => {
    const relaxedPolicy: PolicyDefinition = {
      ...POLICY,
      config: {
        maxHighSeverityFindings: 10,
        maxMediumSeverityFindings: 10,
      },
    };
    const result = evaluator.evaluate(relaxedPolicy, makeContext());
    expect(result.outcome).toBe('pass');
  });
});
