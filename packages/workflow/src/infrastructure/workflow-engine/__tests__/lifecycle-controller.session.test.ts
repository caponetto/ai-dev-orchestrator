import type {
  AgentSessionSupervisor,
  ArtifactStore,
  GovernanceEngine,
  IterationContractRegistry,
  JournalWriter,
  ManifestProducer,
  RunnerSystem,
  StatePersistence,
} from '@ai-orchestrator/ports';
import type { RunManifest, WorkflowDefinition, WorkflowRunConfig } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../lifecycle-controller';

function makeSessionWorkflow(): WorkflowDefinition {
  return {
    name: 'session-test',
    version: '1.0.0',
    initialState: 'IMPL',
    terminalStates: ['DONE', 'FAILED'],
    states: {
      IMPL: {
        type: 'action',
        description: 'Implementation state',
        entryActions: [{ type: 'dispatch_worker', params: { role: 'implementer' } }],
        transitions: [
          {
            target: 'DONE',
            trigger: 'completion',
            guards: [],
            governanceRequired: false,
            priority: 1,
          },
          {
            target: 'FAILED',
            trigger: 'failure',
            guards: [],
            governanceRequired: false,
            priority: 2,
          },
        ],
      },
      WAITING_FOR_HUMAN: {
        type: 'wait',
        description: 'Waiting for human input',
        transitions: [
          {
            target: 'IMPL',
            trigger: 'human_input',
            guards: [],
            governanceRequired: false,
            priority: 1,
          },
          {
            target: 'IMPL',
            trigger: 'human_approved',
            guards: [],
            governanceRequired: false,
            priority: 2,
          },
        ],
      },
      DONE: {
        type: 'terminal',
        description: 'Done',
        transitions: [],
      },
      FAILED: {
        type: 'terminal',
        description: 'Failed',
        transitions: [],
      },
    },
  };
}

function makeSessionRunner(dispatchResults: Array<ReturnType<typeof vi.fn>>): RunnerSystem {
  let callIndex = 0;
  return {
    dispatch: vi.fn().mockImplementation(() => {
      const result = dispatchResults[callIndex];
      if (callIndex < dispatchResults.length - 1) {
        callIndex += 1;
      }
      return result() as unknown;
    }),
    dispatchParallel: vi.fn().mockResolvedValue([]),
    getWorkerStatus: vi.fn().mockReturnValue(null),
    cancelWorker: vi.fn(),
    cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
  };
}

