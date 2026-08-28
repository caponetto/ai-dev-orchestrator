import type {
  ArtifactSummary,
  EngineState,
  ManifestIterationSummary,
  ManifestTokenUsage,
  PersistedState,
  RoleUsage,
  RunManifest,
  TransitionRecord,
  WorkflowDefinition,
} from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import type { FindingData } from '../view-projector';
import {
  deduplicateFindings,
  projectArtifactDetail,
  projectArtifactView,
  projectFindingsView,
  projectIterationView,
  projectIterationViewFromState,
  projectRunConfig,
  projectRunState,
  projectRunSummary,
  projectUsageView,
  projectUsageViewFromState,
  projectWorkflowPreview,
  projectWorkflowView,
} from '../view-projector';

const engineState: EngineState = {
  runId: 'run-1',
  currentState: 'PLANNING',
  previousState: 'INTAKE',
  stateEnteredAt: '2025-01-15T10:01:00Z',
  transitionCount: 1,
  isWaitingForHuman: false,
};

describe('projectRunState', () => {
  it('projects engine state to run state view', () => {
    const view = projectRunState(engineState, '2025-01-15T10:00:00Z', '2025-01-15T10:05:00Z');
    expect(view.runId).toBe('run-1');
    expect(view.status).toBe('running');
    expect(view.currentState).toBe('PLANNING');
    expect(view.previousState).toBe('INTAKE');
    expect(view.elapsedMs).toBe(300_000);
    expect(view.transitionCount).toBe(1);
  });

  it('sets status to completed when in a terminal DONE state', () => {
    const done: EngineState = { ...engineState, currentState: 'DONE' };
    const stateTypes = { DONE: 'terminal', ABORTED: 'terminal', PLANNING: 'action' };
    const view = projectRunState(done, '2025-01-15T10:00:00Z', '2025-01-15T10:05:00Z', stateTypes);
    expect(view.status).toBe('completed');
  });

  it('sets status to failed when in a terminal FAILED state', () => {
    const failed: EngineState = { ...engineState, currentState: 'FAILED' };
    const stateTypes = { DONE: 'terminal', FAILED: 'terminal', ABORTED: 'terminal' };
    const view = projectRunState(
      failed,
      '2025-01-15T10:00:00Z',
      '2025-01-15T10:05:00Z',
      stateTypes,
    );
    expect(view.status).toBe('failed');
  });

  it('sets status to aborted when in a terminal ABORTED state', () => {
    const aborted: EngineState = { ...engineState, currentState: 'ABORTED' };
    const stateTypes = { DONE: 'terminal', ABORTED: 'terminal', PLANNING: 'action' };
    const view = projectRunState(
      aborted,
      '2025-01-15T10:00:00Z',
      '2025-01-15T10:05:00Z',
      stateTypes,
    );
    expect(view.status).toBe('aborted');
  });

  it('defaults to running when stateTypes not provided', () => {
    const view = projectRunState(engineState, '2025-01-15T10:00:00Z', '2025-01-15T10:05:00Z');
    expect(view.status).toBe('running');
  });

  it('sets status to waiting when waiting for human', () => {
    const waiting: EngineState = {
      ...engineState,
      isWaitingForHuman: true,
      waitingContext: {
        reason: 'Approval needed',
        requiredInput: 'approval',
        requestingState: 'WAITING_FOR_HUMAN',
        autoResumeSafe: true,
        presentedArtifacts: [],
        waitingSince: '2025-01-15T10:03:00Z',
      },
    };
    const view = projectRunState(waiting, '2025-01-15T10:00:00Z', '2025-01-15T10:05:00Z');
    expect(view.status).toBe('waiting');
    expect(view.waitingReason).toBe('Approval needed');
    expect(view.waitingContext).toBeDefined();
    expect(view.waitingContext?.reason).toBe('Approval needed');
    expect(view.waitingContext?.requiredInput).toBe('approval');
    expect(view.waitingContext?.presentedArtifacts).toEqual([]);
    expect(view.waitingContext?.waitingSince).toBe('2025-01-15T10:03:00Z');
  });
});

describe('projectRunConfig', () => {
  it('uses only snapshot assignment fields for role dispatch metadata', () => {
    const view = projectRunConfig({
      roles: {
        assignments: {
          planner: {
            model: 'claude-opus-4-8',
          },
        },
      },
    });

    expect(view.roles).toEqual([
      {
        role: 'planner',
        model: 'claude-opus-4-8',
        dispatchType: undefined,
        runner: undefined,
        maxTokens: null,
        timeoutMs: undefined,
        maxTurns: undefined,
      },
    ]);
  });

  it('extracts timeoutMs, maxTurns from agentConfig and maxTokens from assignment', () => {
    const view = projectRunConfig({
      roles: {
        assignments: {
          developer: {
            model: 'claude-sonnet-5',
            runner: 'claude-code',
            maxTokens: 8192,
            agentConfig: { timeoutMs: 1200000, maxTurns: 25 },
          },
        },
      },
    });

    expect(view.roles).toEqual([
      {
        role: 'developer',
        model: 'claude-sonnet-5',
        dispatchType: undefined,
        runner: 'claude-code',
        maxTokens: 8192,
        timeoutMs: 1200000,
        maxTurns: 25,
      },
    ]);
  });
});

