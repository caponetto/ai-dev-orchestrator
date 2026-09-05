import type { PolicyContext, PolicyDefinition } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { ConfidenceEvaluator } from '../confidence-evaluator';

const POLICY: PolicyDefinition = {
  id: 'test:confidence_gate',
  type: 'confidence_gate',
  scope: {},
  config: {
    modelEscalationThreshold: 0.5,
    humanEscalationThreshold: 0.3,
    heuristicWeight: 0.3,
    heuristicSignals: {
      penalizeHedgingLanguage: true,
      penalizeHighRetryCount: true,
      penalizeUnresolvedFindings: true,
    },
  },
  enabled: true,
};

function makeContext(overrides?: Partial<PolicyContext>): PolicyContext {
  return {
    runId: 'run-test-001',
    currentState: 'implementation',
    artifacts: [],
    ...overrides,
  };
}

describe('ConfidenceEvaluator', () => {
  const evaluator = new ConfidenceEvaluator();

  it('passes when agent confidence is above model escalation threshold', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        metadata: {
          confidenceReport: {
            score: 0.8,
            criteriaResults: [],
            rationale: 'High confidence',
          },
        },
      }),
    );
    expect(result.outcome).toBe('pass');
  });

  it('fails with confidence_too_low when below model threshold', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        metadata: {
          confidenceReport: {
            score: 0.4,
            criteriaResults: [],
            rationale: 'Moderate uncertainty',
          },
        },
      }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.escalationTrigger).toBe('confidence_too_low');
  });

  it('fails with confidence_too_low when below human threshold', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        metadata: {
          confidenceReport: {
            score: 0.1,
            criteriaResults: [],
            rationale: 'Very uncertain',
          },
        },
      }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.escalationTrigger).toBe('confidence_too_low');
  });

  it('falls back to heuristic-only when no confidence report present', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ metadata: { retryCount: 0 } }));
    expect(result.outcome).toBe('pass');
  });

  it('penalizes high retry count in heuristic score', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        metadata: {
          confidenceReport: {
            score: 0.45,
            criteriaResults: [],
            rationale: 'Seems ok',
          },
          retryCount: 3,
        },
      }),
    );
    expect(result.outcome).toBe('fail');
  });

  it('detects divergence between agent and heuristic scores', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        metadata: {
          confidenceReport: {
            score: 0.95,
            criteriaResults: [],
            rationale: 'Very confident',
          },
          retryCount: 3,
        },
        findings: [
          { id: 'f1', severity: 'high', blocking: 'must_fix', status: 'open' },
          { id: 'f2', severity: 'high', blocking: 'must_fix', status: 'open' },
        ],
      }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('diverge');
  });

  it('throws when policy type does not match', () => {
    const wrongPolicy = { ...POLICY, type: 'iteration_limit' as const } as PolicyDefinition;
    expect(() => evaluator.evaluate(wrongPolicy, makeContext())).toThrow();
  });
});