function makeStore(): ArtifactStore {
  return {
    store: vi.fn().mockResolvedValue({ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }),
    get: vi.fn().mockResolvedValue(null),
    getLatest: vi.fn().mockResolvedValue(null),
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

function makeSupervisor(overrides: Partial<AgentSessionSupervisor> = {}): AgentSessionSupervisor {
  return {
    createSession: vi.fn().mockResolvedValue({
      ref: {
        sessionId: 'sess-1',
        runId: 'run-001',
        stateId: 'IMPL',
        role: 'implementer',
        transport: 'stdio',
      },
      state: 'running',
      pendingRequests: [],
    }),
    attach: vi.fn().mockResolvedValue({
      ref: {
        sessionId: 'sess-1',
        runId: 'run-001',
        stateId: 'IMPL',
        role: 'implementer',
        transport: 'stdio',
      },
      state: 'awaiting_human',
      pendingRequests: [],
    }),
    sendHumanResponse: vi.fn().mockResolvedValue(true),
    waitForAdvance: vi.fn().mockResolvedValue({
      kind: 'completed',
      artifactContent: 'session output',
      durationMs: 100,
    }),
    pause: vi.fn().mockResolvedValue(true),
    abort: vi.fn().mockResolvedValue(true),
    finalize: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockResolvedValue(null),
    getState: vi.fn().mockReturnValue(null),
    listByRun: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<WorkflowRunConfig> = {}): WorkflowRunConfig {
  return {
    runId: 'run-001',
    workflowDefinition: makeSessionWorkflow(),
    governancePolicy: {},
    roleAssignments: {},
    sources: [],
    ...overrides,
  };
}

function successResult() {
  return vi.fn().mockResolvedValue({
    workerId: 'w1',
    role: 'implementer',
    status: 'success',
    outputArtifacts: [{ type: 'implementation', name: 'impl', version: 1, checksum: 'def' }],
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
}

function sessionAwaitingResult() {
  return vi.fn().mockResolvedValue({
    workerId: 'w1',
    role: 'implementer',
    status: 'success',
    outputArtifacts: [],
    sessionOutcome: 'awaiting_human',
    sessionRef: {
      sessionId: 'sess-1',
      runId: 'run-001',
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
}

describe('LifecycleController session integration', () => {
  it('pauses on session awaiting_human and sets waiting context with session metadata', async () => {
    const runner = makeSessionRunner([sessionAwaitingResult()]);
    const journal = makeJournal();
    const persistence = makePersistence();

    const controller = new LifecycleController({
      runner,
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: persistence,
      manifestProducer: makeManifest(),
    });

    await controller.start(makeConfig());

    const state = controller.getState();
    expect(state.currentState).toBe('WAITING_FOR_HUMAN');
    expect(state.isWaitingForHuman).toBe(true);

    expect(vi.mocked(persistence).save.mock.calls.length).toBeGreaterThan(0);
    const savedState = vi.mocked(persistence).save.mock.calls.at(-1)?.[0];
    expect(savedState?.waitingContext?.liveSessionId).toBe('sess-1');
    expect(savedState?.waitingContext?.pendingRequestId).toBe('req-1');
    expect(savedState?.waitingContext?.liveRequestType).toBe('permission');
    expect(savedState?.waitingContext?.sessionTransport).toBe('stdio');
    expect(savedState?.waitingContext?.reason).toBe('live_session_awaiting_human');
  });

  it('records journal entry with sessionId when pausing for session', async () => {
    const journal = makeJournal();

    const controller = new LifecycleController({
      runner: makeSessionRunner([sessionAwaitingResult()]),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    await controller.start(makeConfig());

    const humanInputCalls = vi
      .mocked(journal)
      .append.mock.calls.filter((call) => call[0].type === 'human_input_requested');
    expect(humanInputCalls.length).toBeGreaterThanOrEqual(1);
    const sessionEntry = humanInputCalls.find(
      (call) => (call[0].data as unknown as Record<string, unknown>).sessionId === 'sess-1',
    );
    expect(sessionEntry).toBeDefined();
  });

  it('sets requiredInput to text for clarification session requests', async () => {
    const clarificationResult = vi.fn().mockResolvedValue({
      workerId: 'w1',
      role: 'implementer',
      status: 'success',
      outputArtifacts: [],
      sessionOutcome: 'awaiting_human',
      sessionRef: {
        sessionId: 'sess-2',
        runId: 'run-001',
        stateId: 'IMPL',
        role: 'implementer',
        transport: 'remote',
      },
      pendingRequest: {
        requestId: 'req-2',
        kind: 'clarification',
        createdAt: '2026-01-01T00:00:00Z',
        payload: { question: 'Which approach?' },
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
    });

    const persistence = makePersistence();
    const controller = new LifecycleController({
      runner: makeSessionRunner([clarificationResult]),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: persistence,
      manifestProducer: makeManifest(),
    });

    await controller.start(makeConfig());

    const savedState = vi.mocked(persistence).save.mock.calls.at(-1)?.[0];
    expect(savedState?.waitingContext?.requiredInput).toBe('text');
    expect(savedState?.waitingContext?.liveRequestType).toBe('clarification');
    expect(savedState?.waitingContext?.sessionTransport).toBe('remote');
  });

  it('resumes from session-backed wait by returning to requesting state', async () => {
    const runner = makeSessionRunner([sessionAwaitingResult(), successResult()]);
    const persistence = makePersistence();
    const journal = makeJournal();
    const supervisor = makeSupervisor();

    const controller = new LifecycleController({
      runner,
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: persistence,
      manifestProducer: makeManifest(),
      sessionSupervisor: supervisor,
    });

    await controller.start(makeConfig());
    expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');

    const result = await controller.resume({ type: 'approval', content: 'approved' });

    expect(result.finalState).toBeDefined();
    expect(supervisor.attach).toHaveBeenCalledWith('sess-1'); // eslint-disable-line @typescript-eslint/unbound-method
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(supervisor.sendHumanResponse).toHaveBeenCalledWith('sess-1', 'req-1', {
      granted: true,
      reason: 'approved',
    });
    expect(supervisor.waitForAdvance).toHaveBeenCalledWith('sess-1'); // eslint-disable-line @typescript-eslint/unbound-method

    const resumeJournal = vi
      .mocked(journal)
      .append.mock.calls.find((call) => call[0].type === 'human_input_received');
    expect(resumeJournal).toBeDefined();
    const resumeEntry = resumeJournal as NonNullable<typeof resumeJournal>;
    expect((resumeEntry[0].data as unknown as Record<string, unknown>).sessionId).toBe('sess-1');
    expect((resumeEntry[0].data as unknown as Record<string, unknown>).action).toBe(
      'session_resumed',
    );
  });

  it('clears waiting context after session-backed resume', async () => {
    const runner = makeSessionRunner([sessionAwaitingResult(), successResult()]);
    const persistence = makePersistence();

    const controller = new LifecycleController({
      runner,
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: persistence,
      manifestProducer: makeManifest(),
      sessionSupervisor: makeSupervisor(),
    });

    await controller.start(makeConfig());
    await controller.resume({ type: 'approval', content: 'approved' });

    const state = controller.getState();
    expect(state.isWaitingForHuman).toBe(false);
    expect(state.waitingContext).toBeUndefined();
  });

  it('does not pause for session_active outcome (no pending requests)', async () => {
    const activeResult = vi.fn().mockResolvedValue({
      workerId: 'w1',
      role: 'implementer',
      status: 'success',
      outputArtifacts: [{ type: 'implementation', name: 'impl', version: 1, checksum: 'def' }],
      sessionOutcome: 'session_active',
      sessionRef: {
        sessionId: 'sess-3',
        runId: 'run-001',
        stateId: 'IMPL',
        role: 'implementer',
        transport: 'stdio',
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
    });

    const controller = new LifecycleController({
      runner: makeSessionRunner([activeResult]),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    const result = await controller.start(makeConfig());
    expect(result.finalState).toBe('DONE');
  });

  it('handles dead session on resume with controlled FAILED transition', async () => {
    const runner = makeSessionRunner([sessionAwaitingResult()]);
    const persistence = makePersistence();
    const supervisor = makeSupervisor({
      attach: vi.fn().mockResolvedValue(null),
    });

    const controller = new LifecycleController({
      runner,
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: persistence,
      manifestProducer: makeManifest(),
      sessionSupervisor: supervisor,
    });

    await controller.start(makeConfig());
    expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');

    const result = await controller.resume({ type: 'approval', content: 'approved' });

    expect(result.finalState).toBe('FAILED');
    expect(supervisor.attach).toHaveBeenCalledWith('sess-1'); // eslint-disable-line @typescript-eslint/unbound-method
    expect(supervisor.sendHumanResponse).not.toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method
  });

  it('dead session persists FAILED state durably and clears waiting context', async () => {
    const runner = makeSessionRunner([sessionAwaitingResult()]);
    const persistence = makePersistence();
    const supervisor = makeSupervisor({
      attach: vi.fn().mockResolvedValue(null),
    });

    const controller = new LifecycleController({
      runner,
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: persistence,
      manifestProducer: makeManifest(),
      sessionSupervisor: supervisor,
    });

    await controller.start(makeConfig());
    expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');

    await controller.resume({ type: 'approval', content: 'approved' });

    const savedCalls = vi.mocked(persistence).save.mock.calls;
    const lastSaved = savedCalls.at(-1)?.[0];
    expect(lastSaved).toBeDefined();
    expect(lastSaved?.currentState).toBe('FAILED');
    expect(lastSaved?.waitingContext).toBeUndefined();
  });

  it('pauses again when advance returns awaiting_human with new request', async () => {
    const runner = makeSessionRunner([sessionAwaitingResult()]);
    const persistence = makePersistence();
    const supervisor = makeSupervisor({
      waitForAdvance: vi.fn().mockResolvedValue({
        kind: 'awaiting_human',
        pendingRequest: {
          requestId: 'req-2',
          kind: 'clarification',
          createdAt: '2026-01-01T00:00:00Z',
          payload: { question: 'Which approach?' },
        },
      }),
    });

    const controller = new LifecycleController({
      runner,
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: persistence,
      manifestProducer: makeManifest(),
      sessionSupervisor: supervisor,
    });

    await controller.start(makeConfig());
    expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');

    const result = await controller.resume({ type: 'approval', content: 'approved' });

    expect(result.finalState).toBe('WAITING_FOR_HUMAN');
    const savedState = vi.mocked(persistence).save.mock.calls.at(-1)?.[0];
    expect(savedState?.waitingContext?.pendingRequestId).toBe('req-2');
    expect(savedState?.waitingContext?.liveRequestType).toBe('clarification');
  });

  it('throws when resuming session without supervisor configured', async () => {
    const runner = makeSessionRunner([sessionAwaitingResult()]);

    const controller = new LifecycleController({
      runner,
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    await controller.start(makeConfig());

    await expect(controller.resume({ type: 'approval', content: 'approved' })).rejects.toThrow(
      'no session supervisor configured',
    );
  });

  it('dead stdio session produces transport-aware error message', async () => {
    const runner = makeSessionRunner([sessionAwaitingResult()]);
    const persistence = makePersistence();
    const journal = makeJournal();
    const supervisor = makeSupervisor({
      attach: vi.fn().mockResolvedValue(null),
      getSnapshot: vi.fn().mockResolvedValue({
        ref: {
          sessionId: 'sess-1',
          runId: 'run-001',
          stateId: 'IMPL',
          role: 'implementer',
          transport: 'stdio',
        },
        state: 'running',
        pendingRequests: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        workerId: 'sess-1',
      }),
    });

    const controller = new LifecycleController({
      runner,
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: persistence,
      manifestProducer: makeManifest(),
      sessionSupervisor: supervisor,
    });

    await controller.start(makeConfig());
    expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');

    const result = await controller.resume({ type: 'approval', content: 'approved' });
    expect(result.finalState).toBe('FAILED');

    const failEntries = vi
      .mocked(journal)
      .append.mock.calls.filter(
        (call) =>
          call[0].type === 'error' &&
          (call[0].data as unknown as Record<string, unknown>)['errorCode'] === 'dead_session',
      );
    expect(failEntries.length).toBeGreaterThanOrEqual(1);
    const failData = failEntries[0][0].data as unknown as Record<string, unknown>;
    expect(failData['message']).toContain('stdin/stdout');
  });

  it('dead remote session produces transport-aware error message', async () => {
    const clarificationResult = vi.fn().mockResolvedValue({
      workerId: 'w1',
      role: 'implementer',
      status: 'success',
      outputArtifacts: [],
      sessionOutcome: 'awaiting_human',
      sessionRef: {
        sessionId: 'sess-r1',
        runId: 'run-001',
        stateId: 'IMPL',
        role: 'implementer',
        transport: 'remote',
      },
      pendingRequest: {
        requestId: 'req-r1',
        kind: 'permission',
        createdAt: '2026-01-01T00:00:00Z',
        payload: { action: 'write_file' },
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
    });

    const journal = makeJournal();
    const persistence = makePersistence();
    const supervisor = makeSupervisor({
      attach: vi.fn().mockResolvedValue(null),
      getSnapshot: vi.fn().mockResolvedValue({
        ref: {
          sessionId: 'sess-r1',
          runId: 'run-001',
          stateId: 'IMPL',
          role: 'implementer',
          transport: 'remote',
        },
        state: 'paused',
        pendingRequests: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        workerId: 'sess-r1',
      }),
    });

    const controller = new LifecycleController({
      runner: makeSessionRunner([clarificationResult]),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: persistence,
      manifestProducer: makeManifest(),
      sessionSupervisor: supervisor,
    });

    await controller.start(makeConfig());
    expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');

    const result = await controller.resume({ type: 'approval', content: 'approved' });
    expect(result.finalState).toBe('FAILED');

    const failEntries = vi
      .mocked(journal)
      .append.mock.calls.filter(
        (call) =>
          call[0].type === 'error' &&
          (call[0].data as unknown as Record<string, unknown>)['errorCode'] === 'dead_session',
      );
    expect(failEntries.length).toBeGreaterThanOrEqual(1);
    const failData = failEntries[0][0].data as unknown as Record<string, unknown>;
    expect(failData['message']).toContain('transport factory');
  });

  it('non-session action results follow normal workflow path', async () => {
    const controller = new LifecycleController({
      runner: makeSessionRunner([successResult()]),
      artifactStore: makeStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifest(),
    });

    const result = await controller.start(makeConfig());
    expect(result.finalState).toBe('DONE');
  });
});