describe('projectWorkflowView', () => {
  it('builds state nodes and transition edges', () => {
    const transitions: TransitionRecord[] = [
      {
        timestamp: '2025-01-15T10:00:00Z',
        runId: 'run-1',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        guardsEvaluated: [],
        durationMs: 500,
      },
    ];

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['INTAKE', 'PLANNING', 'DONE'],
      stateTypes: { INTAKE: 'action', PLANNING: 'action', DONE: 'terminal' },
      currentState: 'PLANNING',
      transitionRecords: transitions,
    });

    expect(view.states).toHaveLength(3);
    expect(view.currentState).toBe('PLANNING');
    expect(view.visitedStates).toContain('INTAKE');
    expect(view.visitedStates).toContain('PLANNING');
    expect(view.transitions).toHaveLength(1);
    expect(view.transitions[0].from).toBe('INTAKE');
    expect(view.transitions[0].to).toBe('PLANNING');
    expect(view.transitions[0].traversed).toBe(true);

    const intake = view.states.find((s) => s.id === 'INTAKE');
    expect(intake).toBeDefined();
    expect(intake?.visited).toBe(true);
    expect(intake?.timeSpentMs).toBe(500);

    const done = view.states.find((s) => s.id === 'DONE');
    expect(done).toBeDefined();
    expect(done?.visited).toBe(false);
    expect(done?.current).toBe(false);
  });

  it('includes definition transitions with traversed: false', () => {
    const definitionTransitions = [
      { from: 'INTAKE', to: 'PLANNING', trigger: 'completion' },
      { from: 'PLANNING', to: 'IMPLEMENTATION', trigger: 'completion' },
      { from: 'IMPLEMENTATION', to: 'CODE_REVIEW', trigger: 'completion' },
      { from: 'CODE_REVIEW', to: 'VERIFICATION', trigger: 'review_approved' },
      { from: 'VERIFICATION', to: 'WRAP_UP', trigger: 'completion' },
      { from: 'WRAP_UP', to: 'DONE', trigger: 'completion' },
    ];

    const traversed: TransitionRecord[] = [
      {
        timestamp: '2025-01-15T10:00:00Z',
        runId: 'run-1',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        guardsEvaluated: [],
        durationMs: 500,
      },
      {
        timestamp: '2025-01-15T10:01:00Z',
        runId: 'run-1',
        from: 'PLANNING',
        to: 'IMPLEMENTATION',
        trigger: 'completion',
        guardsEvaluated: [],
        durationMs: 300,
      },
    ];

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: [
        'INTAKE',
        'PLANNING',
        'IMPLEMENTATION',
        'CODE_REVIEW',
        'VERIFICATION',
        'WRAP_UP',
        'DONE',
      ],
      stateTypes: {
        INTAKE: 'action',
        PLANNING: 'action',
        IMPLEMENTATION: 'action',
        CODE_REVIEW: 'review',
        VERIFICATION: 'action',
        WRAP_UP: 'action',
        DONE: 'terminal',
      },
      currentState: 'IMPLEMENTATION',
      transitionRecords: traversed,
      definitionTransitions,
    });

    expect(view.transitions).toHaveLength(6);

    const traversedEdges = view.transitions.filter((t) => t.traversed);
    const untraversedEdges = view.transitions.filter((t) => !t.traversed);

    expect(traversedEdges).toHaveLength(2);
    expect(untraversedEdges).toHaveLength(4);

    const intakeToPlanning = view.transitions.find(
      (t) => t.from === 'INTAKE' && t.to === 'PLANNING',
    );
    expect(intakeToPlanning?.traversed).toBe(true);
    expect(intakeToPlanning?.traversalCount).toBe(1);

    const codeReviewToVerification = view.transitions.find(
      (t) => t.from === 'CODE_REVIEW' && t.to === 'VERIFICATION',
    );
    expect(codeReviewToVerification?.traversed).toBe(false);
    expect(codeReviewToVerification?.traversalCount).toBe(0);
  });

  it('populates parallelInfo for states with dispatch_parallel_workers', () => {
    const parallelStates = new Map([
      ['CODE_REVIEW', ['static_reviewer', 'security_reviewer', 'performance_reviewer']],
    ]);

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['IMPLEMENTATION', 'CODE_REVIEW', 'DONE'],
      stateTypes: { IMPLEMENTATION: 'action', CODE_REVIEW: 'review', DONE: 'terminal' },
      currentState: 'CODE_REVIEW',
      transitionRecords: [],
      parallelStates,
    });

    const codeReview = view.states.find((s) => s.id === 'CODE_REVIEW');
    expect(codeReview?.parallelInfo).toBeDefined();
    expect(codeReview?.parallelInfo?.type).toBe('fork');
    expect(codeReview?.parallelInfo?.parallelRoles).toEqual([
      'static_reviewer',
      'security_reviewer',
      'performance_reviewer',
    ]);

    const impl = view.states.find((s) => s.id === 'IMPLEMENTATION');
    expect(impl?.parallelInfo).toBeUndefined();
  });

  it('populates roles from stateRoles mapping', () => {
    const stateRoles = new Map<string, readonly string[]>([
      ['IMPLEMENTATION', ['implementer']],
      ['CODE_REVIEW', ['static_reviewer', 'security_reviewer']],
    ]);

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['IMPLEMENTATION', 'CODE_REVIEW', 'DONE'],
      stateTypes: { IMPLEMENTATION: 'action', CODE_REVIEW: 'review', DONE: 'terminal' },
      currentState: 'IMPLEMENTATION',
      transitionRecords: [],
      stateRoles,
    });

    const impl = view.states.find((s) => s.id === 'IMPLEMENTATION');
    expect(impl?.roles).toEqual(['implementer']);

    const codeReview = view.states.find((s) => s.id === 'CODE_REVIEW');
    expect(codeReview?.roles).toEqual(['static_reviewer', 'security_reviewer']);

    const done = view.states.find((s) => s.id === 'DONE');
    expect(done?.roles).toBeUndefined();
  });

  it('populates scripts from stateScripts mapping and marks type as script', () => {
    const stateScripts = new Map<string, readonly string[]>([
      ['PUBLISH_FINDINGS', ['upload-findings-gist.ts']],
    ]);

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['PUBLISH_FINDINGS', 'DONE'],
      stateTypes: { PUBLISH_FINDINGS: 'action', DONE: 'terminal' },
      currentState: 'PUBLISH_FINDINGS',
      transitionRecords: [],
      stateScripts,
    });

    const publish = view.states.find((s) => s.id === 'PUBLISH_FINDINGS');
    expect(publish?.scripts).toEqual(['upload-findings-gist.ts']);
    expect(publish?.type).toBe('script');

    const done = view.states.find((s) => s.id === 'DONE');
    expect(done?.scripts).toBeUndefined();
    expect(done?.type).toBe('terminal');
  });

  it('omits roles when stateRoles is not provided', () => {
    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['IMPLEMENTATION', 'DONE'],
      stateTypes: { IMPLEMENTATION: 'action', DONE: 'terminal' },
      currentState: 'IMPLEMENTATION',
      transitionRecords: [],
    });

    const impl = view.states.find((s) => s.id === 'IMPLEMENTATION');
    expect(impl?.roles).toBeUndefined();
  });

  it('populates roleDurations from workerMetricsByRole for parallel states', () => {
    const parallelStates = new Map([
      ['CODE_REVIEW', ['static_reviewer', 'security_reviewer', 'performance_reviewer']],
    ]);
    const workerMetrics = {
      static_reviewer: { durationMs: 12000 },
      security_reviewer: { durationMs: 18000 },
      performance_reviewer: { durationMs: 8000 },
    };

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['IMPLEMENTATION', 'CODE_REVIEW', 'DONE'],
      stateTypes: { IMPLEMENTATION: 'action', CODE_REVIEW: 'review', DONE: 'terminal' },
      currentState: 'DONE',
      transitionRecords: [
        {
          timestamp: '2025-01-15T10:01:00Z',
          runId: 'run-1',
          from: 'IMPLEMENTATION',
          to: 'CODE_REVIEW',
          trigger: 'completion',
          guardsEvaluated: [],
          durationMs: 5000,
        },
        {
          timestamp: '2025-01-15T10:01:30Z',
          runId: 'run-1',
          from: 'CODE_REVIEW',
          to: 'DONE',
          trigger: 'review_approved',
          guardsEvaluated: [],
          durationMs: 18000,
        },
      ],
      parallelStates,
      workerMetricsByRole: workerMetrics,
    });

    const codeReview = view.states.find((s) => s.id === 'CODE_REVIEW');
    expect(codeReview?.parallelInfo?.roleDurations).toEqual({
      static_reviewer: 12000,
      security_reviewer: 18000,
      performance_reviewer: 8000,
    });
  });

  it('omits roleDurations when workerMetricsByRole is not provided', () => {
    const parallelStates = new Map([['CODE_REVIEW', ['static_reviewer', 'security_reviewer']]]);

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['CODE_REVIEW', 'DONE'],
      stateTypes: { CODE_REVIEW: 'review', DONE: 'terminal' },
      currentState: 'CODE_REVIEW',
      transitionRecords: [],
      parallelStates,
    });

    const codeReview = view.states.find((s) => s.id === 'CODE_REVIEW');
    expect(codeReview?.parallelInfo?.roleDurations).toBeUndefined();
  });

  it('omits roleDurations for roles with zero duration', () => {
    const parallelStates = new Map([['CODE_REVIEW', ['static_reviewer', 'security_reviewer']]]);
    const workerMetrics = {
      static_reviewer: { durationMs: 12000 },
      security_reviewer: { durationMs: 0 },
    };

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['CODE_REVIEW', 'DONE'],
      stateTypes: { CODE_REVIEW: 'review', DONE: 'terminal' },
      currentState: 'CODE_REVIEW',
      transitionRecords: [],
      parallelStates,
      workerMetricsByRole: workerMetrics,
    });

    const codeReview = view.states.find((s) => s.id === 'CODE_REVIEW');
    expect(codeReview?.parallelInfo?.roleDurations).toEqual({
      static_reviewer: 12000,
    });
  });

  it('falls back to traversed-only when no definition transitions provided', () => {
    const transitions: TransitionRecord[] = [
      {
        timestamp: '2025-01-15T10:00:00Z',
        runId: 'run-1',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        guardsEvaluated: [],
        durationMs: 500,
      },
    ];

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['INTAKE', 'PLANNING', 'DONE'],
      stateTypes: { INTAKE: 'action', PLANNING: 'action', DONE: 'terminal' },
      currentState: 'PLANNING',
      transitionRecords: transitions,
    });

    expect(view.transitions).toHaveLength(1);
    expect(view.transitions[0].traversed).toBe(true);
  });

  it('preserves distinct transitions with same from/to but different triggers', () => {
    const definitionTransitions = [
      { from: 'WAITING_FOR_HUMAN', to: 'REFINEMENT', trigger: 'human_input' },
      { from: 'WAITING_FOR_HUMAN', to: 'REFINEMENT', trigger: 'human_approved' },
      { from: 'WAITING_FOR_HUMAN', to: 'IMPLEMENTATION', trigger: 'human_input' },
    ];

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['WAITING_FOR_HUMAN', 'REFINEMENT', 'IMPLEMENTATION'],
      stateTypes: { WAITING_FOR_HUMAN: 'wait', REFINEMENT: 'action', IMPLEMENTATION: 'action' },
      currentState: 'WAITING_FOR_HUMAN',
      transitionRecords: [],
      definitionTransitions,
    });

    expect(view.transitions).toHaveLength(3);

    const toReqs = view.transitions.filter(
      (t) => t.from === 'WAITING_FOR_HUMAN' && t.to === 'REFINEMENT',
    );
    expect(toReqs).toHaveLength(2);
    expect(toReqs.map((t) => t.trigger).sort((a, b) => a.localeCompare(b))).toEqual([
      'human_approved',
      'human_input',
    ]);
  });
});

