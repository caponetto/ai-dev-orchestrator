import type {
  ArtifactStore,
  GovernanceEngine,
  IterationContractRegistry,
  JournalWriter,
  ManifestProducer,
  RunnerSystem,
  StatePersistence,
} from '@ai-dev-orchestrator/ports';
import type {
  RunManifest,
  WorkflowDefinition,
  WorkflowRunConfig,
} from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../lifecycle-controller';

function makeRunner(tokenUsage?: {
  totalInputTokens: number;
  totalOutputTokens: number;
  byRole: Record<string, { inputTokens: number; outputTokens: number; durationMs: number }>;
}): RunnerSystem {
  return {
    dispatch: vi.fn().mockResolvedValue({
      workerId: 'w1',
      role: 'planner',
      status: 'success',
      outputArtifacts: [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
      metrics: {
        startedAt: '',
        completedAt: '',
        durationMs: 100,
        inputTokens: tokenUsage?.totalInputTokens ?? 0,
        outputTokens: tokenUsage?.totalOutputTokens ?? 0,
        retryCount: 0,
        modelUsed: 'test-model',
      },
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

function makeGovernance(options?: { escalateOnCall?: number }): GovernanceEngine {
  let callCount = 0;
  return {
    evaluateTransition: vi.fn().mockImplementation(() => {
      callCount += 1;
      if (options?.escalateOnCall && callCount >= options.escalateOnCall) {
        return { escalate: true, reason: 'Token budget exceeded' };
      }
      return { allowed: true, reason: 'pass' };
    }),
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

const SIMPLE_WORKFLOW: WorkflowDefinition = {
  name: 'budget-test',
  version: '1.0.0',
  initialState: 'ACTION_STATE',
  terminalStates: ['DONE'],
  states: {
    ACTION_STATE: {
      type: 'action',
      label: 'Action',
      description: 'Execute an action',
      entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
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
    DONE: {
      type: 'terminal',
      label: 'Done',
      description: 'Complete',
      transitions: [],
    },
    WAITING_FOR_HUMAN: {
      type: 'wait',
      label: 'Waiting',
      description: 'Waiting for human',
      entryActions: [{ type: 'notify_human', params: { reason: 'token_budget_exceeded' } }],
      transitions: [
        {
          target: 'ACTION_STATE',
          trigger: 'human_input' as const,
          guards: [],
          governanceRequired: false,
          priority: 1,
        },
      ],
    },
  },
};

function makeConfig(overrides: Partial<WorkflowRunConfig> = {}): WorkflowRunConfig {
  return {
    runId: 'run-001',
    workflowDefinition: SIMPLE_WORKFLOW,
    governancePolicy: {},
    roleAssignments: {},
    sources: ['test prompt'],
    ...overrides,
  };
}

describe('Budget Enforcement', () => {
  describe('pre-action budget check', () => {
    it('stops execution and enters WAITING_FOR_HUMAN when tokens exceed budget before actions', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 3000,
        totalOutputTokens: 3000,
        byRole: { planner: { inputTokens: 3000, outputTokens: 3000, durationMs: 100 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      // Budget is 5000. First action produces 6000 tokens (post-action escalation).
      // After approval, the pre-action check on the next state sees 6000 > 5000
      // and stops before dispatching.
      const result = await controller.start(
        makeConfig({ budgetMaxTokens: 5000, globalTransitionLimit: 50 }),
      );
      expect(result.finalState).toBe('WAITING_FOR_HUMAN');

      const state = controller.getState();
      expect(state.isWaitingForHuman).toBe(true);
      expect(state.waitingContext?.budgetExhaustion).toBeDefined();
      expect(state.waitingContext?.reason).toBe('token_budget_exceeded');
    });

    it('does not re-dispatch worker when resuming after post-action budget exceeded', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 3000,
        totalOutputTokens: 3000,
        byRole: { planner: { inputTokens: 3000, outputTokens: 3000, durationMs: 100 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      // First action runs (6000 tokens), post-action check fires.
      // After approval, saved action results are reused (no re-dispatch).
      await controller.start(makeConfig({ budgetMaxTokens: 5000, globalTransitionLimit: 50 }));
      const dispatchesBefore = (runner.dispatch as ReturnType<typeof vi.fn>).mock.calls.length;

      await controller.resume({ type: 'approval', content: 'continue' });
      const dispatchesAfter = (runner.dispatch as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(dispatchesAfter).toBe(dispatchesBefore);
    });
  });

  describe('budgetExhaustion context', () => {
    it('populates budgetExhaustion with correct limit and current values', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 3000,
        totalOutputTokens: 3000,
        byRole: { planner: { inputTokens: 3000, outputTokens: 3000, durationMs: 100 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      const budgetLimit = 5000;
      await controller.start(
        makeConfig({ budgetMaxTokens: budgetLimit, globalTransitionLimit: 50 }),
      );

      const state = controller.getState();
      const be = state.waitingContext?.budgetExhaustion;
      expect(be).toBeDefined();
      expect(be?.limitType).toBe('token');
      expect(be?.limit).toBe(budgetLimit);
      expect(be?.current).toBe(6000);
      expect(be?.cumulativeTokens).toBe(6000);
    });

    it('populates budgetExhaustion with accumulated tokens on post-action budget check', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 3000,
        totalOutputTokens: 3000,
        byRole: { planner: { inputTokens: 3000, outputTokens: 3000, durationMs: 100 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      const result = await controller.start(
        makeConfig({ budgetMaxTokens: 5000, globalTransitionLimit: 50 }),
      );

      expect(result.finalState).toBe('WAITING_FOR_HUMAN');
      const state = controller.getState();
      const be = state.waitingContext?.budgetExhaustion;
      expect(be).toBeDefined();
      expect(be?.limitType).toBe('token');
      expect(be?.current).toBe(6000);
      expect(be?.limit).toBe(5000);
      expect(be?.cumulativeTokens).toBe(6000);
    });
  });

  describe('unconditional budget check', () => {
    it('fires even when transitions do not have governanceRequired flag', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 8000,
        totalOutputTokens: 4000,
        byRole: { planner: { inputTokens: 8000, outputTokens: 4000, durationMs: 200 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      const result = await controller.start(
        makeConfig({ budgetMaxTokens: 10000, globalTransitionLimit: 50 }),
      );

      expect(result.finalState).toBe('WAITING_FOR_HUMAN');

      const state = controller.getState();
      expect(state.waitingContext?.reason).toBe('token_budget_exceeded');
      expect(state.waitingContext?.budgetExhaustion?.current).toBe(12000);
      expect(state.waitingContext?.budgetExhaustion?.limit).toBe(10000);
    });

    it('does not trigger when tokens are within budget', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        byRole: { planner: { inputTokens: 100, outputTokens: 50, durationMs: 10 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      const result = await controller.start(
        makeConfig({ budgetMaxTokens: 999999, globalTransitionLimit: 50 }),
      );

      expect(result.finalState).toBe('DONE');
    });

    it('emits human_input_requested journal event with token_budget_exceeded reason', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 5000,
        totalOutputTokens: 5000,
        byRole: { planner: { inputTokens: 5000, outputTokens: 5000, durationMs: 150 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const journal = makeJournal();
      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: journal,
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      await controller.start(makeConfig({ budgetMaxTokens: 8000, globalTransitionLimit: 50 }));

      const appendCalls = (journal.append as ReturnType<typeof vi.fn>).mock.calls;
      const budgetEvent = appendCalls.find(
        (c: unknown[]) =>
          (c[0] as { type: string }).type === 'human_input_requested' &&
          (c[0] as { data: { reason?: string } }).data.reason === 'token_budget_exceeded',
      );
      expect(budgetEvent).toBeDefined();
    });
  });

  describe('alert thresholds', () => {
    it('emits warn log when threshold is crossed', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 3000,
        totalOutputTokens: 3000,
        byRole: { planner: { inputTokens: 3000, outputTokens: 3000, durationMs: 100 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const warnMessages: string[] = [];
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn((msg: string) => warnMessages.push(msg)),
        error: vi.fn(),
      };

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        logger,
      });

      await controller.start(
        makeConfig({
          budgetMaxTokens: 100000,
          budgetAlertThresholds: [0.05],
          globalTransitionLimit: 50,
        }),
      );

      const thresholdWarns = warnMessages.filter((m) => m.includes('Budget alert'));
      expect(thresholdWarns).toHaveLength(1);
      expect(thresholdWarns[0]).toContain('5% threshold reached');
    });

    it('fires multiple thresholds in order', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 4000,
        totalOutputTokens: 4000,
        byRole: { planner: { inputTokens: 4000, outputTokens: 4000, durationMs: 100 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const warnMessages: string[] = [];
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn((msg: string) => warnMessages.push(msg)),
        error: vi.fn(),
      };

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        logger,
      });

      await controller.start(
        makeConfig({
          budgetMaxTokens: 100000,
          budgetAlertThresholds: [0.05, 0.07],
          globalTransitionLimit: 50,
        }),
      );

      const thresholdWarns = warnMessages.filter((m) => m.includes('Budget alert'));
      expect(thresholdWarns).toHaveLength(2);
      expect(thresholdWarns[0]).toContain('5% threshold reached');
      expect(thresholdWarns[1]).toContain('7% threshold reached');
    });

    it('does not fire duplicate warnings for already-crossed thresholds', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 500,
        totalOutputTokens: 500,
        byRole: { planner: { inputTokens: 500, outputTokens: 500, durationMs: 50 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const warnMessages: string[] = [];
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn((msg: string) => warnMessages.push(msg)),
        error: vi.fn(),
      };

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        logger,
      });

      await controller.start(
        makeConfig({
          budgetMaxTokens: 100000,
          budgetAlertThresholds: [0.5],
          globalTransitionLimit: 50,
        }),
      );

      const thresholdWarns = warnMessages.filter((m) => m.includes('Budget alert'));
      expect(thresholdWarns).toHaveLength(0);
    });

    it('does not fire when no thresholds configured', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 60000,
        totalOutputTokens: 60000,
        byRole: { planner: { inputTokens: 60000, outputTokens: 60000, durationMs: 100 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const warnMessages: string[] = [];
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn((msg: string) => warnMessages.push(msg)),
        error: vi.fn(),
      };

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
        logger,
      });

      await controller.start(
        makeConfig({
          budgetMaxTokens: 100000,
          globalTransitionLimit: 50,
        }),
      );

      const thresholdWarns = warnMessages.filter((m) => m.includes('Budget alert'));
      expect(thresholdWarns).toHaveLength(0);
    });
  });

  describe('budget escalation approval resumes interrupted state', () => {
    it('resumes with saved action results after budget approval without re-dispatching', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 3000,
        totalOutputTokens: 3000,
        byRole: { planner: { inputTokens: 3000, outputTokens: 3000, durationMs: 100 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      const result = await controller.start(
        makeConfig({ budgetMaxTokens: 5000, globalTransitionLimit: 50 }),
      );
      expect(result.finalState).toBe('WAITING_FOR_HUMAN');
      expect(controller.getState().waitingContext?.reason).toBe('token_budget_exceeded');
      expect(controller.getState().waitingContext?.requestingState).toBe('ACTION_STATE');

      const dispatchCountBeforeResume = (runner.dispatch as ReturnType<typeof vi.fn>).mock.calls
        .length;

      // After approval, saved action results are reused — no re-dispatch.
      // Budget checks are skipped for the approved iteration.
      const result2 = await controller.resume({ type: 'approval', content: 'continue' });

      const dispatchCountAfterResume = (runner.dispatch as ReturnType<typeof vi.fn>).mock.calls
        .length;
      expect(dispatchCountAfterResume).toBe(dispatchCountBeforeResume);

      // Workflow proceeds to next state using the saved results
      expect(result2.finalState).toBe('DONE');
    });

    it('journals the budget approval with human_approval event', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 3000,
        totalOutputTokens: 3000,
        byRole: { planner: { inputTokens: 3000, outputTokens: 3000, durationMs: 100 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const journal = makeJournal();
      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: journal,
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      await controller.start(makeConfig({ budgetMaxTokens: 5000, globalTransitionLimit: 50 }));
      await controller.resume({ type: 'approval', content: 'continue' });

      const appendCalls = (journal.append as ReturnType<typeof vi.fn>).mock.calls;
      const approvalEvent = appendCalls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'human_approval',
      );
      expect(approvalEvent).toBeDefined();
    });
  });

  describe('pre-action budget check skips wait states', () => {
    it('does not escalate when entering a wait state even if budget exceeded', async () => {
      const governance = makeGovernance();
      const usagePerCall = {
        totalInputTokens: 3000,
        totalOutputTokens: 3000,
        byRole: { planner: { inputTokens: 3000, outputTokens: 3000, durationMs: 100 } },
      };
      const runner = makeRunner(usagePerCall);

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: JSON.stringify({ approved: true }),
      });

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      // Budget 5000, action produces 6000 tokens. Post-action check sends us to
      // WAITING_FOR_HUMAN (a wait state). The pre-action check must NOT fire for
      // WAITING_FOR_HUMAN, otherwise we'd loop endlessly.
      const result = await controller.start(
        makeConfig({ budgetMaxTokens: 5000, globalTransitionLimit: 50 }),
      );
      expect(result.finalState).toBe('WAITING_FOR_HUMAN');

      // Only one dispatch — the action ran and was not blocked by pre-action on wait
      expect((runner.dispatch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });
  });

  describe('post-transition governance escalation with budget', () => {
    it('populates budgetExhaustion when governance escalates on a governanceRequired transition and budget is exceeded', async () => {
      const runner: RunnerSystem = {
        dispatch: vi.fn().mockResolvedValue({
          workerId: 'w1',
          role: 'reviewer',
          status: 'success',
          outputArtifacts: [
            { type: 'plan_review', name: 'plan_review', version: 1, checksum: 'abc' },
          ],
          metrics: {
            startedAt: '',
            completedAt: '',
            durationMs: 200,
            inputTokens: 6000,
            outputTokens: 6000,
            retryCount: 0,
            modelUsed: 'test-model',
          },
        }),
        dispatchParallel: vi.fn().mockResolvedValue([]),
        getWorkerStatus: vi.fn().mockReturnValue(null),
        cancelWorker: vi.fn(),
        cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
        setWorkerCounter: vi.fn(),
      };

      let governanceCallCount = 0;
      const governance: GovernanceEngine = {
        evaluateTransition: vi.fn().mockImplementation(() => {
          governanceCallCount += 1;
          if (governanceCallCount >= 2) {
            return { escalate: true, reason: 'Token budget exceeded' };
          }
          return { allowed: true, reason: 'pass' };
        }),
        checkAgreement: vi.fn().mockReturnValue({ exists: false, valid: false }),
        recordDecision: vi.fn(),
      };

      const store = makeStore();
      store.getLatest = vi.fn().mockResolvedValue({
        type: 'plan_review',
        name: 'plan_review',
        version: 1,
        checksum: 'abc',
        content: '---\napproved: true\nfindings: []\n---\nApproved.',
      });

      const REVIEW_WORKFLOW: WorkflowDefinition = {
        name: 'review-budget-test',
        version: '1.0.0',
        initialState: 'REVIEW',
        terminalStates: ['DONE'],
        states: {
          REVIEW: {
            type: 'review' as const,
            label: 'Review',
            description: 'Review state',
            entryActions: [{ type: 'dispatch_worker', params: { role: 'reviewer' } }],
            transitions: [
              {
                target: 'DONE',
                trigger: 'review_approved' as const,
                guards: [],
                governanceRequired: true,
                priority: 1,
              },
            ],
          },
          DONE: {
            type: 'terminal',
            label: 'Done',
            description: 'Complete',
            transitions: [],
          },
          WAITING_FOR_HUMAN: {
            type: 'wait',
            label: 'Waiting',
            description: 'Waiting for human',
            entryActions: [{ type: 'notify_human', params: { reason: 'token_budget_exceeded' } }],
            transitions: [
              {
                target: 'REVIEW',
                trigger: 'human_input' as const,
                guards: [],
                governanceRequired: false,
                priority: 1,
              },
            ],
          },
        },
      };

      const controller = new LifecycleController({
        runner,
        artifactStore: store,
        governanceEngine: governance,
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: makePersistence(),
        manifestProducer: makeManifest(),
      });

      const result = await controller.start({
        runId: 'run-001',
        workflowDefinition: REVIEW_WORKFLOW,
        governancePolicy: {},
        roleAssignments: {},
        sources: ['test prompt'],
        budgetMaxTokens: 10000,
        globalTransitionLimit: 50,
      });

      expect(result.finalState).toBe('WAITING_FOR_HUMAN');

      const state = controller.getState();
      expect(state.waitingContext?.reason).toBe('token_budget_exceeded');
      expect(state.waitingContext?.budgetExhaustion).toBeDefined();
      expect(state.waitingContext?.budgetExhaustion?.limitType).toBe('token');
      expect(state.waitingContext?.budgetExhaustion?.current).toBe(12000);
      expect(state.waitingContext?.budgetExhaustion?.limit).toBe(10000);
      expect(state.waitingContext?.budgetExhaustion?.cumulativeTokens).toBe(12000);
    });
  });
});
