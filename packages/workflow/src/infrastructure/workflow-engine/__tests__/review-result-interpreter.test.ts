import type { ArtifactStore, IterationContractRegistry } from '@ai-dev-orchestrator/ports';
import type {
  ActionResult,
  Artifact,
  IterationContract,
  IterationState,
} from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { ReviewResultInterpreter } from '../review-result-interpreter';

function makeArtifactStore(overrides: Partial<ArtifactStore> = {}): ArtifactStore {
  return {
    store: vi.fn(),
    get: vi.fn(),
    getLatest: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    history: vi.fn().mockResolvedValue([]),
    verify: vi.fn(),
    inventory: vi.fn(),
    ...overrides,
  };
}

function makeContract(overrides: Partial<IterationContract> = {}): IterationContract {
  return {
    id: 'plan-review-contract',
    name: 'Plan Review',
    description: 'Plan review iteration contract',
    producer: 'planner',
    reviewers: [{ role: 'plan_reviewer', output: 'plan_review', inputs: ['plan'] }],
    aggregation: 'all_must_pass',
    producerInputs: ['canonical_specification'],
    producerOutput: 'plan',
    successCondition: { type: 'no_blocking_findings' },
    failureCondition: { type: 'max_iterations_exceeded' },
    maxIterations: 3,
    maxJudgeArbitrations: 2,
    escalationPolicy: {
      action: 'escalate_to_human',
      produceEscalationArtifact: true,
      includeFullHistory: true,
    },
    ...overrides,
  };
}

function makeIterationState(overrides: Partial<IterationState> = {}): IterationState {
  return {
    contractId: 'plan-review-contract',
    currentIteration: 1,
    judgeArbitrations: 0,
    producerArtifactVersions: [],
    reviewerArtifactVersions: [],
    findingsTotal: 0,
    findingsResolved: 0,
    findingsOpen: 0,
    status: 'in_progress',
    ...overrides,
  };
}

function makeContractRegistry(
  contract: IterationContract | null = null,
  iterState: IterationState = makeIterationState(),
): IterationContractRegistry {
  return {
    getContract: vi.fn().mockReturnValue(contract),
    listContracts: vi.fn().mockReturnValue(contract ? [contract] : []),
    getContractForState: vi.fn().mockReturnValue(contract),
    getIterationState: vi.fn().mockReturnValue(iterState),
    recordStateEntry: vi.fn(),
    restoreIterationCounts: vi.fn(),
    restoreJudgeArbitrationCounts: vi.fn(),
    resetIterationCount: vi.fn(),
  };
}

function approvedArtifact(type: string): Artifact {
  return {
    ref: { type: type as Artifact['ref']['type'], name: `${type}-1`, version: 1, checksum: 'abc' },
    type: type as Artifact['type'],
    name: `${type}-1`,
    version: 1,
    checksum: 'abc',
    content: '---\napproved: true\nfindings: []\n---\nLooks good.',
    producedBy: 'reviewer',
    createdAt: '2024-01-01T00:00:00Z',
    sizeBytes: 50,
    metadata: {},
  };
}

function rejectedArtifact(type: string): Artifact {
  return {
    ref: { type: type as Artifact['ref']['type'], name: `${type}-1`, version: 1, checksum: 'abc' },
    type: type as Artifact['type'],
    name: `${type}-1`,
    version: 1,
    checksum: 'abc',
    content: '---\napproved: false\nfindings: ["issue"]\n---\nNeeds work.',
    producedBy: 'reviewer',
    createdAt: '2024-01-01T00:00:00Z',
    sizeBytes: 50,
    metadata: {},
  };
}

function successResult(type: string, name: string): ActionResult {
  return {
    action: { type: 'dispatch_worker', params: { role: 'reviewer' } },
    success: true,
    artifactRef: {
      type: type as ActionResult['artifactRef'] extends undefined
        ? never
        : NonNullable<ActionResult['artifactRef']>['type'],
      name,
      version: 1,
      checksum: 'abc',
    },
  };
}

function failureResult(): ActionResult {
  return {
    action: { type: 'dispatch_worker', params: { role: 'reviewer' } },
    success: false,
    error: 'process crashed',
  };
}