describe('projectArtifactView', () => {
  it('aggregates artifact summaries', () => {
    const artifacts: ArtifactSummary[] = [
      {
        ref: { type: 'plan', name: 'plan', version: 1, checksum: 'a' },
        type: 'plan',
        name: 'plan',
        version: 1,
        producedBy: 'planner',
        createdAt: '2025-01-15T10:00:00Z',
        sizeBytes: 100,
      },
      {
        ref: { type: 'implementation', name: 'impl', version: 1, checksum: 'b' },
        type: 'implementation',
        name: 'impl',
        version: 1,
        producedBy: 'coder',
        createdAt: '2025-01-15T10:01:00Z',
        sizeBytes: 200,
      },
    ];

    const view = projectArtifactView('run-1', artifacts);
    expect(view.totalCount).toBe(2);
    expect(view.totalSizeBytes).toBe(300);
    expect(view.byType['plan']).toBe(1);
    expect(view.byType['implementation']).toBe(1);
  });
});

describe('projectIterationView', () => {
  it('aggregates iteration summaries', () => {
    const iterations: ManifestIterationSummary[] = [
      {
        contractId: 'c1',
        totalIterations: 3,
        judgeArbitrations: 1,
        finalStatus: 'resolved',
        findingsTotal: 5,
        findingsResolved: 4,
      },
      {
        contractId: 'c2',
        totalIterations: 2,
        judgeArbitrations: 0,
        finalStatus: 'resolved',
        findingsTotal: 2,
        findingsResolved: 2,
      },
    ];

    const view = projectIterationView('run-1', iterations);
    expect(view.totalIterations).toBe(5);
    expect(view.totalFindings).toBe(7);
    expect(view.resolvedFindings).toBe(6);
    expect(view.contracts).toHaveLength(2);
  });

  it('uses contractLimits for maxIterations when provided', () => {
    const iterations: ManifestIterationSummary[] = [
      {
        contractId: 'plan_review_loop',
        totalIterations: 2,
        judgeArbitrations: 0,
        finalStatus: 'resolved',
        findingsTotal: 1,
        findingsResolved: 1,
      },
    ];

    const limits = { plan_review_loop: 5 };
    const view = projectIterationView('run-1', iterations, undefined, limits);
    expect(view.contracts[0].currentIteration).toBe(2);
    expect(view.contracts[0].maxIterations).toBe(5);
  });

  it('falls back to totalIterations when no contractLimits', () => {
    const iterations: ManifestIterationSummary[] = [
      {
        contractId: 'c1',
        totalIterations: 3,
        judgeArbitrations: 0,
        finalStatus: 'resolved',
        findingsTotal: 0,
        findingsResolved: 0,
      },
    ];

    const view = projectIterationView('run-1', iterations);
    expect(view.contracts[0].currentIteration).toBe(3);
    expect(view.contracts[0].maxIterations).toBe(3);
  });

  it('overrides in_progress status with terminal run status and respects contractLimits', () => {
    const iterations: ManifestIterationSummary[] = [
      {
        contractId: 'plan_review_loop',
        totalIterations: 2,
        judgeArbitrations: 0,
        finalStatus: 'in_progress',
        findingsTotal: 1,
        findingsResolved: 0,
      },
    ];

    const limits = { plan_review_loop: 5 };
    const view = projectIterationView('run-1', iterations, 'completed', limits);
    expect(view.contracts[0].status).toBe('completed');
    expect(view.contracts[0].maxIterations).toBe(5);
    expect(view.contracts[0].currentIteration).toBe(2);
  });

  it('preserves non-in_progress status when run is terminal', () => {
    const iterations: ManifestIterationSummary[] = [
      {
        contractId: 'c1',
        totalIterations: 5,
        judgeArbitrations: 0,
        finalStatus: 'failed',
        findingsTotal: 3,
        findingsResolved: 1,
      },
    ];

    const view = projectIterationView('run-1', iterations, 'completed');
    expect(view.contracts[0].status).toBe('failed');
  });

  it('handles empty iterations array', () => {
    const view = projectIterationView('run-1', []);
    expect(view.contracts).toHaveLength(0);
    expect(view.totalIterations).toBe(0);
    expect(view.totalFindings).toBe(0);
    expect(view.resolvedFindings).toBe(0);
  });
});

