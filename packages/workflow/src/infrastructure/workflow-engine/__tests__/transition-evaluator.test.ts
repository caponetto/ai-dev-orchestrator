import type {
  ArtifactStore,
  GovernanceEngine,
  IterationContractRegistry,
} from '@ai-orchestrator/ports';
import type { StateDefinition, TransitionContext } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { GuardChecker } from '../guard-checker';
import { TransitionEvaluator } from '../transition-evaluator';

function makeStore(): ArtifactStore {
  return {
    store: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    getLatest: vi
      .fn()
      .mockResolvedValue({ type: 'plan', name: 'plan', version: 1, checksum: 'abc', content: '' }),
    list: vi.fn().mockResolvedValue([]),
    history: vi.fn().mockResolvedValue([]),
    verify: vi.fn().mockResolvedValue({ valid: true }),
    inventory: vi.fn().mockResolvedValue({ artifacts: [], totalSize: 0 }),
  };
}

function makeContractRegistry(): IterationContractRegistry {
  return {
    getContract: vi.fn().mockReturnValue(null),
    listContracts: vi.fn().mockReturnValue([]),
    getContractForState: vi.fn().mockReturnValue(null),
    getIterationState: vi.fn(),
    recordStateEntry: vi.fn(),
    restoreIterationCounts: vi.fn(),
    restoreJudgeArbitrationCounts: vi.fn(),
    resetIterationCount: vi.fn(),
  };
}

function makeGovernance(overrides: Partial<GovernanceEngine> = {}): GovernanceEngine {
  return {
    evaluateTransition: vi.fn().mockReturnValue({ allowed: true, reason: 'pass' }),
    checkAgreement: vi.fn().mockReturnValue({ exists: false, valid: false }),
    recordDecision: vi.fn(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    runId: 'run-001',
    currentIteration: 0,
    stateHistory: ['PLANNING'],
    ...overrides,
  };
}

const PLAN_REVIEW_STATE: StateDefinition = {
  type: 'review',
  description: 'Review the plan',
  transitions: [
    {
      target: 'IMPLEMENTATION',
      trigger: 'review_approved',
      guards: [],
      governanceRequired: true,
      priority: 1,
    },
    {
      target: 'PLANNING',
      trigger: 'review_rejected',
      guards: [],
      governanceRequired: false,
      priority: 2,
    },
  ],
};

describe('TransitionEvaluator', () => {
  it('returns first matching transition for trigger', async () => {
    const checker = new GuardChecker(makeStore(), makeContractRegistry());
    const evaluator = new TransitionEvaluator(checker, makeGovernance());
    const result = await evaluator.evaluate(PLAN_REVIEW_STATE, 'review_approved', makeContext());
    expect(result).not.toBeNull();
    expect(result?.definition.target).toBe('IMPLEMENTATION');
  });

  it('returns null when no transitions match the trigger', async () => {
    const checker = new GuardChecker(makeStore(), makeContractRegistry());
    const evaluator = new TransitionEvaluator(checker, makeGovernance());
    const result = await evaluator.evaluate(PLAN_REVIEW_STATE, 'timeout', makeContext());
    expect(result).toBeNull();
  });

  it('skips transitions with failing guards', async () => {
    const store = makeStore();
    store.getLatest = vi.fn().mockResolvedValue(null) as ArtifactStore['getLatest'];
    const checker = new GuardChecker(store, makeContractRegistry());
    const evaluator = new TransitionEvaluator(checker, makeGovernance());

    const state: StateDefinition = {
      type: 'action',
      description: 'Test state',
      transitions: [
        {
          target: 'NEXT',
          trigger: 'completion',
          guards: [{ type: 'artifact_exists', params: { artifactType: 'missing' } }],
          governanceRequired: false,
          priority: 1,
        },
      ],
    };
    const result = await evaluator.evaluate(state, 'completion', makeContext());
    expect(result).toBeNull();
  });

  it('skips transitions when governance denies', async () => {
    const governance = makeGovernance({
      evaluateTransition: vi
        .fn()
        .mockReturnValue({ allowed: false, reason: 'denied', remediation: 'fix' }),
    });
    const checker = new GuardChecker(makeStore(), makeContractRegistry());
    const evaluator = new TransitionEvaluator(checker, governance);
    const result = await evaluator.evaluate(PLAN_REVIEW_STATE, 'review_approved', makeContext());
    expect(result).toBeNull();
  });

  it('returns escalated decision', async () => {
    const governance = makeGovernance({
      evaluateTransition: vi.fn().mockReturnValue({ escalate: true, reason: 'limit', context: {} }),
    });
    const checker = new GuardChecker(makeStore(), makeContractRegistry());
    const evaluator = new TransitionEvaluator(checker, governance);
    const result = await evaluator.evaluate(PLAN_REVIEW_STATE, 'review_approved', makeContext());
    expect(result).not.toBeNull();
    expect(result?.governanceDecision).toBe('escalated');
  });

  it('evaluates iteration_exhausted trigger', async () => {
    const state: StateDefinition = {
      type: 'review',
      description: 'Code review',
      transitions: [
        {
          target: 'JUDGE_REVIEW',
          trigger: 'iteration_exhausted',
          guards: [],
          governanceRequired: false,
          priority: 1,
        },
      ],
    };
    const checker = new GuardChecker(makeStore(), makeContractRegistry());
    const evaluator = new TransitionEvaluator(checker, makeGovernance());
    const result = await evaluator.evaluate(state, 'iteration_exhausted', makeContext());
    expect(result).not.toBeNull();
    expect(result?.definition.target).toBe('JUDGE_REVIEW');
  });

  it('evaluates judge_approved trigger', async () => {
    const state: StateDefinition = {
      type: 'judge',
      description: 'Judge review',
      transitions: [
        {
          target: 'VERIFICATION',
          trigger: 'judge_approved',
          guards: [],
          governanceRequired: false,
          priority: 1,
        },
        {
          target: 'IMPLEMENTATION',
          trigger: 'judge_rejected',
          guards: [],
          governanceRequired: false,
          priority: 2,
        },
      ],
    };
    const checker = new GuardChecker(makeStore(), makeContractRegistry());
    const evaluator = new TransitionEvaluator(checker, makeGovernance());
    const approved = await evaluator.evaluate(state, 'judge_approved', makeContext());
    expect(approved?.definition.target).toBe('VERIFICATION');
    const rejected = await evaluator.evaluate(state, 'judge_rejected', makeContext());
    expect(rejected?.definition.target).toBe('IMPLEMENTATION');
  });
});
