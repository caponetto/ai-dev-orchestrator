import { DefaultAgreementGate } from '@ai-dev-orchestrator/artifacts';
import type { ArtifactStore, IterationContractRegistry } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { TransitionRequest } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { PLAN_REVIEW_LOOP } from '../../iteration-contracts/built-in-contracts';
import { DefaultGovernanceEngine } from '../transition-gate';

function makeRegistry(
  overrides: Partial<IterationContractRegistry> = {},
): IterationContractRegistry {
  const base = {
    getContract: vi.fn().mockReturnValue(null),
    listContracts: vi.fn().mockReturnValue([]),
    getContractForState: vi.fn().mockReturnValue(null),
    getIterationState: vi.fn(),
    recordStateEntry: vi.fn(),
    restoreIterationCounts: vi.fn(),
    restoreJudgeArbitrationCounts: vi.fn(),
    resetIterationCount: vi.fn(),
    ...overrides,
  };
  return base;
}

function makeRequest(overrides: Partial<TransitionRequest> = {}): TransitionRequest {
  return {
    runId: createRunId('run-001'),
    from: 'INTAKE',
    to: 'REFINEMENT',
    artifacts: [],
    ...overrides,
  };
}

describe('DefaultGovernanceEngine', () => {
  it('allows transition when all policies pass', () => {
    const engine = new DefaultGovernanceEngine(makeRegistry());
    const decision = engine.evaluateTransition(makeRequest());

    expect('allowed' in decision && decision.allowed).toBe(true);
  });

  it('denies transition when quality gate fails', () => {
    const engine = new DefaultGovernanceEngine(makeRegistry());
    const decision = engine.evaluateTransition(
      makeRequest({
        findings: [{ id: 'f1', severity: 'high', status: 'open', description: 'Critical bug' }],
      }),
    );

    expect('allowed' in decision && !decision.allowed).toBe(true);
  });

  it('escalates when iteration limit exceeded', () => {
    const engine = new DefaultGovernanceEngine(
      makeRegistry({
        getContractForState: vi.fn().mockReturnValue(PLAN_REVIEW_LOOP),
      }),
    );
    const decision = engine.evaluateTransition(
      makeRequest({
        from: 'PLAN_REVIEW',
        to: 'IMPLEMENTATION',
        iterationCount: 5,
      }),
    );

    expect('escalate' in decision).toBe(true);
  });

  it('allows transition from planning to implementation', () => {
    const engine = new DefaultGovernanceEngine(makeRegistry());
    const decision = engine.evaluateTransition(
      makeRequest({
        from: 'PLANNING',
        to: 'IMPLEMENTATION',
      }),
    );

    expect('allowed' in decision && decision.allowed).toBe(true);
  });

  it('records all decisions', () => {
    const engine = new DefaultGovernanceEngine(makeRegistry());
    engine.evaluateTransition(makeRequest());
    engine.evaluateTransition(makeRequest({ from: 'PLANNING', to: 'PLAN_REVIEW' }));
  });

  it('checkAgreement returns not-found when no gate configured', () => {
    const engine = new DefaultGovernanceEngine(makeRegistry());
    const status = engine.checkAgreement('PLAN_REVIEW');
    expect(status.exists).toBe(false);
    expect(status.valid).toBe(false);
  });

  it('checkAgreement delegates to agreement gate for mapped stages', () => {
    const gate = {
      check: vi.fn().mockReturnValue({
        exists: true,
        valid: true,
        approvalStatus: 'approved',
        artifactRef: {
          type: 'planning_agreement',
          name: 'planning_agreement',
          version: 1,
          checksum: 'x',
        },
      }),
      register: vi.fn(),
    };
    const engine = new DefaultGovernanceEngine(makeRegistry(), { agreementGate: gate });
    engine.evaluateTransition(makeRequest({ runId: createRunId('run-042') }));
    const status = engine.checkAgreement('IMPLEMENTATION');
    expect(status.exists).toBe(true);
    expect(status.valid).toBe(true);
    expect(status.artifact).toBeDefined();
    expect(gate.check).toHaveBeenCalledWith('planning_agreement', 'run-042');
  });

  it('checkAgreement falls back when stage has no mapping', () => {
    const gate = { check: vi.fn(), register: vi.fn() };
    const engine = new DefaultGovernanceEngine(makeRegistry(), { agreementGate: gate });
    const status = engine.checkAgreement('UNKNOWN_STAGE');
    expect(status.exists).toBe(false);
    expect(gate.check).not.toHaveBeenCalled();
  });

  it('recordDecision stores the decision', () => {
    const engine = new DefaultGovernanceEngine(makeRegistry());
    engine.recordDecision({
      timestamp: new Date().toISOString(),
      runId: createRunId('run-001'),
      transitionRequested: { from: 'INTAKE', to: 'REFINEMENT' },
      policiesEvaluated: [],
      outcome: 'allowed',
      reason: 'Test',
      artifactsInspected: [],
    });
  });

  it('delegates to policy engine when provided', () => {
    const policyEngine = {
      evaluate: vi.fn().mockReturnValue({
        outcome: 'allow',
        results: [
          {
            policyId: 'builtin:iteration_limit',
            policyType: 'iteration_limit',
            outcome: 'pass',
            reason: 'OK',
            source: { layer: 'builtin' },
          },
          {
            policyId: 'builtin:quality_gate',
            policyType: 'quality_gate',
            outcome: 'pass',
            reason: 'OK',
            source: { layer: 'builtin' },
          },
          {
            policyId: 'builtin:specification_readiness',
            policyType: 'specification_readiness',
            outcome: 'pass',
            reason: 'OK',
            source: { layer: 'builtin' },
          },
        ],
        reason: 'All policies passed',
      }),
      resolve: vi.fn(),
      validate: vi.fn(),
      listPolicyTypes: vi.fn(),
    };

    const engine = new DefaultGovernanceEngine(makeRegistry(), { policyEngine });
    const decision = engine.evaluateTransition(makeRequest());

    expect('allowed' in decision && decision.allowed).toBe(true);
    expect(policyEngine.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-001', currentState: 'INTAKE' }),
    );
  });

  it('denies via policy engine when a policy fails', () => {
    const policyEngine = {
      evaluate: vi.fn().mockReturnValue({
        outcome: 'deny',
        results: [
          {
            policyId: 'builtin:quality_gate',
            policyType: 'quality_gate',
            outcome: 'fail',
            reason: 'High severity findings',
            source: { layer: 'builtin' },
          },
        ],
        reason: 'High severity findings',
      }),
      resolve: vi.fn(),
      validate: vi.fn(),
      listPolicyTypes: vi.fn(),
    };

    const engine = new DefaultGovernanceEngine(makeRegistry(), { policyEngine });
    const decision = engine.evaluateTransition(
      makeRequest({
        findings: [{ id: 'f1', severity: 'high', status: 'open', description: 'Bug' }],
      }),
    );

    expect('allowed' in decision && !decision.allowed).toBe(true);
  });

  it('escalates when budget policy fails with escalationTrigger', () => {
    const policyEngine = {
      evaluate: vi.fn().mockReturnValue({
        outcome: 'deny',
        results: [
          {
            policyId: 'config:token_budget',
            policyType: 'token_budget',
            outcome: 'fail',
            reason: 'Budget exceeded',
            escalationTrigger: 'token_budget_exceeded',
            source: { layer: 'config' },
          },
        ],
        reason: 'Budget exceeded',
      }),
      resolve: vi.fn(),
      validate: vi.fn(),
      listPolicyTypes: vi.fn(),
    };

    const engine = new DefaultGovernanceEngine(makeRegistry(), { policyEngine });
    const decision = engine.evaluateTransition(makeRequest());

    expect('escalate' in decision).toBe(true);
  });

  describe('DefaultAgreementGate integration', () => {
    function makeMockArtifactStore(): ArtifactStore {
      return {
        store: vi.fn(),
        get: vi.fn(),
        getLatest: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
        listAll: vi.fn().mockResolvedValue([]),
      } as unknown as ArtifactStore;
    }

    it('blocks when agreement is not registered', () => {
      const gate = new DefaultAgreementGate(makeMockArtifactStore());
      const engine = new DefaultGovernanceEngine(makeRegistry(), { agreementGate: gate });
      engine.evaluateTransition(makeRequest({ runId: createRunId('run-100') }));

      const status = engine.checkAgreement('IMPLEMENTATION');
      expect(status.exists).toBe(false);
      expect(status.valid).toBe(false);
    });

    it('allows when agreement is registered', () => {
      const gate = new DefaultAgreementGate(makeMockArtifactStore());
      gate.register('planning_agreement', {
        exists: true,
        valid: true,
        approvalStatus: 'approved',
      });
      const engine = new DefaultGovernanceEngine(makeRegistry(), { agreementGate: gate });
      engine.evaluateTransition(makeRequest({ runId: createRunId('run-101') }));

      const status = engine.checkAgreement('IMPLEMENTATION');
      expect(status.exists).toBe(true);
      expect(status.valid).toBe(true);
    });

    it('WAITING_FOR_HUMAN has no agreement gate (it is a pause state)', () => {
      const gate = new DefaultAgreementGate(makeMockArtifactStore());
      expect(gate.getRequiredAgreement('WAITING_FOR_HUMAN')).toBeNull();
    });

    it('evaluateTransition denies when required agreement is missing', () => {
      const gate = new DefaultAgreementGate(makeMockArtifactStore());
      const engine = new DefaultGovernanceEngine(makeRegistry(), { agreementGate: gate });
      const decision = engine.evaluateTransition(
        makeRequest({
          runId: createRunId('run-200'),
          from: 'PLAN_REVIEW',
          to: 'IMPLEMENTATION',
        }),
      );
      expect('allowed' in decision && !decision.allowed).toBe(true);
      if ('allowed' in decision && !decision.allowed) {
        expect(decision.reason).toContain('planning_agreement');
      }
    });

    it('evaluateTransition allows when required agreement is registered', () => {
      const gate = new DefaultAgreementGate(makeMockArtifactStore());
      gate.register('planning_agreement', {
        exists: true,
        valid: true,
        approvalStatus: 'approved',
      });
      const engine = new DefaultGovernanceEngine(makeRegistry(), { agreementGate: gate });
      const decision = engine.evaluateTransition(
        makeRequest({
          runId: createRunId('run-201'),
          from: 'PLAN_REVIEW',
          to: 'IMPLEMENTATION',
          humanApproval: {
            approvedBy: 'engineer',
            timestamp: new Date().toISOString(),
          },
        }),
      );
      expect('allowed' in decision && decision.allowed).toBe(true);
    });

    it('evaluateTransition skips agreement check for non-gated targets', () => {
      const gate = new DefaultAgreementGate(makeMockArtifactStore());
      const engine = new DefaultGovernanceEngine(makeRegistry(), { agreementGate: gate });
      const decision = engine.evaluateTransition(
        makeRequest({
          runId: createRunId('run-202'),
          from: 'INTAKE',
          to: 'REFINEMENT',
        }),
      );
      expect('allowed' in decision && decision.allowed).toBe(true);
    });
  });
});