describe('projectIterationViewFromState', () => {
  it('projects live iteration state from persisted counts', () => {
    const view = projectIterationViewFromState(
      'run-live',
      { plan_review_loop: 2, implementation_review_loop: 1 },
      { implementation_review_loop: 1 },
      { plan_review_loop: 5, implementation_review_loop: 5 },
      [],
    );
    expect(view.contracts).toHaveLength(2);
    const planContract = view.contracts.find((c) => c.contractId === 'plan_review_loop');
    expect(planContract?.currentIteration).toBe(2);
    expect(planContract?.maxIterations).toBe(5);
    expect(planContract?.judgeArbitrations).toBe(0);

    const implContract = view.contracts.find((c) => c.contractId === 'implementation_review_loop');
    expect(implContract?.currentIteration).toBe(1);
    expect(implContract?.maxIterations).toBe(5);
    expect(implContract?.judgeArbitrations).toBe(1);
  });

  it('aggregates deduplicated findings into iteration contracts', () => {
    const findings = [
      {
        id: 'f1',
        severity: 'high',
        status: 'open',
        category: 'review',
        description: 'NPE',
        source: 'review',
        iteration: 0,
      },
      {
        id: 'f2',
        severity: 'medium',
        status: 'resolved',
        category: 'review',
        description: 'naming',
        source: 'review',
        iteration: 1,
      },
    ];

    const view = projectIterationViewFromState(
      'run-live',
      { implementation_review_loop: 1 },
      {},
      { implementation_review_loop: 5 },
      findings,
    );
    expect(view.totalFindings).toBe(2);
    expect(view.resolvedFindings).toBe(1);
  });

  it('returns empty contracts when no iteration counts exist', () => {
    const view = projectIterationViewFromState('run-empty', {}, {}, {}, []);
    expect(view.contracts).toHaveLength(0);
    expect(view.totalIterations).toBe(0);
    expect(view.totalFindings).toBe(0);
    expect(view.resolvedFindings).toBe(0);
  });

  it('deduplicates findings by id and uses latest status', () => {
    const findings = [
      {
        id: 'f1',
        severity: 'high',
        status: 'open',
        category: 'review',
        description: 'NPE',
        source: 'review',
        iteration: 0,
      },
      {
        id: 'f1',
        severity: 'high',
        status: 'resolved',
        category: 'review',
        description: 'NPE',
        source: 'review',
        iteration: 1,
      },
    ];

    const view = projectIterationViewFromState(
      'run-live',
      { implementation_review_loop: 2 },
      {},
      { implementation_review_loop: 5 },
      findings,
    );
    expect(view.totalFindings).toBe(1);
    expect(view.resolvedFindings).toBe(1);
  });

  it('counts accepted status as resolved', () => {
    const findings = [
      {
        id: 'f1',
        severity: 'high',
        status: 'accepted',
        category: 'review',
        description: 'NPE',
        source: 'review',
        iteration: 0,
      },
    ];

    const view = projectIterationViewFromState(
      'run-live',
      { implementation_review_loop: 1 },
      {},
      { implementation_review_loop: 5 },
      findings,
    );
    expect(view.totalFindings).toBe(1);
    expect(view.resolvedFindings).toBe(1);
  });

  it('falls back to currentIteration when no contractLimits entry exists', () => {
    const view = projectIterationViewFromState('run-live', { some_unknown_loop: 3 }, {}, {}, []);
    expect(view.contracts).toHaveLength(1);
    expect(view.contracts[0].currentIteration).toBe(3);
    expect(view.contracts[0].maxIterations).toBe(3);
  });

  it('sets all contract statuses to in_progress', () => {
    const view = projectIterationViewFromState(
      'run-live',
      { plan_review_loop: 4, implementation_review_loop: 2 },
      {},
      { plan_review_loop: 5, implementation_review_loop: 5 },
      [],
    );
    expect(view.contracts.every((c) => c.status === 'in_progress')).toBe(true);
  });
});

describe('projectFindingsView', () => {
  it('aggregates findings with counts', () => {
    const findings = [
      {
        id: 'f1',
        severity: 'high',
        status: 'open',
        category: 'bug',
        description: 'NPE',
        source: 'static-review',
        iteration: 1,
      },
      {
        id: 'f2',
        severity: 'low',
        status: 'resolved',
        category: 'style',
        description: 'naming',
        source: 'static-review',
        iteration: 1,
      },
      {
        id: 'f3',
        severity: 'high',
        status: 'open',
        category: 'security',
        description: 'injection',
        source: 'security-review',
        iteration: 2,
      },
    ];

    const view = projectFindingsView('run-1', findings);
    expect(view.totalCount).toBe(3);
    expect(view.bySeverity['high']).toBe(2);
    expect(view.bySeverity['low']).toBe(1);
    expect(view.byStatus['open']).toBe(2);
    expect(view.byStatus['resolved']).toBe(1);
  });
});

describe('projectUsageView', () => {
  it('projects token usage and role breakdown', () => {
    const tokenUsage: ManifestTokenUsage = {
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalTokens: 1500,
      byRole: { planner: { input: 600, output: 300 }, coder: { input: 400, output: 200 } },
    };
    const roles: RoleUsage[] = [
      {
        role: 'planner',
        dispatches: 2,
        inputTokens: 600,
        outputTokens: 300,
        totalDurationMs: 5000,
        artifactsProduced: 1,
      },
      {
        role: 'coder',
        dispatches: 1,
        inputTokens: 400,
        outputTokens: 200,
        totalDurationMs: 3000,
        artifactsProduced: 1,
      },
    ];

    const view = projectUsageView('run-1', tokenUsage, roles);
    expect(view.totalTokens).toBe(1500);
    expect(view.byRole).toHaveLength(2);
  });
});

function makeManifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    runId: 'run-1',
    version: '1.0.0',
    repository: '/repo',
    workflow: { name: 'default', version: '1.0.0' },
    timing: {
      startedAt: '2025-01-15T10:00:00Z',
      completedAt: '2025-01-15T10:10:00Z',
      totalDurationMs: 600_000,
      stateTimings: [],
    },
    status: 'completed',
    finalState: 'DONE',
    activeRoles: [],
    artifactInventory: [],
    totalArtifacts: 5,
    totalArtifactSizeBytes: 1000,
    iterations: [],
    governanceDecisions: 2,
    escalations: 0,
    humanInterventions: 1,
    agreements: [],
    tokenUsage: { totalInputTokens: 1000, totalOutputTokens: 500, totalTokens: 1500, byRole: {} },
    ...overrides,
  };
}