function invalidOutputResult(): ActionResult {
  return {
    action: { type: 'dispatch_worker', params: { role: 'reviewer' } },
    success: false,
    error: 'Invalid worker output: /approved: required property missing',
    errorType: 'invalid_output',
  };
}

function providerFailureResult(): ActionResult {
  return {
    action: { type: 'dispatch_worker', params: { role: 'reviewer' } },
    success: false,
    error: 'connection refused',
    errorType: 'agent_error',
  };
}

describe('ReviewResultInterpreter', () => {
  it('review state + all approved → review_approved', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(approvedArtifact('plan_review')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const trigger = await interpreter.interpret(
      [successResult('plan_review', 'plan_review-1')],
      'PLAN_REVIEW',
      'review',
    );

    expect(trigger).toBe('review_approved');
  });

  it('review state + not approved → review_rejected', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(rejectedArtifact('plan_review')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const trigger = await interpreter.interpret(
      [successResult('plan_review', 'plan_review-1')],
      'PLAN_REVIEW',
      'review',
    );

    expect(trigger).toBe('review_rejected');
  });

  it('review state + process failure → failure (hard failure, not semantic rejection)', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());

    const trigger = await interpreter.interpret([failureResult()], 'PLAN_REVIEW', 'review');

    expect(trigger).toBe('failure');
  });

  it('review state + process failure ignores iteration count', async () => {
    const contract = makeContract({ maxIterations: 3 });
    const iterState = makeIterationState({ currentIteration: 3 });
    const interpreter = new ReviewResultInterpreter(
      makeArtifactStore(),
      makeContractRegistry(contract, iterState),
    );

    const trigger = await interpreter.interpret([failureResult()], 'PLAN_REVIEW', 'review');

    expect(trigger).toBe('failure');
  });

  it('judge state + approved → judge_approved', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(approvedArtifact('judge_decision')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const trigger = await interpreter.interpret(
      [successResult('judge_decision', 'judge_decision-1')],
      'PLAN_JUDGE',
      'judge',
    );

    expect(trigger).toBe('judge_approved');
  });

  it('judge state + not approved → judge_rejected', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(rejectedArtifact('judge_decision')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const trigger = await interpreter.interpret(
      [successResult('judge_decision', 'judge_decision-1')],
      'PLAN_JUDGE',
      'judge',
    );

    expect(trigger).toBe('judge_rejected');
  });

  it('judge state + process failure → failure (hard failure, not semantic rejection)', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());

    const trigger = await interpreter.interpret([failureResult()], 'PLAN_JUDGE', 'judge');

    expect(trigger).toBe('failure');
  });

  it('judge state + process failure ignores arbitration count', async () => {
    const contract = makeContract({ maxJudgeArbitrations: 2 });
    const iterState = makeIterationState({ judgeArbitrations: 2 });
    const interpreter = new ReviewResultInterpreter(
      makeArtifactStore(),
      makeContractRegistry(contract, iterState),
    );

    const trigger = await interpreter.interpret([failureResult()], 'PLAN_JUDGE', 'judge');

    expect(trigger).toBe('failure');
  });

  it('judge state + arbitration limit exceeded → escalation', async () => {
    const contract = makeContract({ maxJudgeArbitrations: 2 });
    const iterState = makeIterationState({ judgeArbitrations: 2 });
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(rejectedArtifact('judge_decision')),
    });
    const interpreter = new ReviewResultInterpreter(
      store,
      makeContractRegistry(contract, iterState),
    );

    const trigger = await interpreter.interpret(
      [successResult('judge_decision', 'judge_decision-1')],
      'PLAN_JUDGE',
      'judge',
    );

    expect(trigger).toBe('escalation');
  });

  it('judge state + rejected below arbitration limit → judge_rejected', async () => {
    const contract = makeContract({ maxJudgeArbitrations: 3 });
    const iterState = makeIterationState({ judgeArbitrations: 1 });
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(rejectedArtifact('judge_decision')),
    });
    const interpreter = new ReviewResultInterpreter(
      store,
      makeContractRegistry(contract, iterState),
    );

    const trigger = await interpreter.interpret(
      [successResult('judge_decision', 'judge_decision-1')],
      'JUDGE_REVIEW',
      'judge',
    );

    expect(trigger).toBe('judge_rejected');
  });

  it('judge state + no contract → judge_rejected on rejection', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(rejectedArtifact('judge_decision')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry(null));

    const trigger = await interpreter.interpret(
      [successResult('judge_decision', 'judge_decision-1')],
      'JUDGE_REVIEW',
      'judge',
    );

    expect(trigger).toBe('judge_rejected');
  });

  it('review state + JSON approved artifact → review_approved', async () => {
    const jsonArtifact = {
      ...approvedArtifact('plan_review'),
      content: '{"approved": true, "summary": "All good", "findings": []}',
    };
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(jsonArtifact),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const trigger = await interpreter.interpret(
      [successResult('plan_review', 'plan_review-1')],
      'PLAN_REVIEW',
      'review',
    );

    expect(trigger).toBe('review_approved');
  });

  it('review state + JSON rejected artifact → review_rejected', async () => {
    const jsonArtifact = {
      ...rejectedArtifact('plan_review'),
      content: '{"approved": false, "summary": "Needs work", "findings": ["issue"]}',
    };
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(jsonArtifact),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const trigger = await interpreter.interpret(
      [successResult('plan_review', 'plan_review-1')],
      'PLAN_REVIEW',
      'review',
    );

    expect(trigger).toBe('review_rejected');
  });

  it('judge state + JSON approved artifact → judge_approved', async () => {
    const jsonArtifact = {
      ...approvedArtifact('judge_decision'),
      content: '{"approved": true, "rationale": "Looks good"}',
    };
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(jsonArtifact),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const trigger = await interpreter.interpret(
      [successResult('judge_decision', 'judge_decision-1')],
      'PLAN_JUDGE',
      'judge',
    );

    expect(trigger).toBe('judge_approved');
  });

  it('review state + parallel results with all workers failed → failure', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());

    const parallelResult: ActionResult = {
      action: {
        type: 'dispatch_parallel_workers',
        params: { roles: ['static_reviewer', 'security_reviewer'] },
      },
      success: false,
      workerResults: [
        { role: 'static_reviewer', success: false, error: 'API error' },
        { role: 'security_reviewer', success: false, error: 'timeout' },
      ],
    };

    const trigger = await interpreter.interpret([parallelResult], 'CODE_REVIEW', 'review');
    expect(trigger).toBe('failure');
  });

  it('review state + no review artifacts produced → review_rejected (not vacuous approval)', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());

    const parallelResult: ActionResult = {
      action: { type: 'dispatch_parallel_workers', params: { roles: ['static_reviewer'] } },
      success: true,
      workerResults: [
        {
          role: 'static_reviewer',
          success: true,
          artifactRef: { type: 'release_summary', name: 'not-a-review', version: 1, checksum: 'x' },
        },
      ],
    };

    const trigger = await interpreter.interpret([parallelResult], 'CODE_REVIEW', 'review');
    expect(trigger).toBe('review_rejected');
  });

  it('action state + process failure → failure (strict)', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());

    const trigger = await interpreter.interpret([failureResult()], 'IMPLEMENTATION', 'action');

    expect(trigger).toBe('failure');
  });

  it('action state + success → completion', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());

    const trigger = await interpreter.interpret(
      [successResult('implementation', 'impl-1')],
      'IMPLEMENTATION',
      'action',
    );

    expect(trigger).toBe('completion');
  });

  it('review state + invalid_output → review_rejected', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());
    const trigger = await interpreter.interpret([invalidOutputResult()], 'PLAN_REVIEW', 'review');
    expect(trigger).toBe('review_rejected');
  });

  it('review state + invalid_output at iteration limit → iteration_exhausted', async () => {
    const contract = makeContract({ maxIterations: 3 });
    const iterState = makeIterationState({ currentIteration: 3 });
    const interpreter = new ReviewResultInterpreter(
      makeArtifactStore(),
      makeContractRegistry(contract, iterState),
    );

    const trigger = await interpreter.interpret([invalidOutputResult()], 'PLAN_REVIEW', 'review');
    expect(trigger).toBe('iteration_exhausted');
  });

  it('review state + agent_error → failure (hard failure, not semantic rejection)', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());
    const trigger = await interpreter.interpret([providerFailureResult()], 'PLAN_REVIEW', 'review');
    expect(trigger).toBe('failure');
  });

  it('judge state + invalid_output → judge_rejected', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());
    const trigger = await interpreter.interpret([invalidOutputResult()], 'PLAN_JUDGE', 'judge');
    expect(trigger).toBe('judge_rejected');
  });

  it('judge state + invalid_output at arbitration limit → escalation', async () => {
    const contract = makeContract({ maxJudgeArbitrations: 2 });
    const iterState = makeIterationState({ judgeArbitrations: 2 });
    const interpreter = new ReviewResultInterpreter(
      makeArtifactStore(),
      makeContractRegistry(contract, iterState),
    );

    const trigger = await interpreter.interpret([invalidOutputResult()], 'PLAN_JUDGE', 'judge');
    expect(trigger).toBe('escalation');
  });

  it('judge state + agent_error → failure (hard failure, not semantic rejection)', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());
    const trigger = await interpreter.interpret([providerFailureResult()], 'PLAN_JUDGE', 'judge');
    expect(trigger).toBe('failure');
  });

  it('review state + approved artifact plus invalid_output worker → review_rejected', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(approvedArtifact('static_review')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const trigger = await interpreter.interpret(
      [
        successResult('static_review', 'static_review-1'),
        {
          action: {
            type: 'dispatch_parallel_workers',
            params: { roles: ['static_reviewer', 'security_reviewer'] },
          },
          success: true,
          workerResults: [
            {
              role: 'security_reviewer',
              success: false,
              error: 'Invalid worker output: /approved: required property missing',
              errorType: 'invalid_output',
            },
          ],
        },
      ],
      'CODE_REVIEW',
      'review',
    );

    expect(trigger).toBe('review_rejected');
  });

  it('review state + schema_violation → review_rejected', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());
    const result: ActionResult = {
      action: { type: 'dispatch_worker', params: { role: 'reviewer' } },
      success: false,
      error: 'Output does not match required schema',
      errorType: 'schema_violation',
    };
    const trigger = await interpreter.interpret([result], 'PLAN_REVIEW', 'review');
    expect(trigger).toBe('review_rejected');
  });

  it('review state + adversarial_review approved → review_approved', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(approvedArtifact('adversarial_review')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const trigger = await interpreter.interpret(
      [successResult('adversarial_review', 'adversarial_review-1')],
      'CODE_REVIEW',
      'review',
    );

    expect(trigger).toBe('review_approved');
  });

  it('review state + design_review approved → review_approved', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(approvedArtifact('design_review')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const trigger = await interpreter.interpret(
      [successResult('design_review', 'design_review-1')],
      'CODE_REVIEW',
      'review',
    );

    expect(trigger).toBe('review_approved');
  });

  it('review state + semantic failure with review artifact still stored → checks content', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(approvedArtifact('static_review')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const result: ActionResult = {
      action: { type: 'dispatch_worker', params: { role: 'static_reviewer' } },
      success: false,
      error: 'Invalid worker output: /severity: expected string, got number',
      errorType: 'schema_violation',
      artifactRef: { type: 'static_review', name: 'static_review-1', version: 1, checksum: 'abc' },
    };

    const trigger = await interpreter.interpret([result], 'CODE_REVIEW', 'review');
    expect(trigger).toBe('review_approved');
  });

  it('parallel review with all 7 reviewers approved → review_approved', async () => {
    const artifactMap: Record<string, ReturnType<typeof approvedArtifact>> = {
      static_review: approvedArtifact('static_review'),
      design_review: approvedArtifact('design_review'),
      security_review: approvedArtifact('security_review'),
      performance_review: approvedArtifact('performance_review'),
      adversarial_review: approvedArtifact('adversarial_review'),
      docs_review: approvedArtifact('docs_review'),
      ux_review: approvedArtifact('ux_review'),
    };
    const store = makeArtifactStore({
      getLatest: vi.fn().mockImplementation((_type: string, name: string) => {
        const key = name.replace(/-1$/, '');
        return Promise.resolve(artifactMap[key] ?? null);
      }),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const parallelResult: ActionResult = {
      action: {
        type: 'dispatch_parallel_workers',
        params: {
          roles: [
            'static_reviewer',
            'design_reviewer',
            'security_reviewer',
            'performance_reviewer',
            'adversarial_reviewer',
            'docs_reviewer',
            'ux_reviewer',
          ],
        },
      },
      success: true,
      workerResults: [
        {
          role: 'static_reviewer',
          success: true,
          artifactRef: {
            type: 'static_review',
            name: 'static_review-1',
            version: 1,
            checksum: 'a',
          },
        },
        {
          role: 'design_reviewer',
          success: true,
          artifactRef: {
            type: 'design_review',
            name: 'design_review-1',
            version: 1,
            checksum: 'b',
          },
        },
        {
          role: 'security_reviewer',
          success: true,
          artifactRef: {
            type: 'security_review',
            name: 'security_review-1',
            version: 1,
            checksum: 'c',
          },
        },
        {
          role: 'performance_reviewer',
          success: true,
          artifactRef: {
            type: 'performance_review',
            name: 'performance_review-1',
            version: 1,
            checksum: 'd',
          },
        },
        {
          role: 'adversarial_reviewer',
          success: true,
          artifactRef: {
            type: 'adversarial_review',
            name: 'adversarial_review-1',
            version: 1,
            checksum: 'e',
          },
        },
        {
          role: 'docs_reviewer',
          success: true,
          artifactRef: {
            type: 'docs_review',
            name: 'docs_review-1',
            version: 1,
            checksum: 'f',
          },
        },
        {
          role: 'ux_reviewer',
          success: true,
          artifactRef: {
            type: 'ux_review',
            name: 'ux_review-1',
            version: 1,
            checksum: 'g',
          },
        },
      ],
    };

    const trigger = await interpreter.interpret([parallelResult], 'CODE_REVIEW', 'review');
    expect(trigger).toBe('review_approved');
  });

  it('judge state + schema_violation → judge_rejected', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());
    const result: ActionResult = {
      action: { type: 'dispatch_worker', params: { role: 'judge' } },
      success: false,
      error: 'Output does not match required schema',
      errorType: 'schema_violation',
    };
    const trigger = await interpreter.interpret([result], 'PLAN_JUDGE', 'judge');
    expect(trigger).toBe('judge_rejected');
  });

  it('review state + timeout → failure (hard failure)', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());
    const result: ActionResult = {
      action: { type: 'dispatch_worker', params: { role: 'reviewer' } },
      success: false,
      error: 'Worker timed out',
      errorType: 'timeout',
    };
    const trigger = await interpreter.interpret([result], 'PLAN_REVIEW', 'review');
    expect(trigger).toBe('failure');
  });

  it('review state + parallel results with all workers provider-failed → failure', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());

    const parallelResult: ActionResult = {
      action: {
        type: 'dispatch_parallel_workers',
        params: { roles: ['static_reviewer', 'security_reviewer'] },
      },
      success: false,
      workerResults: [
        {
          role: 'static_reviewer',
          success: false,
          error: 'API error',
          errorType: 'agent_error',
        },
        {
          role: 'security_reviewer',
          success: false,
          error: 'timeout',
          errorType: 'agent_error',
        },
      ],
    };

    const trigger = await interpreter.interpret([parallelResult], 'CODE_REVIEW', 'review');
    expect(trigger).toBe('failure');
  });

  it('returns human_input when any action result has sessionOutcome awaiting_human', async () => {
    const interpreter = new ReviewResultInterpreter(makeArtifactStore(), makeContractRegistry());

    const results: ActionResult[] = [
      {
        action: { type: 'dispatch_worker', params: { role: 'implementer' } },
        success: true,
        sessionOutcome: 'awaiting_human',
        sessionRef: {
          sessionId: 'sess-1',
          runId: 'run-1',
          stateId: 'IMPL',
          role: 'implementer',
          transport: 'stdio',
        },
        pendingRequest: {
          requestId: 'req-1',
          kind: 'permission',
          createdAt: '2026-01-01T00:00:00Z',
          payload: { action: 'write_file' },
        },
      },
    ];

    const trigger = await interpreter.interpret(results, 'IMPL', 'action');
    expect(trigger).toBe('human_input');
  });

  it('session awaiting_human takes priority over review state interpretation', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue({
        ref: { type: 'plan_review', name: 'plan_review', version: 1, checksum: 'abc' },
        type: 'plan_review',
        name: 'plan_review',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
        producedBy: 'reviewer',
        createdAt: '2026-01-01T00:00:00Z',
        sizeBytes: 20,
        metadata: {},
      } satisfies Artifact),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const results: ActionResult[] = [
      {
        action: { type: 'dispatch_worker', params: { role: 'reviewer' } },
        success: true,
        sessionOutcome: 'awaiting_human',
        sessionRef: {
          sessionId: 'sess-2',
          runId: 'run-1',
          stateId: 'REVIEW',
          role: 'reviewer',
          transport: 'remote',
        },
      },
    ];

    const trigger = await interpreter.interpret(results, 'REVIEW', 'review');
    expect(trigger).toBe('human_input');
  });

  it('returns failure when no review artifacts produced from parallel dispatch', async () => {
    const store = makeArtifactStore();
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const results: ActionResult[] = [
      {
        action: { type: 'dispatch_parallel_workers', params: { roles: ['a', 'b', 'c'] } },
        success: true,
        workerResults: [
          {
            success: false,
            error: 'timeout',
          },
          {
            success: false,
            error: 'timeout',
          },
          {
            success: false,
            error: 'timeout',
          },
        ],
      },
    ];

    const trigger = await interpreter.interpret(results, 'CODE_REVIEW', 'review');
    expect(trigger).toBe('failure');
  });

  it('returns review_rejected when some reviewers produce rejection artifacts via fail-safe path', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(rejectedArtifact('static_review')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const results: ActionResult[] = [
      {
        action: { type: 'dispatch_parallel_workers', params: { roles: ['a', 'b'] } },
        success: true,
        workerResults: [
          {
            success: true,
            artifactRef: { type: 'static_review', name: 'sr-1', version: 1, checksum: 'x' },
          },
          {
            success: false,
            error: 'invalid output schema',
            errorType: 'invalid_output',
            artifactRef: { type: 'design_review', name: 'dr-1', version: 1, checksum: 'y' },
          },
        ],
      },
    ];

    const trigger = await interpreter.interpret(results, 'CODE_REVIEW', 'review');
    expect(trigger).toBe('review_rejected');
  });

  it('tolerates partial worker failure when other workers succeeded', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(rejectedArtifact('static_review')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const results: ActionResult[] = [
      {
        action: { type: 'dispatch_parallel_workers', params: { roles: ['a', 'b'] } },
        success: true,
        workerResults: [
          {
            success: true,
            artifactRef: { type: 'static_review', name: 'sr-1', version: 1, checksum: 'x' },
          },
          {
            success: false,
            error: 'process crashed',
          },
        ],
      },
    ];

    const trigger = await interpreter.interpret(results, 'CODE_REVIEW', 'review');
    expect(trigger).toBe('review_rejected');
  });

  it('partial worker failure with all surviving reviewers approved → review_approved', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue(approvedArtifact('static_review')),
    });
    const interpreter = new ReviewResultInterpreter(store, makeContractRegistry());

    const results: ActionResult[] = [
      {
        action: { type: 'dispatch_parallel_workers', params: { roles: ['a', 'b'] } },
        success: true,
        workerResults: [
          {
            success: true,
            artifactRef: { type: 'static_review', name: 'sr-1', version: 1, checksum: 'x' },
          },
          {
            success: false,
            error: 'model not available',
          },
        ],
      },
    ];

    const trigger = await interpreter.interpret(results, 'CODE_REVIEW', 'review');
    expect(trigger).toBe('review_approved');
  });
});
