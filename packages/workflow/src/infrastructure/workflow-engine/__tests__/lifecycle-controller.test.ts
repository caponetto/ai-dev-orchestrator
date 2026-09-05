import type {
  AgentStreamBus,
  AgentStreamEvent,
  ArtifactStore,
  GovernanceEngine,
  IterationContractRegistry,
  JournalWriter,
  ManifestProducer,
  ProjectContextStore,
  RunnerSystem,
  StatePersistence,
} from '@ai-dev-orchestrator/ports';
import { ShutdownCoordinator } from '@ai-dev-orchestrator/recovery';
import type {
  GovernanceOutcome,
  RunManifest,
  WorkflowRunConfig,
} from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { TEST_WORKFLOW } from '../../../../test/fixtures/test-defaults';
import { LifecycleController } from '../lifecycle-controller';

function makeStreamBus(): AgentStreamBus & { events: AgentStreamEvent[] } {
  const events: AgentStreamEvent[] = [];
  return {
    events,
    publish: (event: AgentStreamEvent) => events.push(event),
    subscribe: () => '',
    unsubscribe: () => {},
    getClientCount: () => 0,
  };
}

function makeRunner(): RunnerSystem {
  return {
    dispatch: vi.fn().mockResolvedValue({
      workerId: 'w1',
      role: 'planner',
      status: 'success',
      outputArtifacts: [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
      metrics: {
        startedAt: '',
        completedAt: '',
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        retryCount: 0,
        modelUsed: '',
      },
    }),
    dispatchParallel: vi.fn().mockResolvedValue([]),
    getWorkerStatus: vi.fn().mockReturnValue(null),
    cancelWorker: vi.fn(),
    cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
    setWorkerCounter: vi.fn(),
  };
}

function makeReviewRunner(): RunnerSystem {
  return {
    dispatch: vi.fn().mockResolvedValue({
      workerId: 'w1',
      role: 'plan_reviewer',
      status: 'success',
      outputArtifacts: [{ type: 'plan_review', name: 'plan_review', version: 1, checksum: 'abc' }],
      metrics: {
        startedAt: '',
        completedAt: '',
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        retryCount: 0,
        modelUsed: '',
      },
    }),
    dispatchParallel: vi.fn().mockResolvedValue([]),
    getWorkerStatus: vi.fn().mockReturnValue(null),
    cancelWorker: vi.fn(),
    cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
    setWorkerCounter: vi.fn(),
  };
}

function makeReviewStore(): ArtifactStore {
  return {
    store: vi.fn().mockResolvedValue({
      type: 'plan_review',
      name: 'plan_review',
      version: 1,
      checksum: 'abc',
    }),
    get: vi.fn().mockResolvedValue(null),
    getLatest: vi.fn().mockResolvedValue({
      type: 'plan_review',
      name: 'plan_review',
      version: 1,
      checksum: 'abc',
      content: '---\napproved: true\nfindings: []\n---\nLooks good.',
    }),
    list: vi.fn().mockResolvedValue([]),
    history: vi.fn().mockResolvedValue([]),
    verify: vi.fn().mockResolvedValue({ valid: true }),
    inventory: vi.fn().mockResolvedValue({ artifacts: [], totalSize: 0 }),
  };
}

function makeStore(): ArtifactStore {
  return {
    store: vi.fn().mockResolvedValue({ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }),
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

function makeGovernance(): GovernanceEngine {
  return {
    evaluateTransition: vi.fn().mockReturnValue({ allowed: true, reason: 'pass' }),
    checkAgreement: vi.fn().mockReturnValue({ exists: false, valid: false }),
    recordDecision: vi.fn(),
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

function makeJournal(): JournalWriter {
  return {
    append: vi.fn(),
    appendBatch: vi.fn(),
  };
}

function makePersistence(): StatePersistence {
  return {
    save: vi.fn(),
    load: vi.fn().mockReturnValue(null),
    exists: vi.fn().mockReturnValue(false),
    validate: vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
    probeLock: vi.fn().mockReturnValue({
      exists: false,
      pid: 0,
      pidRunning: false,
      hostname: '',
      unreadable: false,
    }),
    acquireLock: vi
      .fn()
      .mockReturnValue({ runId: 'run-001', pid: process.pid, acquiredAt: '', lockPath: '' }),
    releaseLock: vi.fn(),
    reconstructFromJournal: vi.fn().mockReturnValue(null),
  };
}

function makeManifest(): ManifestProducer {
  return {
    produce: vi.fn().mockReturnValue({
      runId: 'run-001',
      version: '1.0.0',
      repository: '',
      workflow: { name: 'default', version: '1.0.0' },
      timing: { startedAt: '', completedAt: '', totalDurationMs: 0, stateTimings: [] },
      status: 'completed',
      finalState: 'DONE',
      activeRoles: [],
      artifactInventory: [],
      totalArtifacts: 0,
      totalArtifactSizeBytes: 0,
      iterations: [],
      governanceDecisions: 0,
      escalations: 0,
      humanInterventions: 0,
      agreements: [],
      tokenUsage: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, byRole: {} },
    } satisfies RunManifest),
  };
}

function makeConfig(overrides: Partial<WorkflowRunConfig> = {}): WorkflowRunConfig {
  return {
    runId: 'run-001',
    workflowDefinition: TEST_WORKFLOW,
    governancePolicy: {},
    roleAssignments: {},
    sources: [],
    ...overrides,
  };
}

function makeReviewWorkflow() {
  return {
    name: 'review-test',
    version: '1.0.0',
    initialState: 'REVIEW',
    terminalStates: ['DONE', 'REJECTED', 'FAILED'],
    states: {
      REVIEW: {
        type: 'review' as const,
        description: 'Review state',
        entryActions: [{ type: 'dispatch_worker' as const, params: { role: 'reviewer' } }],
        transitions: [
          {
            target: 'DONE',
            trigger: 'review_approved' as const,
            guards: [],
            governanceRequired: false,
            priority: 1,
          },
          {
            target: 'REJECTED',
            trigger: 'review_rejected' as const,
            guards: [],
            governanceRequired: false,
            priority: 2,
          },
          {
            target: 'FAILED',
            trigger: 'failure' as const,
            guards: [],
            governanceRequired: false,
            priority: 3,
          },
        ],
      },
      DONE: {
        type: 'terminal' as const,
        description: 'Done',
        entryActions: [],
        transitions: [],
      },
      REJECTED: {
        type: 'terminal' as const,
        description: 'Rejected',
        entryActions: [],
        transitions: [],
      },
      FAILED: {
        type: 'terminal' as const,
        description: 'Failed',
        entryActions: [],
        transitions: [],
      },
    } as WorkflowRunConfig['workflowDefinition']['states'],
  };
}

describe('LifecycleController', () => {
  it('returns initial engine state', () => {
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });
    const state = controller.getState();
    expect(state.runId).toBe('');
    expect(state.currentState).toBe('');
  });

  it('transitions through states on start', async () => {
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });
    const result = await controller.start(makeConfig({ globalTransitionLimit: 50 }));
    expect(result.runId).toBe('run-001');
    expect(result.manifest).toBeDefined();
  });

  it('stops at wait states', async () => {
    const store = makeStore();
    store.getLatest = vi.fn().mockImplementation((type: string) => {
      return Promise.resolve({ type, name: type, version: 1, checksum: 'abc', content: '' });
    }) as ArtifactStore['getLatest'];

    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: store,
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });
    const result = await controller.start(makeConfig({ globalTransitionLimit: 50 }));
    const state = controller.getState();
    expect(state.isWaitingForHuman).toBe(true);
    expect(result.finalState).toBe('WAITING_FOR_HUMAN');
  });

  it('persists waitingContext when entering a wait state', async () => {
    const store = makeStore();
    store.getLatest = vi.fn().mockImplementation((type: string) => {
      return Promise.resolve({ type, name: type, version: 1, checksum: 'abc', content: '' });
    }) as ArtifactStore['getLatest'];

    const persistence = makePersistence();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: store,
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: persistence,
      manifestProducer: makeManifest(),
    });
    await controller.start(makeConfig({ globalTransitionLimit: 50 }));

    const state = controller.getState();
    expect(state.waitingContext).toBeDefined();
    expect(state.waitingContext?.reason).toBe('input_needed');
    expect(state.waitingContext?.requiredInput).toBe('approval');

    const saveCall = (persistence.save as ReturnType<typeof vi.fn>).mock.calls;
    const lastSaved = saveCall[saveCall.length - 1][0] as { waitingContext?: unknown };
    expect(lastSaved.waitingContext).toBeDefined();
    expect(lastSaved.waitingContext).toEqual(
      expect.objectContaining({ reason: 'input_needed', requiredInput: 'approval' }),
    );
  });

  it('populates presentedArtifacts from inventory when entering a wait state', async () => {
    const store = makeStore();
    store.getLatest = vi.fn().mockImplementation((type: string) => {
      return Promise.resolve({ type, name: type, version: 1, checksum: 'abc', content: '' });
    }) as ArtifactStore['getLatest'];

    const specRef = {
      type: 'canonical_specification',
      name: 'canonical_specification',
      version: 2,
      checksum: 'def',
    };
    const planRef = { type: 'plan', name: 'plan', version: 1, checksum: 'abc' };
    store.inventory = vi.fn().mockResolvedValue({
      artifacts: [
        {
          ref: specRef,
          type: specRef.type,
          name: specRef.name,
          version: specRef.version,
          producedBy: 'analyst',
          createdAt: '',
          sizeBytes: 100,
        },
        {
          ref: planRef,
          type: planRef.type,
          name: planRef.name,
          version: planRef.version,
          producedBy: 'planner',
          createdAt: '',
          sizeBytes: 200,
        },
      ],
      totalSize: 300,
    });

    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: store,
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });
    await controller.start(makeConfig({ globalTransitionLimit: 50 }));

    const state = controller.getState();
    expect(state.currentState).toBe('WAITING_FOR_HUMAN');
    expect(state.waitingContext?.presentedArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'canonical_specification', version: 2 }),
        expect.objectContaining({ type: 'plan', version: 1 }),
      ]),
    );
  });

  it('aborts the run', async () => {
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });
    await controller.start(makeConfig({ globalTransitionLimit: 50 }));
    await controller.abort('user requested');
    const state = controller.getState();
    expect(state.currentState).toBe('ABORTED');
  });

  it('stays ABORTED when abort fires during action dispatch', async () => {
    let resolveDispatch!: (v: unknown) => void;
    const slowRunner: RunnerSystem = {
      dispatch: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDispatch = resolve;
          }),
      ),
      dispatchParallel: vi.fn().mockResolvedValue([]),
      getWorkerStatus: vi.fn().mockReturnValue(null),
      cancelWorker: vi.fn(),
      cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
      setWorkerCounter: vi.fn(),
    };

    const controller = new LifecycleController({
      runner: slowRunner,
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    const startPromise = controller.start(makeConfig({ globalTransitionLimit: 50 }));

    await controller.abort('user cancelled');
    expect(controller.getState().currentState).toBe('ABORTED');

    resolveDispatch({
      workerId: 'w1',
      role: 'planner',
      status: 'failure',
      outputArtifacts: [],
      metrics: {
        startedAt: '',
        completedAt: '',
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        retryCount: 0,
        modelUsed: '',
      },
    });

    const result = await startPromise;
    expect(result.finalState).toBe('ABORTED');
    expect(controller.getState().currentState).toBe('ABORTED');
  });

  it('throws on transition limit exceeded', async () => {
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });
    await expect(controller.start(makeConfig({ globalTransitionLimit: 2 }))).rejects.toThrow(
      'Maximum transitions exceeded',
    );
  });

  it('pauses and records journal event', async () => {
    const journal = makeJournal();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });
    await controller.start(makeConfig({ globalTransitionLimit: 50 }));
    await controller.pause({
      reason: 'needs input',
      requiredInput: 'text',
      requestingState: 'WAITING_FOR_HUMAN',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: new Date().toISOString(),
    });
    const state = controller.getState();
    expect(state.isWaitingForHuman).toBe(true);
  });

  it('pause emits state_transition journal event to WAITING_FOR_HUMAN', async () => {
    const journal = makeJournal();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });
    await controller.start(makeConfig({ globalTransitionLimit: 50 }));

    (journal.append as ReturnType<typeof vi.fn>).mockClear();

    await controller.pause({
      reason: 'needs input',
      requiredInput: 'text',
      requestingState: 'SOME_STATE',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: new Date().toISOString(),
    });

    const appendCalls = (journal.append as ReturnType<typeof vi.fn>).mock.calls;
    const transitionEvent = appendCalls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === 'state_transition',
    );
    expect(transitionEvent).toBeDefined();
    const data = (transitionEvent?.at(0) as { data: { to: string } } | undefined)?.data;
    expect(data?.to).toBe('WAITING_FOR_HUMAN');
  });

  it('governance escalation emits state_transition journal event to WAITING_FOR_HUMAN with governance metadata', async () => {
    const governance = makeGovernance();
    (governance.evaluateTransition as ReturnType<typeof vi.fn>).mockReturnValue({
      escalate: true,
      reason: 'governance_escalation',
    });

    const journal = makeJournal();
    const contractRegistry = makeContractRegistry();
    (contractRegistry.getContractForState as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'review-contract',
    });

    const reviewWorkflow = makeReviewWorkflow();
    const originalTransition = reviewWorkflow.states.REVIEW.transitions[0];
    (reviewWorkflow.states as Record<string, unknown>).REVIEW = {
      ...reviewWorkflow.states.REVIEW,
      transitions: [
        { ...originalTransition, governanceRequired: true },
        ...reviewWorkflow.states.REVIEW.transitions.slice(1),
      ],
    };

    const controller = new LifecycleController({
      runner: makeReviewRunner(),
      artifactStore: makeReviewStore(),
      governanceEngine: governance,
      contractRegistry,
      journalWriter: journal,
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    await controller.start(
      makeConfig({ workflowDefinition: reviewWorkflow, globalTransitionLimit: 10 }),
    );

    const appendCalls = (journal.append as ReturnType<typeof vi.fn>).mock.calls;
    const transitionEvent = appendCalls.find(
      (c: unknown[]) =>
        (c[0] as { type: string; data: { to?: string } }).type === 'state_transition' &&
        (c[0] as { data: { to: string } }).data.to === 'WAITING_FOR_HUMAN',
    );
    expect(transitionEvent).toBeDefined();
    const data = (
      transitionEvent?.at(0) as
        | {
            data: {
              from: string;
              trigger: string;
              governanceRequired: boolean;
              governanceOutcome: GovernanceOutcome;
              contractId: string;
            };
          }
        | undefined
    )?.data;
    expect(data?.from).toBe('REVIEW');
    expect(data?.trigger).toBe('escalation');
    expect(data?.governanceRequired).toBe(true);
    expect(data?.governanceOutcome).toBe('escalated');
    expect(data?.contractId).toBe('review-contract');
  });

  it('wait-state emits human_input_requested journal event', async () => {
    const store = makeStore();
    store.getLatest = vi.fn().mockImplementation((type: string) => {
      return Promise.resolve({ type, name: type, version: 1, checksum: 'abc', content: '' });
    }) as ArtifactStore['getLatest'];

    const journal = makeJournal();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: store,
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });
    await controller.start(makeConfig({ globalTransitionLimit: 50 }));

    const appendCalls = (journal.append as ReturnType<typeof vi.fn>).mock.calls;
    const humanEvent = appendCalls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === 'human_input_requested',
    );
    expect(humanEvent).toBeDefined();
    const data = (humanEvent?.at(0) as { data: { action: string; reason: string } } | undefined)
      ?.data;
    expect(data?.action).toBe('input_requested');
    expect(data?.reason).toBe('input_needed');
  });

  it('escalation emits human_input_requested journal event with governance_escalation reason', async () => {
    const governance = makeGovernance();
    (governance.evaluateTransition as ReturnType<typeof vi.fn>).mockReturnValue({
      escalate: true,
      reason: 'governance_escalation',
    });

    const journal = makeJournal();
    const reviewWorkflow = makeReviewWorkflow();
    const originalTransition = reviewWorkflow.states.REVIEW.transitions[0];
    (reviewWorkflow.states as Record<string, unknown>).REVIEW = {
      ...reviewWorkflow.states.REVIEW,
      transitions: [
        { ...originalTransition, governanceRequired: true },
        ...reviewWorkflow.states.REVIEW.transitions.slice(1),
      ],
    };

    const controller = new LifecycleController({
      runner: makeReviewRunner(),
      artifactStore: makeReviewStore(),
      governanceEngine: governance,
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    await controller.start(
      makeConfig({ workflowDefinition: reviewWorkflow, globalTransitionLimit: 10 }),
    );

    const appendCalls = (journal.append as ReturnType<typeof vi.fn>).mock.calls;
    const humanEvent = appendCalls.find(
      (c: unknown[]) =>
        (c[0] as { type: string }).type === 'human_input_requested' &&
        (c[0] as { data: { reason?: string } }).data.reason === 'governance_escalation',
    );
    expect(humanEvent).toBeDefined();
    const data = (humanEvent?.at(0) as { data: { reason: string; stateId: string } } | undefined)
      ?.data;
    expect(data?.reason).toBe('governance_escalation');
    expect(data?.stateId).toBe('WAITING_FOR_HUMAN');
  });

  it('stops the run loop when shutdown is requested', async () => {
    const sp = makePersistence();
    const jw = makeJournal();
    const shutdownCoordinator = new ShutdownCoordinator(sp, jw, 5000);

    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: sp,
      manifestProducer: makeManifest(),
      shutdownCoordinator,
    });

    shutdownCoordinator.requestShutdown('signal');

    const result = await controller.start(makeConfig({ globalTransitionLimit: 50 }));
    expect(result.finalState).toBeDefined();
  });

  it('enforces workflow timeout', async () => {
    let callCount = 0;
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockImplementation(() => {
      callCount += 1;
      return callCount <= 1 ? 1000 : 1000 + 100;
    });

    try {
      const controller = new LifecycleController({
        runner: makeRunner(),
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        workflowTimeoutMs: 50,
      });

      await expect(controller.start(makeConfig({ globalTransitionLimit: 50 }))).rejects.toThrow(
        'timed out after 50ms',
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('returns failure trigger when review action has process failure', async () => {
    const runner = makeRunner();
    (runner.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      workerId: 'w1',
      role: 'reviewer',
      status: 'failure',
      outputArtifacts: [],
      metrics: {
        startedAt: '',
        completedAt: '',
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        retryCount: 0,
        modelUsed: '',
      },
    });

    const controller = new LifecycleController({
      runner,
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    const result = await controller.start(
      makeConfig({ workflowDefinition: makeReviewWorkflow(), globalTransitionLimit: 10 }),
    );
    expect(result.finalState).toBe('FAILED');
  });

  it('returns review_approved trigger when review action succeeds', async () => {
    const controller = new LifecycleController({
      runner: makeReviewRunner(),
      artifactStore: makeReviewStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    const result = await controller.start(
      makeConfig({ workflowDefinition: makeReviewWorkflow(), globalTransitionLimit: 10 }),
    );
    expect(result.finalState).toBe('DONE');
  });

  it('wait-state requestingState preserves originating state, not the wait state', async () => {
    const store = makeStore();
    store.getLatest = vi.fn().mockImplementation((type: string) => {
      return Promise.resolve({ type, name: type, version: 1, checksum: 'abc', content: '' });
    }) as ArtifactStore['getLatest'];

    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: store,
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });
    await controller.start(makeConfig({ globalTransitionLimit: 50 }));

    const state = controller.getState();
    expect(state.currentState).toBe('WAITING_FOR_HUMAN');
    expect(state.waitingContext?.requestingState).not.toBe('WAITING_FOR_HUMAN');
    expect(state.waitingContext?.requestingState).toBe('REFINEMENT');
  });

  it('governance escalation populates waitingContext before checkpoint', async () => {
    const governance = makeGovernance();
    (governance.evaluateTransition as ReturnType<typeof vi.fn>).mockReturnValue({
      escalate: true,
      reason: 'governance_escalation',
    });

    const persistence = makePersistence();
    const reviewWorkflow = makeReviewWorkflow();
    const originalTransition = reviewWorkflow.states.REVIEW.transitions[0];
    (reviewWorkflow.states as Record<string, unknown>).REVIEW = {
      ...reviewWorkflow.states.REVIEW,
      transitions: [
        { ...originalTransition, governanceRequired: true },
        ...reviewWorkflow.states.REVIEW.transitions.slice(1),
      ],
    };

    const controller = new LifecycleController({
      runner: makeReviewRunner(),
      artifactStore: makeReviewStore(),
      governanceEngine: governance,
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: persistence,
      manifestProducer: makeManifest(),
    });

    const result = await controller.start(
      makeConfig({ workflowDefinition: reviewWorkflow, globalTransitionLimit: 10 }),
    );

    expect(result.finalState).toBe('WAITING_FOR_HUMAN');

    const state = controller.getState();
    expect(state.isWaitingForHuman).toBe(true);
    expect(state.waitingContext).toBeDefined();
    expect(state.waitingContext?.reason).toBe('governance_escalation');
    expect(state.waitingContext?.requiredInput).toBe('approval');
    expect(state.waitingContext?.requestingState).toBe('REVIEW');
    expect(state.waitingContext?.autoResumeSafe).toBe(false);

    const saveCall = (persistence.save as ReturnType<typeof vi.fn>).mock.calls;
    const lastSaved = saveCall[saveCall.length - 1][0] as {
      waitingContext?: { reason: string; requestingState: string };
    };
    expect(lastSaved.waitingContext).toBeDefined();
    expect(lastSaved.waitingContext?.reason).toBe('governance_escalation');
    expect(lastSaved.waitingContext?.requestingState).toBe('REVIEW');
  });

  it('review workflow + invalid_output failure transitions to REJECTED', async () => {
    const runner: RunnerSystem = {
      dispatch: vi.fn().mockResolvedValue({
        workerId: 'w1',
        role: 'reviewer',
        status: 'failure',
        outputArtifacts: [],
        error: {
          type: 'invalid_output',
          message: 'Invalid worker output: /approved: required property missing',
          retryable: false,
        },
        metrics: {
          startedAt: '',
          completedAt: '',
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          retryCount: 0,
          modelUsed: '',
        },
      }),
      dispatchParallel: vi.fn().mockResolvedValue([]),
      getWorkerStatus: vi.fn().mockReturnValue(null),
      cancelWorker: vi.fn(),
      cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
      setWorkerCounter: vi.fn(),
    };

    const controller = new LifecycleController({
      runner,
      artifactStore: makeReviewStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    const result = await controller.start(
      makeConfig({
        workflowDefinition: makeReviewWorkflow(),
        runId: 'run-review-invalid-output',
        globalTransitionLimit: 10,
      }),
    );

    expect(result.finalState).toBe('REJECTED');
    expect(controller.getState().currentState).toBe('REJECTED');
  });

  it('review workflow + agent_error failure transitions to FAILED', async () => {
    const runner: RunnerSystem = {
      dispatch: vi.fn().mockResolvedValue({
        workerId: 'w1',
        role: 'reviewer',
        status: 'failure',
        outputArtifacts: [],
        error: {
          type: 'agent_error',
          message: 'connection refused',
          retryable: false,
        },
        metrics: {
          startedAt: '',
          completedAt: '',
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          retryCount: 0,
          modelUsed: '',
        },
      }),
      dispatchParallel: vi.fn().mockResolvedValue([]),
      getWorkerStatus: vi.fn().mockReturnValue(null),
      cancelWorker: vi.fn(),
      cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
      setWorkerCounter: vi.fn(),
    };

    const controller = new LifecycleController({
      runner,
      artifactStore: makeReviewStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    const result = await controller.start(
      makeConfig({
        workflowDefinition: makeReviewWorkflow(),
        runId: 'run-review-provider-failure',
        globalTransitionLimit: 10,
      }),
    );

    expect(result.finalState).toBe('FAILED');
    expect(controller.getState().currentState).toBe('FAILED');
  });

  it('review workflow + schema_violation failure transitions to REJECTED', async () => {
    const runner: RunnerSystem = {
      dispatch: vi.fn().mockResolvedValue({
        workerId: 'w1',
        role: 'reviewer',
        status: 'failure',
        outputArtifacts: [],
        error: {
          type: 'schema_violation',
          message: 'Output does not match required schema',
          retryable: false,
        },
        metrics: {
          startedAt: '',
          completedAt: '',
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          retryCount: 0,
          modelUsed: '',
        },
      }),
      dispatchParallel: vi.fn().mockResolvedValue([]),
      getWorkerStatus: vi.fn().mockReturnValue(null),
      cancelWorker: vi.fn(),
      cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
      setWorkerCounter: vi.fn(),
    };

    const controller = new LifecycleController({
      runner,
      artifactStore: makeReviewStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    const result = await controller.start(
      makeConfig({
        workflowDefinition: makeReviewWorkflow(),
        runId: 'run-review-schema-violation',
        globalTransitionLimit: 10,
      }),
    );

    expect(result.finalState).toBe('REJECTED');
    expect(controller.getState().currentState).toBe('REJECTED');
  });

  it('passes artifact refs to governance during transition evaluation', async () => {
    const governance = makeGovernance();
    const reviewWorkflow = makeReviewWorkflow();
    const originalTransition = reviewWorkflow.states.REVIEW.transitions.at(0);
    (reviewWorkflow.states as Record<string, unknown>).REVIEW = {
      ...reviewWorkflow.states.REVIEW,
      transitions: [
        { ...originalTransition, governanceRequired: true },
        reviewWorkflow.states.REVIEW.transitions[1],
      ],
    };

    const controller = new LifecycleController({
      runner: makeReviewRunner(),
      artifactStore: makeReviewStore(),
      governanceEngine: governance,
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    await controller.start(
      makeConfig({ workflowDefinition: reviewWorkflow, globalTransitionLimit: 10 }),
    );

    const calls = (governance.evaluateTransition as ReturnType<typeof vi.fn>).mock.calls;
    const evalCall = calls.find(
      (c: unknown[]) => (c[0] as { artifacts: unknown[] }).artifacts.length > 0,
    );
    expect(evalCall).toBeDefined();
    const request = (evalCall as unknown[])[0] as { artifacts: unknown[] };
    expect(request.artifacts).toHaveLength(1);
    expect(request.artifacts[0]).toEqual(
      expect.objectContaining({ type: 'plan_review', name: 'plan_review' }),
    );
  });

  describe('stateRoleLabel in status messages', () => {
    function makeRejectionLoopWorkflow() {
      return {
        name: 'rejection-loop-test',
        version: '1.0.0',
        initialState: 'PLANNING',
        terminalStates: ['DONE', 'FAILED'],
        states: {
          PLANNING: {
            type: 'action' as const,
            label: 'Planning',
            description: 'Create the plan',
            entryActions: [{ type: 'dispatch_worker' as const, params: { role: 'planner' } }],
            transitions: [
              {
                target: 'PLAN_REVIEW',
                trigger: 'completion' as const,
                guards: [],
                governanceRequired: false,
                priority: 1,
              },
              {
                target: 'FAILED',
                trigger: 'failure' as const,
                guards: [],
                governanceRequired: false,
                priority: 2,
              },
            ],
          },
          PLAN_REVIEW: {
            type: 'review' as const,
            label: 'Plan Review',
            description: 'Review the plan',
            entryActions: [{ type: 'dispatch_worker' as const, params: { role: 'plan_reviewer' } }],
            transitions: [
              {
                target: 'DONE',
                trigger: 'review_approved' as const,
                guards: [],
                governanceRequired: false,
                priority: 1,
              },
              {
                target: 'PLANNING',
                trigger: 'review_rejected' as const,
                guards: [],
                governanceRequired: false,
                priority: 2,
              },
              {
                target: 'FAILED',
                trigger: 'failure' as const,
                guards: [],
                governanceRequired: false,
                priority: 3,
              },
            ],
          },
          DONE: {
            type: 'terminal' as const,
            description: 'Done',
            entryActions: [],
            transitions: [],
          },
          FAILED: {
            type: 'terminal' as const,
            description: 'Failed',
            entryActions: [],
            transitions: [],
          },
        } as WorkflowRunConfig['workflowDefinition']['states'],
      };
    }

    it('rejection message uses role name instead of state label', async () => {
      let dispatchCount = 0;
      const runner: RunnerSystem = {
        dispatch: vi.fn().mockImplementation(() => {
          dispatchCount++;
          const isReview = dispatchCount % 2 === 0;
          return Promise.resolve({
            workerId: `w${String(dispatchCount)}`,
            role: isReview ? 'plan_reviewer' : 'planner',
            status: 'success',
            outputArtifacts: [
              isReview
                ? { type: 'plan_review', name: 'plan_review', version: 1, checksum: 'abc' }
                : { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
            ],
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 0,
              inputTokens: 0,
              outputTokens: 0,
              retryCount: 0,
              modelUsed: '',
            },
          });
        }),
        dispatchParallel: vi.fn().mockResolvedValue([]),
        getWorkerStatus: vi.fn().mockReturnValue(null),
        cancelWorker: vi.fn(),
        cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
        setWorkerCounter: vi.fn(),
      };

      let getLatestCount = 0;
      const store = makeStore();
      store.getLatest = vi.fn().mockImplementation((type: string) => {
        getLatestCount++;
        if (type === 'plan_review') {
          const isFirstReview = getLatestCount <= 2;
          return Promise.resolve({
            type: 'plan_review',
            name: 'plan_review',
            version: 1,
            checksum: 'abc',
            content: isFirstReview
              ? '---\napproved: false\nfindings:\n  - Needs more detail\n---\nRejected.'
              : '---\napproved: true\nfindings: []\n---\nApproved.',
          });
        }
        return Promise.resolve({
          type,
          name: type,
          version: 1,
          checksum: 'abc',
          content: '',
        });
      }) as ArtifactStore['getLatest'];

      const streamBus = makeStreamBus();

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        agentStreamBus: streamBus,
      });

      await controller.start(
        makeConfig({
          workflowDefinition: makeRejectionLoopWorkflow(),
          globalTransitionLimit: 20,
        }),
      );

      const rejectionEvent = streamBus.events.find(
        (e) => e.type === 'status' && e.structuredData?.['action'] === 'review_rejection',
      );
      expect(rejectionEvent).toBeDefined();
      expect(rejectionEvent?.content).toBe('Plan Reviewer did not approve — moving to Planning.');
    });

    it('approval message uses role name instead of state label', async () => {
      const streamBus = makeStreamBus();

      let dispatchCount = 0;
      const runner: RunnerSystem = {
        dispatch: vi.fn().mockImplementation(() => {
          dispatchCount++;
          const isReview = dispatchCount % 2 === 0;
          return Promise.resolve({
            workerId: `w${String(dispatchCount)}`,
            role: isReview ? 'plan_reviewer' : 'planner',
            status: 'success',
            outputArtifacts: [
              isReview
                ? { type: 'plan_review', name: 'plan_review', version: 1, checksum: 'abc' }
                : { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
            ],
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 0,
              inputTokens: 0,
              outputTokens: 0,
              retryCount: 0,
              modelUsed: '',
            },
          });
        }),
        dispatchParallel: vi.fn().mockResolvedValue([]),
        getWorkerStatus: vi.fn().mockReturnValue(null),
        cancelWorker: vi.fn(),
        cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
        setWorkerCounter: vi.fn(),
      };

      const store = makeStore();
      store.getLatest = vi.fn().mockImplementation((type: string) => {
        if (type === 'plan_review') {
          return Promise.resolve({
            type: 'plan_review',
            name: 'plan_review',
            version: 1,
            checksum: 'abc',
            content: '---\napproved: true\nfindings: []\n---\nApproved.',
          });
        }
        return Promise.resolve({ type, name: type, version: 1, checksum: 'abc', content: '' });
      }) as ArtifactStore['getLatest'];

      const base = makeRejectionLoopWorkflow();
      const workflow = {
        ...base,
        states: {
          ...base.states,
          PLAN_REVIEW: {
            ...base.states.PLAN_REVIEW,
            transitions: [
              { ...base.states.PLAN_REVIEW.transitions[0], target: 'IMPLEMENT' },
              ...base.states.PLAN_REVIEW.transitions.slice(1),
            ],
          },
          IMPLEMENT: {
            type: 'action' as const,
            description: 'Implement',
            entryActions: [{ type: 'dispatch_worker' as const, params: { role: 'implementer' } }],
            transitions: [
              {
                target: 'DONE',
                trigger: 'completion' as const,
                guards: [],
                governanceRequired: false,
                priority: 1,
              },
            ],
          },
        } as WorkflowRunConfig['workflowDefinition']['states'],
      };

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        agentStreamBus: streamBus,
      });

      await controller.start(
        makeConfig({ workflowDefinition: workflow, globalTransitionLimit: 20 }),
      );

      const approvalEvent = streamBus.events.find(
        (e) => e.type === 'status' && e.structuredData?.['action'] === 'review_approval',
      );
      expect(approvalEvent).toBeDefined();
      expect(approvalEvent?.content).toContain('Plan Reviewer approved');
    });

    it('falls back to state label when no dispatch_worker action exists', async () => {
      const streamBus = makeStreamBus();

      let dispatchCount = 0;
      const runner: RunnerSystem = {
        dispatch: vi.fn().mockImplementation(() => {
          dispatchCount++;
          return Promise.resolve({
            workerId: `w${String(dispatchCount)}`,
            role: 'planner',
            status: 'success',
            outputArtifacts: [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 0,
              inputTokens: 0,
              outputTokens: 0,
              retryCount: 0,
              modelUsed: '',
            },
          });
        }),
        dispatchParallel: vi.fn().mockResolvedValue([]),
        getWorkerStatus: vi.fn().mockReturnValue(null),
        cancelWorker: vi.fn(),
        cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
        setWorkerCounter: vi.fn(),
      };

      const store = makeStore();

      const base = makeRejectionLoopWorkflow();
      const workflow = {
        ...base,
        states: {
          ...base.states,
          PLAN_REVIEW: {
            ...base.states.PLAN_REVIEW,
            label: 'Manual Review',
            entryActions: [],
          },
        } as WorkflowRunConfig['workflowDefinition']['states'],
      };

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        agentStreamBus: streamBus,
      });

      try {
        await controller.start(
          makeConfig({ workflowDefinition: workflow, globalTransitionLimit: 10 }),
        );
      } catch {
        // Expected: max transitions due to continuous rejection loop
      }

      const rejectionEvent = streamBus.events.find(
        (e) => e.type === 'status' && e.structuredData?.['action'] === 'review_rejection',
      );
      expect(rejectionEvent).toBeDefined();
      expect(rejectionEvent?.content).toContain('Manual Review did not approve');
    });

    it('suppresses rejection message when transitioning to terminal state', async () => {
      const streamBus = makeStreamBus();

      const controller = new LifecycleController({
        runner: makeReviewRunner(),
        artifactStore: makeReviewStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        agentStreamBus: streamBus,
      });

      await controller.start(
        makeConfig({ workflowDefinition: makeReviewWorkflow(), globalTransitionLimit: 10 }),
      );

      const rejectionEvent = streamBus.events.find(
        (e) => e.type === 'status' && e.structuredData?.['action'] === 'review_rejection',
      );
      expect(rejectionEvent).toBeUndefined();
    });

    it('suppresses approval message when transitioning to terminal state', async () => {
      const streamBus = makeStreamBus();

      const reviewRunner = {
        run: vi.fn().mockResolvedValueOnce({
          trigger: 'review_approved',
          artifacts: [],
        }),
      };

      const controller = new LifecycleController({
        runner: reviewRunner as unknown as ReturnType<typeof makeReviewRunner>,
        artifactStore: makeReviewStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        agentStreamBus: streamBus,
      });

      await controller.start(
        makeConfig({ workflowDefinition: makeReviewWorkflow(), globalTransitionLimit: 10 }),
      );

      const approvalEvent = streamBus.events.find(
        (e) => e.type === 'status' && e.structuredData?.['action'] === 'review_approval',
      );
      expect(approvalEvent).toBeUndefined();
    });
  });

  describe('retry()', () => {
    it('should throw when no config is loaded', async () => {
      const controller = new LifecycleController({
        runner: makeRunner(),
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });
      await expect(controller.retry()).rejects.toThrow('No active run to retry');
    });

    it('should throw when current state is terminal', async () => {
      const controller = new LifecycleController({
        runner: makeRunner(),
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });
      controller.restore(makeConfig(), {
        runId: 'run-001',
        schemaVersion: 2,
        currentState: 'ABORTED',
        previousState: 'PLANNING',
        stateEnteredAt: new Date().toISOString(),
        transitionCount: 5,
        stateHistory: ['INTAKE', 'PLANNING', 'ABORTED'],
        iterationCounts: {},
        activeArtifacts: [],
        lastProducedArtifact: null,
        workflowName: 'dev',
        workflowVersion: '1.0.0',
        persistedAt: new Date().toISOString(),
        persistenceVersion: 1,
        checksum: '',
      });
      await expect(controller.retry()).rejects.toThrow('Cannot retry from terminal state');
    });

    it('should re-enter the run loop from a non-terminal state', async () => {
      const journal = makeJournal();
      const streamBus = makeStreamBus();

      const simpleWorkflow = {
        name: 'retry-test',
        version: '1.0.0',
        initialState: 'STEP_A',
        terminalStates: ['DONE', 'ABORTED'],
        states: {
          STEP_A: {
            type: 'action' as const,
            description: 'First step',
            entryActions: [{ type: 'dispatch_worker' as const, params: { role: 'planner' } }],
            transitions: [
              {
                target: 'DONE',
                trigger: 'completion' as const,
                guards: [],
                governanceRequired: false,
                priority: 1,
              },
              {
                target: 'ABORTED',
                trigger: 'failure' as const,
                guards: [],
                governanceRequired: false,
                priority: 2,
              },
            ],
          },
          DONE: {
            type: 'terminal' as const,
            description: 'Done',
            entryActions: [],
            transitions: [],
          },
          ABORTED: {
            type: 'terminal' as const,
            description: 'Aborted',
            entryActions: [],
            transitions: [],
          },
        },
      };

      const controller = new LifecycleController({
        runner: makeRunner(),
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: journal,
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        agentStreamBus: streamBus,
      });

      controller.restore(makeConfig({ workflowDefinition: simpleWorkflow }), {
        runId: 'run-001',
        schemaVersion: 2,
        currentState: 'STEP_A',
        previousState: null,
        stateEnteredAt: new Date().toISOString(),
        transitionCount: 1,
        stateHistory: ['STEP_A'],
        iterationCounts: {},
        activeArtifacts: [],
        lastProducedArtifact: null,
        workflowName: 'retry-test',
        workflowVersion: '1.0.0',
        persistedAt: new Date().toISOString(),
        persistenceVersion: 1,
        checksum: '',
      });

      const result = await controller.retry();

      expect(result.runId).toBe('run-001');
      expect(result.finalState).toBe('DONE');

      const journalCalls = (journal.append as ReturnType<typeof vi.fn>).mock.calls;
      const resumedEvent = journalCalls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'run_resumed',
      );
      expect(resumedEvent).toBeDefined();
      const eventData = (resumedEvent?.[0] as { data: { status: string } } | undefined)?.data;
      expect(eventData?.status).toBe('retrying');
    });
  });

  describe('mapTerminalStateToOutcome', () => {
    function makeSimpleTerminalWorkflow(
      terminalState: string,
      terminalStates: string[],
    ): WorkflowRunConfig['workflowDefinition'] {
      return {
        name: 'terminal-test',
        version: '1.0.0',
        initialState: 'START',
        terminalStates,
        states: {
          START: {
            type: 'action' as const,
            description: 'Start',
            entryActions: [{ type: 'dispatch_worker' as const, params: { role: 'planner' } }],
            transitions: [
              {
                target: terminalState,
                trigger: 'failure' as const,
                guards: [],
                governanceRequired: false,
                priority: 1,
              },
            ],
          },
          [terminalState]: {
            type: 'terminal' as const,
            description: terminalState,
            entryActions: [],
            transitions: [],
          },
        },
      };
    }

    it('maps ABORTED terminal state to aborted outcome', async () => {
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn(),
        query: vi.fn().mockResolvedValue([]),
        getProjectHash: vi.fn().mockReturnValue('abc'),
      };
      const runner = makeRunner();
      (runner.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        workerId: 'w1',
        role: 'planner',
        status: 'failure',
        outputArtifacts: [],
        metrics: {
          startedAt: '',
          completedAt: '',
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          retryCount: 0,
          modelUsed: '',
        },
      });
      const controller = new LifecycleController({
        runner,
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        projectContextStore: contextStore,
      });
      const result = await controller.start(
        makeConfig({
          globalTransitionLimit: 50,
          workflowDefinition: makeSimpleTerminalWorkflow('ABORTED', ['ABORTED']),
        }),
      );
      expect(result.finalState).toBe('ABORTED');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const writeFn = contextStore.write as ReturnType<typeof vi.fn>;
      const historyCall = writeFn.mock.calls.find((c: unknown[]) => c[0] === 'run_history') as
        [string, { content: { runs: { outcome: string }[] } }] | undefined;
      expect(historyCall).toBeDefined();
      expect(historyCall?.[1].content.runs[0].outcome).toBe('aborted');
    });

    it('maps FAILED terminal state to failed outcome', async () => {
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn(),
        query: vi.fn().mockResolvedValue([]),
        getProjectHash: vi.fn().mockReturnValue('abc'),
      };
      const runner = makeRunner();
      (runner.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        workerId: 'w1',
        role: 'planner',
        status: 'failure',
        outputArtifacts: [],
        metrics: {
          startedAt: '',
          completedAt: '',
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          retryCount: 0,
          modelUsed: '',
        },
      });
      const controller = new LifecycleController({
        runner,
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        projectContextStore: contextStore,
      });
      const result = await controller.start(
        makeConfig({
          globalTransitionLimit: 50,
          workflowDefinition: makeSimpleTerminalWorkflow('FAILED', ['FAILED']),
        }),
      );
      expect(result.finalState).toBe('FAILED');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const writeFn = contextStore.write as ReturnType<typeof vi.fn>;
      const historyCall = writeFn.mock.calls.find((c: unknown[]) => c[0] === 'run_history') as
        [string, { content: { runs: { outcome: string }[] } }] | undefined;
      expect(historyCall).toBeDefined();
      expect(historyCall?.[1].content.runs[0].outcome).toBe('failed');
    });

    it('maps WAITING_FOR_HUMAN terminal state to escalated outcome', async () => {
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn(),
        query: vi.fn().mockResolvedValue([]),
        getProjectHash: vi.fn().mockReturnValue('abc'),
      };
      const runner = makeRunner();
      (runner.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        workerId: 'w1',
        role: 'planner',
        status: 'failure',
        outputArtifacts: [],
        metrics: {
          startedAt: '',
          completedAt: '',
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          retryCount: 0,
          modelUsed: '',
        },
      });
      const controller = new LifecycleController({
        runner,
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        projectContextStore: contextStore,
      });
      const result = await controller.start(
        makeConfig({
          globalTransitionLimit: 50,
          workflowDefinition: makeSimpleTerminalWorkflow('WAITING_FOR_HUMAN', [
            'WAITING_FOR_HUMAN',
          ]),
        }),
      );
      expect(result.finalState).toBe('WAITING_FOR_HUMAN');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const writeFn = contextStore.write as ReturnType<typeof vi.fn>;
      const historyCall = writeFn.mock.calls.find((c: unknown[]) => c[0] === 'run_history') as
        [string, { content: { runs: { outcome: string }[] } }] | undefined;
      expect(historyCall).toBeDefined();
      expect(historyCall?.[1].content.runs[0].outcome).toBe('escalated');
    });
  });

  describe('codebase context persistence', () => {
    it('persists codebase context to project store when codebase_context artifact is produced', async () => {
      const codebaseRunner: RunnerSystem = {
        dispatch: vi.fn().mockResolvedValue({
          workerId: 'w1',
          role: 'codebase_analyst',
          status: 'success',
          outputArtifacts: [
            { type: 'codebase_context', name: 'codebase-ctx', version: 1, checksum: 'ctx123' },
          ],
          metrics: {
            startedAt: '',
            completedAt: '',
            durationMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            retryCount: 0,
            modelUsed: '',
          },
        }),
        dispatchParallel: vi.fn().mockResolvedValue([]),
        getWorkerStatus: vi.fn().mockReturnValue(null),
        cancelWorker: vi.fn(),
        cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
        setWorkerCounter: vi.fn(),
      };

      const store = makeStore();
      store.get = vi.fn().mockResolvedValue({
        type: 'codebase_context',
        name: 'codebase-ctx',
        version: 1,
        checksum: 'ctx123',
        content: {
          projectStructure: 'Monorepo with packages/',
          conventions: ['Use kebab-case', 'No default exports'],
          existingPatterns: ['Hexagonal architecture'],
          techStack: ['TypeScript 5.x'],
        },
      });

      const writeFn = vi.fn();
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockResolvedValue(null),
        write: writeFn,
        query: vi.fn().mockResolvedValue([]),
        getProjectHash: vi.fn().mockReturnValue('abc123'),
      };

      const controller = new LifecycleController({
        runner: codebaseRunner,
        artifactStore: store,
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        projectContextStore: contextStore,
      });

      await controller.start(
        makeConfig({ globalTransitionLimit: 50, repoRoot: '/tmp/my-project' }),
      );

      expect(writeFn).toHaveBeenCalled();
      const call = writeFn.mock.calls.find((c: unknown[]) => c[0] === 'codebase') as [
        string,
        { content: { projectName: string; architecture: { summary: string } } },
      ];
      expect(call).toBeDefined();
      expect(call[1].content.projectName).toBe('my-project');
      expect(call[1].content.architecture.summary).toContain('Monorepo with packages/');
    });

    it('does not call project store when no codebase_context artifact is produced', async () => {
      const writeFn = vi.fn();
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockResolvedValue(null),
        write: writeFn,
        query: vi.fn().mockResolvedValue([]),
        getProjectHash: vi.fn().mockReturnValue('abc123'),
      };

      const controller = new LifecycleController({
        runner: makeRunner(),
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        projectContextStore: contextStore,
      });

      await controller.start(
        makeConfig({ globalTransitionLimit: 50, repoRoot: '/tmp/my-project' }),
      );

      const codebaseWrites = writeFn.mock.calls.filter((c: unknown[]) => c[0] === 'codebase');
      expect(codebaseWrites).toHaveLength(0);
    });
  });
});