describe('projectRunSummary', () => {
  it('projects manifest to run summary', () => {
    const summary = projectRunSummary(makeManifest());
    expect(summary.runId).toBe('run-1');
    expect(summary.repository).toBe('/repo');
    expect(summary.workflow).toBe('default');
    expect(summary.status).toBe('completed');
    expect(summary.durationMs).toBe(600_000);
    expect(summary.totalArtifacts).toBe(5);
    expect(summary.totalTokens).toBe(1500);
  });
});

function makePersistedState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    runId: 'run-live' as PersistedState['runId'],
    schemaVersion: 1,
    currentState: 'IMPLEMENTATION',
    previousState: 'PLANNING',
    stateEnteredAt: '2025-01-15T10:03:00Z',
    transitionCount: 2,
    stateHistory: ['INTAKE', 'PLANNING', 'IMPLEMENTATION'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    persistedAt: '2025-01-15T10:03:00Z',
    persistenceVersion: 1,
    checksum: '',
    ...overrides,
  };
}

describe('projectUsageViewFromState', () => {
  it('projects token data from persisted state', () => {
    const state = makePersistedState({
      cumulativeInputTokens: 800,
      cumulativeOutputTokens: 400,
      workerMetricsByRole: {
        planner: {
          inputTokens: 300,
          outputTokens: 150,
          dispatches: 1,
          durationMs: 2000,
          artifactsProduced: 1,
        },
        coder: {
          inputTokens: 500,
          outputTokens: 250,
          dispatches: 2,
          durationMs: 4000,
          artifactsProduced: 0,
        },
      },
    });

    const view = projectUsageViewFromState('run-live', state);
    expect(view.runId).toBe('run-live');
    expect(view.totalInputTokens).toBe(800);
    expect(view.totalOutputTokens).toBe(400);
    expect(view.totalTokens).toBe(1200);
    expect(view.byRole).toHaveLength(2);
    expect(view.byRole.find((r) => r.role === 'planner')?.dispatches).toBe(1);
    expect(view.byRole.find((r) => r.role === 'coder')?.totalDurationMs).toBe(4000);
  });

  it('handles missing optional fields', () => {
    const state = makePersistedState();

    const view = projectUsageViewFromState('run-live', state);
    expect(view.totalInputTokens).toBe(0);
    expect(view.totalOutputTokens).toBe(0);
    expect(view.totalTokens).toBe(0);
    expect(view.byRole).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// projectWorkflowPreview
// ---------------------------------------------------------------------------

function makeWorkflowDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: 'test-workflow',
    version: '1.0.0',
    states: {
      INTAKE: {
        type: 'initial',
        description: 'Intake state',
        transitions: [
          {
            target: 'PLANNING',
            trigger: 'completion',
            guards: [],
            governanceRequired: false,
            priority: 0,
          },
        ],
      },
      PLANNING: {
        type: 'action',
        description: 'Planning state',
        transitions: [
          {
            target: 'DONE',
            trigger: 'completion',
            guards: [],
            governanceRequired: false,
            priority: 0,
          },
        ],
      },
      DONE: {
        type: 'terminal',
        description: 'Done state',
        transitions: [],
      },
    },
    initialState: 'INTAKE',
    terminalStates: ['DONE'],
    ...overrides,
  };
}

describe('projectWorkflowPreview', () => {
  it('builds states and transitions from a basic workflow definition', () => {
    const def = makeWorkflowDefinition();
    const view = projectWorkflowPreview(def);

    expect(view.runId).toBe('');
    expect(view.currentState).toBe('');
    expect(view.visitedStates).toEqual([]);
    expect(view.stateHistory).toEqual([]);
    expect(view.states).toHaveLength(3);
    expect(view.transitions).toHaveLength(2);

    const intake = view.states.find((s) => s.id === 'INTAKE');
    expect(intake?.type).toBe('initial');
    expect(intake?.visited).toBe(false);
    expect(intake?.current).toBe(false);
    expect(intake?.timeSpentMs).toBe(0);
    expect(intake?.visitCount).toBe(0);

    const done = view.states.find((s) => s.id === 'DONE');
    expect(done?.type).toBe('terminal');

    const t = view.transitions.find((e) => e.from === 'INTAKE' && e.to === 'PLANNING');
    expect(t?.trigger).toBe('completion');
    expect(t?.traversed).toBe(false);
    expect(t?.traversalCount).toBe(0);
  });

  it('sets parallelInfo for states with dispatch_parallel_workers entry action', () => {
    const def = makeWorkflowDefinition({
      states: {
        INTAKE: {
          type: 'initial',
          description: 'Intake',
          transitions: [
            {
              target: 'CODE_REVIEW',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 0,
            },
          ],
        },
        CODE_REVIEW: {
          type: 'action',
          description: 'Code review with parallel workers',
          entryActions: [
            {
              type: 'dispatch_parallel_workers',
              params: { roles: ['static_reviewer', 'security_reviewer'] },
            },
          ],
          transitions: [
            {
              target: 'DONE',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 0,
            },
          ],
        },
        DONE: {
          type: 'terminal',
          description: 'Done',
          transitions: [],
        },
      },
    });

    const view = projectWorkflowPreview(def);
    const codeReview = view.states.find((s) => s.id === 'CODE_REVIEW');
    expect(codeReview?.parallelInfo).toBeDefined();
    expect(codeReview?.parallelInfo?.type).toBe('fork');
    expect(codeReview?.parallelInfo?.parallelRoles).toEqual([
      'static_reviewer',
      'security_reviewer',
    ]);
    // roles should also contain both parallel roles
    expect(codeReview?.roles).toEqual(['static_reviewer', 'security_reviewer']);
  });

  it('sets parallelInfo with dynamicRole for states with dispatch_dynamic_workers entry action', () => {
    const def = makeWorkflowDefinition({
      states: {
        INTAKE: {
          type: 'initial',
          description: 'Intake',
          transitions: [
            {
              target: 'SPEC_AUTHORING',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 0,
            },
          ],
        },
        SPEC_AUTHORING: {
          type: 'action',
          description: 'Spec Authoring',
          label: 'Spec Authoring',
          entryActions: [
            {
              type: 'dispatch_dynamic_workers',
              params: { role: 'task_spec_writer', sourceArtifact: 'task_breakdown' },
            },
          ],
          transitions: [
            {
              target: 'DONE',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 0,
            },
          ],
        },
        DONE: {
          type: 'terminal',
          description: 'Done',
          transitions: [],
        },
      },
    });

    const view = projectWorkflowPreview(def);
    const specAuthoring = view.states.find((s) => s.id === 'SPEC_AUTHORING');
    expect(specAuthoring?.parallelInfo).toBeDefined();
    expect(specAuthoring?.parallelInfo?.type).toBe('fork');
    expect(specAuthoring?.parallelInfo?.dynamicRole).toBe('task_spec_writer');
    expect(specAuthoring?.parallelInfo?.parallelRoles).toBeUndefined();
    expect(specAuthoring?.roles).toEqual(['task_spec_writer']);
  });

  it('sets roles for states with dispatch_worker entry action', () => {
    const def = makeWorkflowDefinition({
      states: {
        INTAKE: {
          type: 'initial',
          description: 'Intake',
          transitions: [
            {
              target: 'IMPLEMENTATION',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 0,
            },
          ],
        },
        IMPLEMENTATION: {
          type: 'action',
          description: 'Implementation',
          entryActions: [{ type: 'dispatch_worker', params: { role: 'implementer' } }],
          transitions: [
            {
              target: 'DONE',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 0,
            },
          ],
        },
        DONE: {
          type: 'terminal',
          description: 'Done',
          transitions: [],
        },
      },
    });

    const view = projectWorkflowPreview(def);
    const impl = view.states.find((s) => s.id === 'IMPLEMENTATION');
    expect(impl?.roles).toEqual(['implementer']);
    // no parallelInfo since only single worker
    expect(impl?.parallelInfo).toBeUndefined();
  });

  it('uses label over id when state has a label', () => {
    const def = makeWorkflowDefinition({
      states: {
        INTAKE: {
          type: 'initial',
          label: 'Specification Intake',
          description: 'Intake',
          transitions: [
            {
              target: 'DONE',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 0,
            },
          ],
        },
        DONE: {
          type: 'terminal',
          description: 'Done',
          transitions: [],
        },
      },
    });

    const view = projectWorkflowPreview(def);
    const intake = view.states.find((s) => s.id === 'INTAKE');
    expect(intake?.label).toBe('Specification Intake');

    const done = view.states.find((s) => s.id === 'DONE');
    // no label defined, should fall back to id
    expect(done?.label).toBe('DONE');
  });

  it('handles states with both parallel and single worker actions', () => {
    const def = makeWorkflowDefinition({
      states: {
        MIXED: {
          type: 'action',
          description: 'Mixed actions',
          entryActions: [
            { type: 'dispatch_worker', params: { role: 'planner' } },
            {
              type: 'dispatch_parallel_workers',
              params: { roles: ['reviewer_a', 'reviewer_b'] },
            },
          ],
          transitions: [
            {
              target: 'DONE',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 0,
            },
          ],
        },
        DONE: {
          type: 'terminal',
          description: 'Done',
          transitions: [],
        },
      },
    });

    const view = projectWorkflowPreview(def);
    const mixed = view.states.find((s) => s.id === 'MIXED');
    // parallelInfo comes from dispatch_parallel_workers
    expect(mixed?.parallelInfo).toBeDefined();
    expect(mixed?.parallelInfo?.parallelRoles).toEqual(['reviewer_a', 'reviewer_b']);
    // roles should contain all roles from both actions
    expect(mixed?.roles).toEqual(['planner', 'reviewer_a', 'reviewer_b']);
  });
});

// ---------------------------------------------------------------------------
// projectArtifactDetail
// ---------------------------------------------------------------------------

function makeArtifactSummary(overrides: Partial<ArtifactSummary> = {}): ArtifactSummary {
  return {
    ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
    type: 'plan',
    name: 'plan',
    version: 1,
    producedBy: 'planner',
    createdAt: '2025-01-15T10:00:00Z',
    sizeBytes: 512,
    ...overrides,
  };
}

describe('projectArtifactDetail', () => {
  it('builds detail with version history and dependencies', () => {
    const plan = makeArtifactSummary();
    const canonSpec = makeArtifactSummary({
      ref: { type: 'canonical_specification', name: 'spec', version: 1, checksum: 'def' },
      type: 'canonical_specification',
      name: 'spec',
    });
    const versionHistory = [{ type: 'plan' as const, name: 'plan', version: 1, checksum: 'abc' }];

    const detail = projectArtifactDetail(plan, versionHistory, [plan, canonSpec]);
    expect(detail.type).toBe('plan');
    expect(detail.name).toBe('plan');
    expect(detail.currentVersion).toBe(1);
    expect(detail.producedBy).toBe('planner');
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0].version).toBe(1);
    expect(detail.versions[0].checksum).toBe('abc');
    // plan depends on canonical_specification
    expect(detail.dependsOn).toHaveLength(1);
    expect(detail.dependsOn[0].type).toBe('canonical_specification');
  });

  it('builds dependents for a plan artifact', () => {
    const plan = makeArtifactSummary();
    const impl = makeArtifactSummary({
      ref: { type: 'implementation', name: 'impl', version: 1, checksum: 'xyz' },
      type: 'implementation',
      name: 'impl',
    });
    const testPlan = makeArtifactSummary({
      ref: { type: 'test_plan', name: 'tests', version: 1, checksum: 'tp1' },
      type: 'test_plan',
      name: 'tests',
    });

    const detail = projectArtifactDetail(plan, [], [plan, impl, testPlan]);
    // plan has implementation, plan_review, and test_plan as dependents per ARTIFACT_DEPENDENTS
    // only those present in allArtifacts should appear
    expect(detail.dependedOnBy.map((r) => r.type)).toContain('implementation');
    expect(detail.dependedOnBy.map((r) => r.type)).toContain('test_plan');
  });

  it('returns empty arrays when artifact has no dependencies or dependents', () => {
    const artifact = makeArtifactSummary({
      ref: { type: 'unknown_type', name: 'unknown', version: 1, checksum: 'u1' },
      type: 'unknown_type',
      name: 'unknown',
    });

    const detail = projectArtifactDetail(artifact, [], [artifact]);
    expect(detail.dependsOn).toEqual([]);
    expect(detail.dependedOnBy).toEqual([]);
  });

  it('builds both dependsOn and dependedOnBy for an implementation artifact', () => {
    const plan = makeArtifactSummary();
    const impl = makeArtifactSummary({
      ref: { type: 'implementation', name: 'impl', version: 2, checksum: 'impl2' },
      type: 'implementation',
      name: 'impl',
      version: 2,
    });
    const staticReview = makeArtifactSummary({
      ref: { type: 'static_review', name: 'static', version: 1, checksum: 'sr1' },
      type: 'static_review',
      name: 'static',
    });

    const versionHistory = [
      { type: 'implementation' as const, name: 'impl', version: 1, checksum: 'impl1' },
      { type: 'implementation' as const, name: 'impl', version: 2, checksum: 'impl2' },
    ];

    const detail = projectArtifactDetail(impl, versionHistory, [plan, impl, staticReview]);
    // implementation depends on plan
    expect(detail.dependsOn).toHaveLength(1);
    expect(detail.dependsOn[0].type).toBe('plan');
    // implementation is depended on by static_review
    expect(detail.dependedOnBy.map((r) => r.type)).toContain('static_review');
    // version history should have two entries
    expect(detail.versions).toHaveLength(2);
    expect(detail.currentVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// deriveRunStatus — additional 'failed' case
// ---------------------------------------------------------------------------

describe('deriveRunStatus (via projectRunState)', () => {
  it('sets status to failed when in a terminal state with name including fail', () => {
    const failedState: EngineState = { ...engineState, currentState: 'FAILED' };
    const stateTypes = {
      DONE: 'terminal',
      ABORTED: 'terminal',
      FAILED: 'terminal',
      PLANNING: 'action',
    };
    const view = projectRunState(
      failedState,
      '2025-01-15T10:00:00Z',
      '2025-01-15T10:05:00Z',
      stateTypes,
    );
    expect(view.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// projectRunConfig — additional coverage
// ---------------------------------------------------------------------------

describe('projectRunConfig (additional)', () => {
  it('returns empty roles array when no assignments exist', () => {
    const view = projectRunConfig({});
    expect(view.roles).toEqual([]);
  });

  it('returns empty roles array when roles object has no assignments', () => {
    const view = projectRunConfig({ roles: {} });
    expect(view.roles).toEqual([]);
  });

  it('extracts quality gates from governance config', () => {
    const view = projectRunConfig({
      governance: {
        qualityGates: {
          specificationReadiness: { minCompletenessScore: 0.8 },
          implementationReview: { maxHighSeverityFindings: 2, maxMediumSeverityFindings: 5 },
        },
      },
    });
    expect(view.qualityGates.specificationReadiness.minCompletenessScore).toBe(0.8);
    expect(view.qualityGates.implementationReview.maxHighSeverityFindings).toBe(2);
    expect(view.qualityGates.implementationReview.maxMediumSeverityFindings).toBe(5);
  });

  it('extracts maxTokensPerRun from governance budget', () => {
    const view = projectRunConfig({
      governance: {
        budget: { maxTokensPerRun: 500_000 },
      },
    });
    expect(view.budget.maxTokensPerRun).toBe(500_000);
  });

  it('returns null maxTokensPerRun when budget is absent', () => {
    const view = projectRunConfig({});
    expect(view.budget.maxTokensPerRun).toBeNull();
  });

  it('extracts sources array when present', () => {
    const view = projectRunConfig({
      sources: ['src/index.ts', 'src/utils.ts'],
    });
    expect(view.sources).toEqual(['src/index.ts', 'src/utils.ts']);
  });

  it('returns undefined sources when not an array', () => {
    const view = projectRunConfig({ sources: 'not-an-array' });
    expect(view.sources).toBeUndefined();
  });

  it('extracts workflow name from config', () => {
    const view = projectRunConfig({
      workflow: { name: 'feature-workflow' },
    });
    expect(view.workflow).toBe('feature-workflow');
  });

  it('returns undefined workflow when not present', () => {
    const view = projectRunConfig({});
    expect(view.workflow).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// projectWorkflowView — additional timing and history branches
// ---------------------------------------------------------------------------

describe('projectWorkflowView (additional)', () => {
  it('uses stateTimestamps for timing instead of transition durationMs', () => {
    const transitions: TransitionRecord[] = [
      {
        timestamp: '2025-01-15T10:01:00Z',
        runId: 'run-1',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        guardsEvaluated: [],
        durationMs: 999, // this should be ignored when stateTimestamps cover this state
      },
    ];

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['INTAKE', 'PLANNING', 'DONE'],
      stateTypes: { INTAKE: 'action', PLANNING: 'action', DONE: 'terminal' },
      currentState: 'PLANNING',
      transitionRecords: transitions,
      stateTimestamps: [
        { stateId: 'INTAKE', enteredAt: '2025-01-15T10:00:00Z', exitedAt: '2025-01-15T10:00:30Z' },
      ],
    });

    const intake = view.states.find((s) => s.id === 'INTAKE');
    // Should use timestamp-based timing (30s = 30000ms), not durationMs (999)
    expect(intake?.timeSpentMs).toBe(30_000);
  });

  it('returns stateHistory as-is when provided', () => {
    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['INTAKE', 'PLANNING', 'IMPLEMENTATION', 'DONE'],
      stateTypes: {
        INTAKE: 'action',
        PLANNING: 'action',
        IMPLEMENTATION: 'action',
        DONE: 'terminal',
      },
      currentState: 'IMPLEMENTATION',
      transitionRecords: [],
      stateHistory: ['INTAKE', 'PLANNING', 'INTAKE', 'PLANNING', 'IMPLEMENTATION'],
    });

    // stateHistory should be returned as-is (preserving duplicates and order)
    expect(view.stateHistory).toEqual([
      'INTAKE',
      'PLANNING',
      'INTAKE',
      'PLANNING',
      'IMPLEMENTATION',
    ]);
  });

  it('falls back to visitedSet for stateHistory when not provided', () => {
    const transitions: TransitionRecord[] = [
      {
        timestamp: '2025-01-15T10:00:00Z',
        runId: 'run-1',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        guardsEvaluated: [],
        durationMs: 500,
      },
    ];

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['INTAKE', 'PLANNING', 'DONE'],
      stateTypes: { INTAKE: 'action', PLANNING: 'action', DONE: 'terminal' },
      currentState: 'PLANNING',
      transitionRecords: transitions,
    });

    // stateHistory should be derived from visitedSet
    expect(view.stateHistory).toContain('INTAKE');
    expect(view.stateHistory).toContain('PLANNING');
    expect(view.stateHistory).not.toContain('DONE');
  });

  it('includes abortReason in output when provided', () => {
    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['INTAKE', 'ABORTED'],
      stateTypes: { INTAKE: 'action', ABORTED: 'terminal' },
      currentState: 'ABORTED',
      transitionRecords: [],
      abortReason: 'Budget exhausted',
    });

    expect(view.abortReason).toBe('Budget exhausted');
  });

  it('omits abortReason from output when not provided', () => {
    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['INTAKE', 'DONE'],
      stateTypes: { INTAKE: 'action', DONE: 'terminal' },
      currentState: 'DONE',
      transitionRecords: [],
    });

    expect(view.abortReason).toBeUndefined();
  });

  it('marks only the last transition to a terminal state as traversed (superseding logic)', () => {
    const transitions: TransitionRecord[] = [
      {
        timestamp: '2025-01-15T10:00:00Z',
        runId: 'run-1',
        from: 'IMPLEMENTATION',
        to: 'ABORTED',
        trigger: 'abort',
        guardsEvaluated: [],
        durationMs: 100,
      },
      {
        timestamp: '2025-01-15T10:01:00Z',
        runId: 'run-1',
        from: 'ABORTED',
        to: 'IMPLEMENTATION',
        trigger: 'resume',
        guardsEvaluated: [],
        durationMs: 200,
      },
      {
        timestamp: '2025-01-15T10:02:00Z',
        runId: 'run-1',
        from: 'CODE_REVIEW',
        to: 'ABORTED',
        trigger: 'abort',
        guardsEvaluated: [],
        durationMs: 300,
      },
    ];

    const definitionTransitions = [
      { from: 'IMPLEMENTATION', to: 'ABORTED', trigger: 'abort' },
      { from: 'CODE_REVIEW', to: 'ABORTED', trigger: 'abort' },
      { from: 'ABORTED', to: 'IMPLEMENTATION', trigger: 'resume' },
    ];

    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['IMPLEMENTATION', 'CODE_REVIEW', 'ABORTED'],
      stateTypes: { IMPLEMENTATION: 'action', CODE_REVIEW: 'review', ABORTED: 'terminal' },
      currentState: 'ABORTED',
      transitionRecords: transitions,
      definitionTransitions,
    });

    // The first transition IMPLEMENTATION->ABORTED should be superseded
    // because the last source to ABORTED is CODE_REVIEW
    const implToAborted = view.transitions.find(
      (t) => t.from === 'IMPLEMENTATION' && t.to === 'ABORTED',
    );
    expect(implToAborted?.traversed).toBe(false);

    // The last transition CODE_REVIEW->ABORTED should be marked traversed
    const crToAborted = view.transitions.find(
      (t) => t.from === 'CODE_REVIEW' && t.to === 'ABORTED',
    );
    expect(crToAborted?.traversed).toBe(true);

    // Non-terminal transition should still be traversed
    const abortedToImpl = view.transitions.find(
      (t) => t.from === 'ABORTED' && t.to === 'IMPLEMENTATION',
    );
    expect(abortedToImpl?.traversed).toBe(true);
  });

  it('sets parallelInfo with dynamicRole when dynamicParallelStates is provided', () => {
    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['INTAKE', 'SPEC_AUTHORING', 'DONE'],
      stateTypes: { INTAKE: 'initial', SPEC_AUTHORING: 'action', DONE: 'terminal' },
      currentState: 'SPEC_AUTHORING',
      transitionRecords: [],
      dynamicParallelStates: new Map([['SPEC_AUTHORING', 'task_spec_writer']]),
    });

    const specAuthoring = view.states.find((s) => s.id === 'SPEC_AUTHORING');
    expect(specAuthoring?.parallelInfo).toBeDefined();
    expect(specAuthoring?.parallelInfo?.type).toBe('fork');
    expect(specAuthoring?.parallelInfo?.dynamicRole).toBe('task_spec_writer');
    expect(specAuthoring?.parallelInfo?.parallelRoles).toBeUndefined();
  });

  it('populates dynamicWorkerCount from workerMetricsByRole dispatches', () => {
    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['INTAKE', 'SPEC_AUTHORING', 'DONE'],
      stateTypes: { INTAKE: 'initial', SPEC_AUTHORING: 'action', DONE: 'terminal' },
      currentState: 'SPEC_AUTHORING',
      transitionRecords: [],
      dynamicParallelStates: new Map([['SPEC_AUTHORING', 'task_spec_writer']]),
      workerMetricsByRole: { task_spec_writer: { durationMs: 5000, dispatches: 7 } },
    });

    const specAuthoring = view.states.find((s) => s.id === 'SPEC_AUTHORING');
    expect(specAuthoring?.parallelInfo?.dynamicWorkerCount).toBe(7);
  });

  it('omits dynamicWorkerCount when dispatches is 0 or missing', () => {
    const view = projectWorkflowView({
      runId: 'run-1',
      stateNames: ['INTAKE', 'SPEC_AUTHORING', 'DONE'],
      stateTypes: { INTAKE: 'initial', SPEC_AUTHORING: 'action', DONE: 'terminal' },
      currentState: 'SPEC_AUTHORING',
      transitionRecords: [],
      dynamicParallelStates: new Map([['SPEC_AUTHORING', 'task_spec_writer']]),
      workerMetricsByRole: { task_spec_writer: { durationMs: 5000 } },
    });

    const specAuthoring = view.states.find((s) => s.id === 'SPEC_AUTHORING');
    expect(specAuthoring?.parallelInfo?.dynamicRole).toBe('task_spec_writer');
    expect(specAuthoring?.parallelInfo?.dynamicWorkerCount).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deduplicateFindings
// ---------------------------------------------------------------------------

describe('deduplicateFindings', () => {
  it('returns zero counts for empty findings array', () => {
    const result = deduplicateFindings([]);
    expect(result.unique.size).toBe(0);
    expect(result.total).toBe(0);
    expect(result.resolved).toBe(0);
  });

  it('deduplicates findings by id with later entry winning', () => {
    const findings: FindingData[] = [
      {
        id: 'f1',
        severity: 'high',
        status: 'open',
        category: 'bug',
        description: 'NPE',
        source: 'review',
        iteration: 0,
      },
      {
        id: 'f1',
        severity: 'high',
        status: 'resolved',
        category: 'bug',
        description: 'NPE fixed',
        source: 'review',
        iteration: 1,
      },
      {
        id: 'f2',
        severity: 'medium',
        status: 'open',
        category: 'style',
        description: 'naming',
        source: 'review',
        iteration: 0,
      },
    ];

    const result = deduplicateFindings(findings);
    expect(result.unique.size).toBe(2);
    expect(result.total).toBe(2);
    // f1 was overwritten to resolved, f2 is still open
    expect(result.resolved).toBe(1);
    // The last entry for f1 should win
    expect(result.unique.get('f1')?.status).toBe('resolved');
    expect(result.unique.get('f1')?.description).toBe('NPE fixed');
  });

  it('counts resolved and accepted statuses correctly', () => {
    const findings: FindingData[] = [
      {
        id: 'f1',
        severity: 'high',
        status: 'resolved',
        category: 'bug',
        description: 'fixed',
        source: 'review',
        iteration: 1,
      },
      {
        id: 'f2',
        severity: 'medium',
        status: 'accepted',
        category: 'style',
        description: 'acceptable',
        source: 'review',
        iteration: 1,
      },
      {
        id: 'f3',
        severity: 'low',
        status: 'open',
        category: 'perf',
        description: 'slow',
        source: 'review',
        iteration: 1,
      },
    ];

    const result = deduplicateFindings(findings);
    expect(result.total).toBe(3);
    // resolved + accepted = 2
    expect(result.resolved).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// projectIterationView — 'aborted' and 'interrupted' terminal status overrides
// ---------------------------------------------------------------------------

describe('projectIterationView (terminal status overrides)', () => {
  it('overrides in_progress status with aborted when run is aborted', () => {
    const iterations: ManifestIterationSummary[] = [
      {
        contractId: 'c1',
        totalIterations: 2,
        judgeArbitrations: 0,
        finalStatus: 'in_progress',
        findingsTotal: 3,
        findingsResolved: 1,
      },
    ];

    const view = projectIterationView('run-1', iterations, 'aborted');
    expect(view.contracts[0].status).toBe('aborted');
  });

  it('overrides in_progress status with interrupted when run is interrupted', () => {
    const iterations: ManifestIterationSummary[] = [
      {
        contractId: 'c1',
        totalIterations: 1,
        judgeArbitrations: 0,
        finalStatus: 'in_progress',
        findingsTotal: 2,
        findingsResolved: 0,
      },
    ];

    const view = projectIterationView('run-1', iterations, 'interrupted');
    expect(view.contracts[0].status).toBe('interrupted');
  });

  it('does not override non-in_progress status even when run is aborted', () => {
    const iterations: ManifestIterationSummary[] = [
      {
        contractId: 'c1',
        totalIterations: 3,
        judgeArbitrations: 1,
        finalStatus: 'resolved',
        findingsTotal: 5,
        findingsResolved: 5,
      },
    ];

    const view = projectIterationView('run-1', iterations, 'aborted');
    expect(view.contracts[0].status).toBe('resolved');
  });
});
