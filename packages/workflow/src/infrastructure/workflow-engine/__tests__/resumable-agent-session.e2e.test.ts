import type {
  AgentSessionSupervisor,
  ArtifactStore,
  GovernanceEngine,
  IterationContractRegistry,
  JournalWriter,
  ManifestProducer,
  RunnerSystem,
  StatePersistence,
} from '@ai-dev-orchestrator/ports';
import { AgentSessionReaper, DefaultAgentSessionStore } from '@ai-dev-orchestrator/runner';
import type {
  AgentSessionSnapshot,
  PersistedState,
  RunId,
  RunManifest,
  WorkflowDefinition,
  WorkflowRunConfig,
} from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../lifecycle-controller';

function makeSessionWorkflow(): WorkflowDefinition {
  return {
    name: 'e2e-session-test',
    version: '1.0.0',
    initialState: 'IMPL',
    terminalStates: ['DONE', 'FAILED'],
    states: {
      IMPL: {
        type: 'action',
        description: 'Implementation',
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
        description: 'Waiting for human',
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
      DONE: { type: 'terminal', description: 'Done', transitions: [] },
      FAILED: { type: 'terminal', description: 'Failed', transitions: [] },
    },
  };
}

function makeRunner(results: Array<() => Promise<unknown>>): RunnerSystem {
  let callIndex = 0;
  return {
    dispatch: vi.fn().mockImplementation(() => {
      const result = results[callIndex];
      if (callIndex < results.length - 1) {
        callIndex += 1;
      }
      return result();
    }),
    dispatchParallel: vi.fn().mockResolvedValue([]),
    getWorkerStatus: vi.fn().mockReturnValue(null),
    cancelWorker: vi.fn(),
    cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
    setWorkerCounter: vi.fn(),
  };
}

function makeStore(): ArtifactStore {
  return {
    store: vi
      .fn()
      .mockResolvedValue({ type: 'implementation', name: 'impl', version: 1, checksum: 'abc' }),
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

function makeContracts(): IterationContractRegistry {
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
  return { append: vi.fn(), appendBatch: vi.fn() };
}

function makePersistence(): StatePersistence {
  let savedState: PersistedState | null = null;
  return {
    save: vi.fn().mockImplementation((state: PersistedState) => {
      savedState = state;
    }),
    load: vi.fn().mockImplementation(() => savedState),
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

function makeConfig(): WorkflowRunConfig {
  return {
    runId: 'run-001',
    workflowDefinition: makeSessionWorkflow(),
    governancePolicy: {},
    roleAssignments: {},
    sources: [],
  };
}

function makeSupervisor(overrides?: Partial<AgentSessionSupervisor>): AgentSessionSupervisor {
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

const metrics = {
  startedAt: '',
  completedAt: '',
  durationMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  retryCount: 0,
  modelUsed: '',
};

function successDispatch() {
  return () =>
    Promise.resolve({
      workerId: 'w1',
      role: 'implementer',
      status: 'success',
      outputArtifacts: [{ type: 'implementation', name: 'impl', version: 1, checksum: 'def' }],
      metrics,
    });
}

function sessionPermissionDispatch() {
  return () =>
    Promise.resolve({
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
        transport: 'stdio' as const,
      },
      pendingRequest: {
        requestId: 'req-1',
        kind: 'permission' as const,
        createdAt: '2026-01-01T00:00:00Z',
        payload: { action: 'write_file' },
      },
      metrics,
    });
}

function sessionClarificationDispatch() {
  return () =>
    Promise.resolve({
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
        transport: 'stdio' as const,
      },
      pendingRequest: {
        requestId: 'req-2',
        kind: 'clarification' as const,
        createdAt: '2026-01-01T00:00:00Z',
        payload: { question: 'Which approach?' },
      },
      metrics,
    });
}

function legacyDispatch() {
  return () =>
    Promise.resolve({
      workerId: 'w1',
      role: 'implementer',
      status: 'success',
      outputArtifacts: [{ type: 'implementation', name: 'impl', version: 1, checksum: 'ghi' }],
      metrics,
    });
}

describe('Resumable agent session e2e', () => {
  describe('happy-path scenarios', () => {
    it('permission request: pause -> permit -> resume -> complete', async () => {
      const runner = makeRunner([sessionPermissionDispatch(), successDispatch()]);
      const persistence = makePersistence();
      const controller = new LifecycleController({
        runner,
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContracts(),
        journalWriter: makeJournal(),
        statePersistence: persistence,
        manifestProducer: makeManifest(),
        sessionSupervisor: makeSupervisor(),
      });

      await controller.start(makeConfig());
      expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');
      expect(controller.getState().isWaitingForHuman).toBe(true);

      const saved = vi.mocked(persistence).save.mock.calls.at(-1)?.[0];
      expect(saved?.waitingContext?.liveSessionId).toBe('sess-1');
      expect(saved?.waitingContext?.liveRequestType).toBe('permission');

      const result = await controller.resume({ type: 'approval', content: 'approved' });
      expect(result.finalState).toBe('DONE');
    });

    it('clarification request: pause -> answer -> resume -> complete', async () => {
      const runner = makeRunner([sessionClarificationDispatch(), successDispatch()]);
      const controller = new LifecycleController({
        runner,
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContracts(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        sessionSupervisor: makeSupervisor(),
      });

      await controller.start(makeConfig());
      expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');

      const result = await controller.resume({ type: 'text', content: 'Use approach A' });
      expect(result.finalState).toBe('DONE');
    });
  });

  describe('restart scenarios', () => {
    it('local stdio session fails after restart (v1 limitation)', async () => {
      const runner = makeRunner([sessionPermissionDispatch()]);
      const persistence = makePersistence();
      const supervisor = makeSupervisor();

      const controller1 = new LifecycleController({
        runner,
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContracts(),
        journalWriter: makeJournal(),
        statePersistence: persistence,
        manifestProducer: makeManifest(),
        sessionSupervisor: supervisor,
      });

      await controller1.start(makeConfig());
      expect(controller1.getState().currentState).toBe('WAITING_FOR_HUMAN');

      const checkpoint = vi.mocked(persistence).load('run-001' as RunId) as PersistedState;
      expect(checkpoint).toBeDefined();
      expect(checkpoint.waitingContext?.liveSessionId).toBe('sess-1');
      expect(checkpoint.waitingContext?.sessionTransport).toBe('stdio');

      // Simulate restart: fresh supervisor has no hosts in memory,
      // so attach() returns null — the child process handle is lost.
      const restartSupervisor = makeSupervisor({
        attach: vi.fn().mockResolvedValue(null),
      });

      const controller2 = new LifecycleController({
        runner: makeRunner([successDispatch()]),
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContracts(),
        journalWriter: makeJournal(),
        statePersistence: persistence,
        manifestProducer: makeManifest(),
        sessionSupervisor: restartSupervisor,
      });
      controller2.restore(makeConfig(), checkpoint);

      const result = await controller2.resume({ type: 'approval', content: 'approved' });
      expect(result.finalState).toBe('FAILED');

      const lastSaved = vi.mocked(persistence).save.mock.calls.at(-1)?.[0];
      expect(lastSaved?.currentState).toBe('FAILED');
      expect(lastSaved?.waitingContext).toBeUndefined();
    });
  });

  describe('remote restart scenarios', () => {
    it('remote session survives restart via reconnect', async () => {
      const remoteDispatch = () =>
        Promise.resolve({
          workerId: 'w1',
          role: 'implementer',
          status: 'success',
          outputArtifacts: [],
          sessionOutcome: 'awaiting_human',
          sessionRef: {
            sessionId: 'rsess-1',
            runId: 'run-001',
            stateId: 'IMPL',
            role: 'implementer',
            transport: 'remote' as const,
          },
          pendingRequest: {
            requestId: 'req-r1',
            kind: 'permission' as const,
            createdAt: '2026-01-01T00:00:00Z',
            payload: { action: 'write_file' },
          },
          metrics,
        });

      const runner = makeRunner([remoteDispatch, successDispatch()]);
      const persistence = makePersistence();
      const supervisor = makeSupervisor();

      const controller1 = new LifecycleController({
        runner,
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContracts(),
        journalWriter: makeJournal(),
        statePersistence: persistence,
        manifestProducer: makeManifest(),
        sessionSupervisor: supervisor,
      });

      await controller1.start(makeConfig());
      expect(controller1.getState().currentState).toBe('WAITING_FOR_HUMAN');

      const checkpoint = vi.mocked(persistence).load('run-001' as RunId) as PersistedState;
      expect(checkpoint.waitingContext?.sessionTransport).toBe('remote');
      expect(checkpoint.waitingContext?.liveSessionId).toBe('rsess-1');

      const controller2 = new LifecycleController({
        runner: makeRunner([successDispatch()]),
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContracts(),
        journalWriter: makeJournal(),
        statePersistence: persistence,
        manifestProducer: makeManifest(),
        sessionSupervisor: supervisor,
      });
      controller2.restore(makeConfig(), checkpoint);

      const result = await controller2.resume({ type: 'approval', content: 'approved' });
      expect(result.finalState).toBe('DONE');
    });

    it('dead session after restart durably persists FAILED state', async () => {
      const runner = makeRunner([sessionPermissionDispatch()]);
      const persistence = makePersistence();
      const supervisor = makeSupervisor();

      const controller1 = new LifecycleController({
        runner,
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContracts(),
        journalWriter: makeJournal(),
        statePersistence: persistence,
        manifestProducer: makeManifest(),
        sessionSupervisor: supervisor,
      });

      await controller1.start(makeConfig());
      const checkpoint = vi.mocked(persistence).load('run-001' as RunId) as PersistedState;

      const deadSupervisor = makeSupervisor({
        attach: vi.fn().mockResolvedValue(null),
      });

      const controller2 = new LifecycleController({
        runner: makeRunner([successDispatch()]),
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContracts(),
        journalWriter: makeJournal(),
        statePersistence: persistence,
        manifestProducer: makeManifest(),
        sessionSupervisor: deadSupervisor,
      });
      controller2.restore(makeConfig(), checkpoint);

      const result = await controller2.resume({ type: 'approval', content: 'approved' });
      expect(result.finalState).toBe('FAILED');

      const lastSaved = vi.mocked(persistence).save.mock.calls.at(-1)?.[0];
      expect(lastSaved?.currentState).toBe('FAILED');
      expect(lastSaved?.waitingContext).toBeUndefined();
    });
  });

  describe('failure scenarios', () => {
    it('session host dies: reaper marks as orphaned', async () => {
      const store = new DefaultAgentSessionStore('/tmp/test-reaper-e2e');
      const snapshot: AgentSessionSnapshot = {
        ref: {
          sessionId: 'sess-dead',
          runId: 'run-001',
          stateId: 'IMPL',
          role: 'implementer',
          transport: 'stdio',
        },
        state: 'awaiting_human',
        pendingRequests: [],
        lastProtocolTimestamp: '2026-01-01T00:00:00Z',
        reconnect: { type: 'stdio', pid: 99999999 },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      await store.saveSnapshot(snapshot);

      const reaper = new AgentSessionReaper(
        store,
        { retentionMs: 0, reapOrphans: true, reapTerminal: true },
        () => false,
      );
      const result = await reaper.reap('run-001');

      expect(result.orphaned).toBe(1);
      expect(result.reaped).toBe(1);

      const remaining = await store.listByRun('run-001');
      expect(remaining).toHaveLength(0);
    });

    it('expired remote session is reaped', async () => {
      const store = new DefaultAgentSessionStore('/tmp/test-reaper-e2e-remote');
      const snapshot: AgentSessionSnapshot = {
        ref: {
          sessionId: 'sess-expired',
          runId: 'run-001',
          stateId: 'IMPL',
          role: 'implementer',
          transport: 'remote',
        },
        state: 'running',
        pendingRequests: [],
        lastProtocolTimestamp: '2026-01-01T00:00:00Z',
        reconnect: {
          type: 'remote',
          remoteSessionId: 'r1',
          reconnectUrl: 'https://example.com',
          leaseExpiresAt: '2020-01-01T00:00:00Z',
        },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2020-01-01T00:00:00Z',
      };

      await store.saveSnapshot(snapshot);

      const reaper = new AgentSessionReaper(store, {
        retentionMs: 0,
        reapOrphans: true,
        reapTerminal: true,
      });
      const result = await reaper.reap('run-001');

      expect(result.reaped).toBe(1);
      const remaining = await store.listByRun('run-001');
      expect(remaining).toHaveLength(0);
    });

    it('legacy non-protocol agent completes without session involvement', async () => {
      const runner = makeRunner([legacyDispatch()]);
      const controller = new LifecycleController({
        runner,
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContracts(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      const result = await controller.start(makeConfig());
      expect(result.finalState).toBe('DONE');
    });

    it('multiple session pauses require explicit session targeting on resume', async () => {
      const runner = makeRunner([sessionPermissionDispatch(), successDispatch()]);
      const persistence = makePersistence();
      const controller = new LifecycleController({
        runner,
        artifactStore: makeStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContracts(),
        journalWriter: makeJournal(),
        statePersistence: persistence,
        manifestProducer: makeManifest(),
      });

      await controller.start(makeConfig());
      const state = controller.getState();
      expect(state.isWaitingForHuman).toBe(true);

      const checkpoint = vi.mocked(persistence).load('run-001' as RunId) as PersistedState;
      expect(checkpoint.waitingContext?.liveSessionId).toBe('sess-1');
      expect(checkpoint.waitingContext?.pendingRequestId).toBe('req-1');
    });
  });
});
