import type { PolicyContext, PolicyDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { TEST_POLICIES } from '../../../test/fixtures/test-defaults';
import { DefaultPolicyEngine } from '../default-policy-engine';
import { DefaultPolicyRegistry } from '../policy-registry';
import { PolicyResolver } from '../policy-resolver';

function makeEngine(): DefaultPolicyEngine {
  return new DefaultPolicyEngine(new DefaultPolicyRegistry(), new PolicyResolver(TEST_POLICIES));
}

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    runId: 'run-001',
    currentState: 'INTAKE',
    artifacts: [],
    ...overrides,
  };
}

describe('DefaultPolicyEngine', () => {
  it('allows when all policies pass', () => {
    const engine = makeEngine();
    const decision = engine.evaluate(
      makeContext({
        currentState: 'INTAKE',
        iterationCount: 0,
        artifacts: [
          { type: 'static_review', name: 'sr', version: 1, checksum: 'a' },
          { type: 'security_review', name: 'sec', version: 1, checksum: 'b' },
          { type: 'performance_review', name: 'perf', version: 1, checksum: 'c' },
          { type: 'canonical_specification', name: 'spec', version: 1, checksum: 'd' },
        ],
      }),
    );
    expect(decision.outcome).toBe('allow');
    expect(decision.reason).toBe('All policies passed');
  });

  it('denies when quality gate fails', () => {
    const engine = makeEngine();
    const decision = engine.evaluate(
      makeContext({
        currentState: 'INTAKE',
        iterationCount: 0,
        findings: [{ id: 'f1', severity: 'high', blocking: 'must_fix', status: 'open' }],
      }),
    );
    expect(decision.outcome).toBe('deny');
    expect(decision.reason).toContain('high-severity');
    expect(decision.remediations).toBeDefined();
    expect(decision.remediations?.length).toBeGreaterThan(0);
  });

  it('escalates when iteration limit exceeded', () => {
    const engine = makeEngine();
    const decision = engine.evaluate(
      makeContext({
        currentState: 'PLAN_REVIEW',
        iterationCount: 5,
        artifacts: [
          { type: 'static_review', name: 'sr', version: 1, checksum: 'a' },
          { type: 'security_review', name: 'sec', version: 1, checksum: 'b' },
          { type: 'performance_review', name: 'perf', version: 1, checksum: 'c' },
          { type: 'canonical_specification', name: 'spec', version: 1, checksum: 'd' },
        ],
      }),
    );
    expect(decision.outcome).toBe('escalate');
    expect(decision.escalationTrigger).toBe('iteration_limit_exceeded');
  });

  it('returns all policy results in the decision', () => {
    const engine = makeEngine();
    const decision = engine.evaluate(makeContext());
    expect(decision.results.length).toBe(3);
    expect(decision.results.map((r) => r.policyType)).toEqual(
      expect.arrayContaining(['iteration_limit', 'quality_gate', 'specification_readiness']),
    );
  });

  it('resolves policies for a scope', () => {
    const engine = makeEngine();
    const resolved = engine.resolve({});
    expect(resolved.policies).toHaveLength(3);
  });

  it('validates a valid policy definition', () => {
    const engine = makeEngine();
    const result = engine.validate({
      id: 'test:policy',
      type: 'iteration_limit',
      scope: {},
      config: {
        maxReviewIterations: 3,
        maxJudgeArbitrations: 1,
        maxClarificationRounds: 3,
        maxAcceptanceIterations: 3,
      },
      enabled: true,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports warning for unregistered policy type', () => {
    const engine = makeEngine();
    const result = engine.validate({
      id: 'test:nonexistent',
      type: 'nonexistent',
      scope: {},
      config: {},
      enabled: true,
    } as unknown as PolicyDefinition);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('nonexistent');
  });

  it('lists all registered policy types', () => {
    const engine = makeEngine();
    const types = engine.listPolicyTypes();
    expect(types).toHaveLength(10);
  });
});
