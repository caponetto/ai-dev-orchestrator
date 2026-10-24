/* eslint-disable @typescript-eslint/unbound-method -- Assertions inspect Vitest mock methods without invoking them. */
import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultIterationContractRegistry } from '@ai-dev-orchestrator/governance';
import type { AgentSessionSupervisor } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import { DefaultRoleRegistry } from '@ai-dev-orchestrator/role-system';
import type {
  AgentSessionHandle,
  AgentSessionRef,
  ArtifactRef,
  ArtifactType,
  DispatchResult,
  RoleId,
  TransitionEscalated,
  WorkflowDefinition,
  WorkflowRunConfig,
} from '@ai-dev-orchestrator/schemas';
import {
  createArtifactRef,
  createMockArtifactStore,
  createMockGovernance,
  createMockJournalWriter,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
  TEST_ROLES,
} from '@ai-dev-orchestrator/test-utils';
import { assert, describe, expect, it, vi } from 'vitest';

import { TransitionError } from '../../../domain/workflow-engine/errors';
import { LifecycleController } from '../lifecycle-controller';
import { ScriptExecutor } from '../script-executor';

function createFixture() {
  const artifactStore = createMockArtifactStore();
  const runner = createMockRunnerSystem({ artifactStore });
  const governanceEngine = createMockGovernance();
  const statePersistence = createMockStatePersistence();
  const roleRegistry = new DefaultRoleRegistry(TEST_ROLES, {
    assignments: {},
    defaultAssignment: { model: 'small' },
    tierConfig: {
      tiers: [
        { model: 'small', tier: 1 },
        { model: 'medium', tier: 2 },
        { model: 'large', tier: 3 },
      ],
    },
  });
  return {
    artifactStore,
    runner,
    governanceEngine,
    statePersistence,
    roleRegistry,
    contractRegistry: new DefaultIterationContractRegistry(),
    journalWriter: createMockJournalWriter(),
    manifestProducer: createMockManifestProducer(),
  };
}

function workflow(): WorkflowDefinition {
  return {
    name: 'regression',
    version: '1',
    initialState: 'WORK',
    terminalStates: ['DONE', 'FAILED'],
    states: {
      WORK: {
        type: 'action',
        description: '',
        entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
        exitActions: [{ type: 'record_journal', params: { event: 'run_resumed' } }],
        transitions: [
          {
            target: 'DONE',
            trigger: 'completion',
            guards: [],
            priority: 1,
            governanceRequired: true,
          },
          {
            target: 'FAILED',
            trigger: 'failure',
            guards: [],
            priority: 2,
            governanceRequired: false,
          },
        ],
      },
      WAITING_FOR_HUMAN: {
        type: 'wait',
        description: '',
        transitions: [
          {
            target: 'DONE',
            trigger: 'human_approved',
            guards: [],
            priority: 1,
            governanceRequired: true,
          },
        ],
      },
      DONE: { type: 'terminal', description: '', transitions: [] },
      FAILED: { type: 'terminal', description: '', transitions: [] },
    },
  };
}

function config(definition = workflow()): WorkflowRunConfig {
  return {
    runId: 'regression',
    workflowDefinition: definition,
    governancePolicy: {},
    roleAssignments: {},
    sources: [],
  };
}

function escalation(): TransitionEscalated {
  return {
    escalate: true,
    reason: 'Requires human review',
    context: {
      runId: 'regression',
      stageId: 'WORK',
      reason: 'quality_gate_failed',
      iterationHistory: [],
      unresolvedFindings: [],
      artifactRefs: [],
      suggestedActions: [],
    },
  };
}

function workerResult(role: RoleId, type?: ArtifactType): DispatchResult {
  return {
    workerId: 'worker',
    role,
    status: 'success',
    outputArtifacts: type ? [createArtifactRef(type)] : [],
    metrics: {
      startedAt: '',
      completedAt: '',
      durationMs: 5,
      inputTokens: 10,
      outputTokens: 5,
      retryCount: 0,
      modelUsed: 'small',
    },
  };
}

describe('LifecycleController escalation regressions', () => {
  it.each([
    { source: null, message: 'no previous workflow state' },
    { source: 'MISSING', message: 'no previous workflow state' },
    { source: 'DONE', message: 'terminal state' },
    { source: 'WAITING_FOR_HUMAN', message: 'without human input' },
  ])(
    'rejects an unsafe retry target $source without taking a lock',
    async ({ source, message }) => {
      const f = createFixture();
      const c = config();
      vi.mocked(f.runner).dispatch.mockResolvedValue({
        ...workerResult('planner'),
        status: 'failure',
      });
      await new LifecycleController(f).start(c);
      const checkpoint = f.statePersistence.load(createRunId(c.runId));
      assert(checkpoint);
      const restored = new LifecycleController(f);
      restored.restore(c, { ...checkpoint, previousState: source });
      vi.mocked(f.statePersistence).acquireLock.mockClear();

      await expect(restored.retry()).rejects.toThrow(message);
      expect(f.statePersistence.acquireLock).not.toHaveBeenCalled();
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
    },
  );

  it('does not run retry actions if checkpointing the selected source fails', async () => {
    const f = createFixture();
    const c = config();
    vi.mocked(f.runner).dispatch.mockResolvedValue({
      ...workerResult('planner'),
      status: 'failure',
    });
    await new LifecycleController(f).start(c);
    const checkpoint = f.statePersistence.load(createRunId(c.runId));
    assert(checkpoint);
    const restored = new LifecycleController(f);
    restored.restore(c, checkpoint);
    vi.mocked(f.statePersistence).save.mockRejectedValueOnce(new Error('cannot checkpoint retry'));

    await expect(restored.retry()).rejects.toThrow('cannot checkpoint retry');
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
    expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(2);
    expect(f.statePersistence.load(createRunId(c.runId))).toEqual(checkpoint);
  });

  it.each(['FAILED', 'ABORTED'])(
    'retries a restored %s run without an external checkpoint rewrite',
    async (terminal) => {
      const f = createFixture();
      const c = config();
      c.workflowDefinition.terminalStates = ['DONE', terminal];
      c.workflowDefinition.states[terminal] = {
        type: 'terminal',
        description: '',
        transitions: [],
      };
      c.workflowDefinition.states['WORK'].transitions[1].target = terminal;
      vi.mocked(f.runner)
        .dispatch.mockResolvedValueOnce({ ...workerResult('planner'), status: 'failure' })
        .mockResolvedValue(workerResult('planner'));
      expect((await new LifecycleController(f).start(c)).finalState).toBe(terminal);
      const checkpoint = f.statePersistence.load(createRunId(c.runId));
      assert(checkpoint);
      const restored = new LifecycleController(f);
      restored.restore(c, checkpoint);

      expect((await restored.retry()).finalState).toBe('DONE');

      const retried = f.statePersistence.load(createRunId(c.runId));
      expect(retried?.stateHistory).toEqual(['WORK', terminal, 'WORK', 'DONE']);
      expect(retried?.cumulativeInputTokens).toBe(20);
      expect(retried?.cumulativeOutputTokens).toBe(10);
      expect(f.runner.dispatch).toHaveBeenCalledTimes(2);
      expect(f.statePersistence.acquireLock).toHaveBeenCalledTimes(2);
      expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(2);
    },
  );

  it('does not rewind a failed run when retry cannot acquire its lock', async () => {
    const f = createFixture();
    const c = config();
    vi.mocked(f.runner).dispatch.mockResolvedValue({
      ...workerResult('planner'),
      status: 'failure',
    });
    await new LifecycleController(f).start(c);
    const checkpoint = f.statePersistence.load(createRunId(c.runId));
    assert(checkpoint);
    const restored = new LifecycleController(f);
    restored.restore(c, checkpoint);
    vi.mocked(f.statePersistence).acquireLock.mockImplementationOnce(() => {
      throw new Error('Run is already active');
    });

    await expect(restored.retry()).rejects.toThrow('already active');
    expect(restored.getState().currentState).toBe('FAILED');
    expect(f.statePersistence.load(createRunId(c.runId))).toEqual(checkpoint);
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
  });

  it('preserves an abort requested while exit actions are pending', async () => {
    const f = createFixture();
    vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('planner'));
    let completeExit: ((ref: ArtifactRef) => void) | undefined;
    const exitStarted = new Promise<void>((resolve) => {
      vi.mocked(f.artifactStore).store.mockImplementation(
        () =>
          new Promise<ArtifactRef>((complete) => {
            completeExit = complete;
            resolve();
          }),
      );
    });
    const c = config();
    c.workflowDefinition.terminalStates = ['DONE', 'FAILED', 'ABORTED'];
    c.workflowDefinition.states['ABORTED'] = { type: 'terminal', description: '', transitions: [] };
    c.workflowDefinition.states['WORK'].exitActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'exit', content: '{}' } },
    ];
    const controller = new LifecycleController(f);
    const running = controller.start(c);
    await exitStarted;
    await controller.abort('cancelled during exit');
    assert(completeExit);
    completeExit(createArtifactRef('plan'));
    expect((await running).finalState).toBe('ABORTED');
    expect(f.statePersistence.load(createRunId('regression'))?.currentState).toBe('ABORTED');
  });

  it('evaluates the escalated result, accounts for usage once, and runs exit actions once', async () => {
    const f = createFixture();
    vi.mocked(f.governanceEngine)
      .evaluateTransition.mockReturnValueOnce(escalation())
      .mockReturnValue({ allowed: true, reason: 'pass' });
    const result = await new LifecycleController(f).start(config());
    expect(result.finalState).toBe('DONE');
    expect(vi.mocked(f.runner).dispatch.mock.calls.map(([r]) => r.overrides?.model?.model)).toEqual(
      [undefined, 'medium'],
    );
    expect(
      vi.mocked(f.journalWriter).append.mock.calls.filter(([e]) => e.type === 'run_resumed'),
    ).toHaveLength(1);
    const checkpoint = f.statePersistence.load(createRunId('regression'));
    assert(checkpoint);
    expect(checkpoint.cumulativeInputTokens).toBe(200);
    expect(checkpoint.cumulativeOutputTokens).toBe(100);
  });

  it('stops at the top tier and releases the lock for another controller to resume', async () => {
    const f = createFixture();
    vi.mocked(f.governanceEngine).evaluateTransition.mockReturnValue(escalation());
    const result = await new LifecycleController(f).start(config());
    expect(result.finalState).toBe('WAITING_FOR_HUMAN');
    expect(vi.mocked(f.runner).dispatch.mock.calls.map(([r]) => r.overrides?.model?.model)).toEqual(
      [undefined, 'medium', 'large'],
    );
    expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(f.journalWriter).append.mock.calls.some(([e]) => e.type === 'run_resumed'),
    ).toBe(false);

    vi.mocked(f.governanceEngine).evaluateTransition.mockReturnValue({
      allowed: true,
      reason: 'pass',
    });
    const checkpoint = f.statePersistence.load(createRunId('regression'));
    assert(checkpoint);
    expect(checkpoint).not.toBeNull();
    const restored = new LifecycleController(f);
    restored.restore(config(), checkpoint);
    expect((await restored.resume({ type: 'approval', content: 'approved' })).finalState).toBe(
      'DONE',
    );
    expect(vi.mocked(f.statePersistence).acquireLock).toHaveBeenCalledTimes(2);
  });

  it('does not loop when a registry keeps returning the same escalation model', async () => {
    const f = createFixture();
    vi.spyOn(f.roleRegistry, 'getNextTier').mockReturnValue({ roleId: 'planner', model: 'medium' });
    vi.mocked(f.governanceEngine).evaluateTransition.mockReturnValue(escalation());
    expect((await new LifecycleController(f).start(config())).finalState).toBe('WAITING_FOR_HUMAN');
    expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(2);
  });

  it('honors a failure from the stronger model instead of rerunning the original worker', async () => {
    const f = createFixture();
    const result = workerResult('planner');
    vi.mocked(f.runner)
      .dispatch.mockResolvedValueOnce(result)
      .mockResolvedValue({
        ...result,
        status: 'failure',
        error: { type: 'agent_error', message: 'offline', retryable: false },
      });
    vi.mocked(f.governanceEngine).evaluateTransition.mockReturnValueOnce(escalation());
    expect((await new LifecycleController(f).start(config())).finalState).toBe('FAILED');
    expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(2);
  });

  it('preserves the escalated result when its usage crosses the budget', async () => {
    const f = createFixture();
    vi.mocked(f.governanceEngine)
      .evaluateTransition.mockReturnValueOnce(escalation())
      .mockReturnValue({ allowed: true, reason: 'pass' });
    const controller = new LifecycleController(f);
    expect((await controller.start({ ...config(), budgetMaxTokens: 200 })).finalState).toBe(
      'WAITING_FOR_HUMAN',
    );
    const checkpoint = f.statePersistence.load(createRunId('regression'));
    assert(checkpoint);
    expect(checkpoint.interruptedActionResults?.[0].success).toBe(true);
    expect((await controller.resume({ type: 'approval', content: 'continue' })).finalState).toBe(
      'DONE',
    );
    expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(2);
    expect(f.statePersistence.load(createRunId('regression'))?.cumulativeInputTokens).toBe(200);
  });

  it('keeps a governance-escalated resume waiting and preserves routing across restore', async () => {
    const f = createFixture();
    const c = config();
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].transitions[0].guards = [
      { type: 'waiting_context_matches', params: { requestingState: 'WORK' } },
    ];
    vi.mocked(f.governanceEngine).evaluateTransition.mockReturnValue(escalation());
    const controller = new LifecycleController({ ...f, roleRegistry: undefined });
    await controller.start(c);
    expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
      'WAITING_FOR_HUMAN',
    );
    expect(
      vi
        .mocked(f.journalWriter.append)
        .mock.calls.some(([e]) => e.type === 'state_transition' && e.data.to === 'DONE'),
    ).toBe(false);
    const checkpoint = f.statePersistence.load(createRunId('regression'));
    assert(checkpoint);
    expect(checkpoint.waitingContext?.requestingState).toBe('WORK');
    expect(checkpoint.waitingContext?.reason).toBe('governance_escalation');
    expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(2);
    vi.mocked(f.governanceEngine).evaluateTransition.mockReturnValue({
      allowed: true,
      reason: 'pass',
    });
    const restored = new LifecycleController(f);
    restored.restore(c, checkpoint);
    expect((await restored.resume({ type: 'approval', content: 'yes' })).finalState).toBe('DONE');
  });

  it('checkpoints and releases the lock when no completion guard matches, allowing retry', async () => {
    const f = createFixture();
    const c = config();
    c.workflowDefinition.terminalStates = ['DONE'];
    c.workflowDefinition.states['WORK'].transitions[0].guards = [
      { type: 'artifact_exists', params: { artifactType: 'verification' } },
    ];
    await expect(new LifecycleController(f).start(c)).rejects.toThrow(TransitionError);
    const checkpoint = f.statePersistence.load(createRunId('regression'));
    assert(checkpoint);
    expect(checkpoint.currentState).toBe('WORK');
    expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(1);
    await f.artifactStore.store({
      type: 'verification',
      name: 'verification',
      content: '{}',
      producedBy: 'verifier',
    });
    const restored = new LifecycleController(f);
    restored.restore(c, checkpoint);
    expect((await restored.retry()).finalState).toBe('DONE');
  });

  it('finishes in FAILED when no transition matches and the workflow declares that terminal', async () => {
    const f = createFixture();
    const c = config();
    c.workflowDefinition.states['WORK'].transitions[0].guards = [
      { type: 'artifact_exists', params: { artifactType: 'verification' } },
    ];
    expect((await new LifecycleController(f).start(c)).finalState).toBe('FAILED');
    expect(f.statePersistence.load(createRunId('regression'))?.currentState).toBe('FAILED');
    expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(f.journalWriter)
        .append.mock.calls.some(
          ([e]) => e.type === 'error' && e.data.errorCode === 'no_matching_transition',
        ),
    ).toBe(true);
  });

  it("uses ABORTED when it is the workflow's only failure terminal", async () => {
    const f = createFixture();
    const c = config();
    c.workflowDefinition.terminalStates = ['DONE', 'ABORTED'];
    c.workflowDefinition.states['ABORTED'] = { type: 'terminal', description: '', transitions: [] };
    c.workflowDefinition.states['WORK'].transitions[0].guards = [
      { type: 'artifact_exists', params: { artifactType: 'verification' } },
    ];
    expect((await new LifecycleController(f).start(c)).finalState).toBe('ABORTED');
    expect(f.statePersistence.load(createRunId('regression'))?.currentState).toBe('ABORTED');
    expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(1);
  });
});

describe('LifecycleController session output regressions', () => {
  function sessionFixture(role: RoleId) {
    const f = createFixture();
    const ref: AgentSessionRef = {
      sessionId: 'session',
      runId: 'regression',
      stateId: 'WORK',
      role,
      transport: 'remote',
    };
    vi.mocked(f.runner).dispatch.mockResolvedValue({
      ...workerResult(role),
      sessionOutcome: 'awaiting_human',
      sessionRef: ref,
      pendingRequest: {
        requestId: 'request',
        kind: 'permission',
        createdAt: '',
        payload: { action: 'read' },
      },
    });
    const supervisor: AgentSessionSupervisor = {
      createSession: vi.fn(),
      attach: vi.fn().mockResolvedValue({ ref, state: 'awaiting_human', pendingRequests: [] }),
      sendHumanResponse: vi.fn().mockResolvedValue(true),
      waitForAdvance: vi.fn().mockResolvedValue({
        kind: 'completed',
        artifactContent: JSON.stringify({ approved: true }),
        durationMs: 12,
        tokenUsage: { inputTokens: 30, outputTokens: 20 },
      }),
      pause: vi.fn(),
      abort: vi.fn(),
      finalize: vi.fn(),
      getSnapshot: vi.fn(),
      getState: vi.fn(),
      listByRun: vi.fn(),
    };
    return { ...f, sessionSupervisor: supervisor };
  }

  it.each([
    ['planner', 'plan'],
    ['plan_reviewer', 'plan_review'],
    ['implementer', 'implementation'],
  ] as const)(
    'stores %s output using its role contract across checkpoint restore',
    async (role, type) => {
      const f = sessionFixture(role);
      const c = config();
      c.workflowDefinition.states['WORK'].entryActions = [
        { type: 'dispatch_worker', params: { role } },
      ];
      c.workflowDefinition.states['WORK'].transitions[0].guards = [
        { type: 'artifact_exists', params: { artifactType: type } },
      ];
      await new LifecycleController(f).start(c);
      const restored = new LifecycleController(f);
      const checkpoint = f.statePersistence.load(createRunId('regression'));
      assert(checkpoint);
      restored.restore(c, checkpoint);
      const result = await restored.resume({ type: 'approval', content: 'yes' });
      expect(result.finalState).toBe('DONE');
      expect(vi.mocked(f.artifactStore).store).toHaveBeenCalledWith(
        expect.objectContaining({
          type,
          name: `${role}-output`,
          producedBy: role,
        }),
      );
      expect(f.statePersistence.load(createRunId('regression'))?.cumulativeInputTokens).toBe(40);
      expect(f.statePersistence.load(createRunId('regression'))?.cumulativeOutputTokens).toBe(25);
      expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['store_failure', 'missing_contract', 'missing_output'] as const)(
    'fails a completed session on %s',
    async (failure) => {
      const f = sessionFixture('planner');
      if (failure === 'store_failure') {
        vi.mocked(f.artifactStore).store.mockRejectedValue(new Error('disk full'));
      }
      if (failure === 'missing_contract') {
        vi.spyOn(f.roleRegistry, 'getRole').mockReturnValue(null);
      }
      if (failure === 'missing_output') {
        vi.mocked(f.sessionSupervisor).waitForAdvance.mockResolvedValue({
          kind: 'completed',
          durationMs: 0,
        });
      }
      const controller = new LifecycleController(f);
      await controller.start(config());
      expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
        'FAILED',
      );
      expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(2);
      expect(
        vi
          .mocked(f.journalWriter)
          .append.mock.calls.some(([event]) => event.type === 'worker_failed'),
      ).toBe(true);
    },
  );
});

describe('LifecycleController recovery and failure regressions', () => {
  it.each(['no_match', 'escalation', 'allowed'] as const)(
    'preserves abort during %s guard evaluation',
    async (outcome) => {
      const f = createFixture();
      let finishGuard:
        ((value: Awaited<ReturnType<typeof f.artifactStore.getLatest>>) => void) | undefined;
      const started = new Promise<void>((resolve) => {
        vi.mocked(f.artifactStore).getLatest.mockImplementation(
          () =>
            new Promise((finish) => {
              finishGuard = finish;
              resolve();
            }),
        );
      });
      vi.mocked(f.artifactStore).list.mockResolvedValue([]);
      if (outcome === 'escalation') {
        vi.mocked(f.governanceEngine).evaluateTransition.mockReturnValue(escalation());
      }
      const c = config();
      c.workflowDefinition.terminalStates = [...c.workflowDefinition.terminalStates, 'ABORTED'];
      c.workflowDefinition.states['ABORTED'] = {
        type: 'terminal',
        description: '',
        transitions: [],
      };
      c.workflowDefinition.states['WORK'].transitions[0].guards = [
        { type: 'artifact_exists', params: { artifactType: 'verification' } },
      ];
      const controller = new LifecycleController({ ...f, roleRegistry: undefined });
      const running = controller.start(c);
      await started;
      await controller.abort('cancel during guard');
      assert(finishGuard);
      finishGuard(
        outcome === 'no_match'
          ? null
          : {
              ref: createArtifactRef('verification'),
              type: 'verification',
              name: 'verification',
              version: 1,
              content: '{}',
              checksum: 'abc',
              producedBy: 'verifier',
              createdAt: '',
              sizeBytes: 2,
            },
      );
      expect((await running).finalState).toBe('ABORTED');
      expect(f.statePersistence.load(createRunId(c.runId))?.currentState).toBe('ABORTED');
      expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['exit', 'terminal'] as const)(
    'fails the run when a required %s action fails',
    async (placement) => {
      const f = createFixture();
      vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('planner'));
      vi.mocked(f.artifactStore).store.mockRejectedValue(new Error('disk full'));
      const c = config();
      const actions = [
        {
          type: 'store_artifact' as const,
          params: { type: 'plan' as const, name: 'required', content: '{}' },
        },
      ];
      if (placement === 'exit') {
        c.workflowDefinition.states['WORK'].exitActions = actions;
      } else {
        c.workflowDefinition.states['DONE'].entryActions = actions;
      }
      const result = await new LifecycleController(f).start(c);
      expect(result.finalState).toBe('FAILED');
      expect(f.statePersistence.load(createRunId(c.runId))?.currentState).toBe('FAILED');
      expect(
        vi
          .mocked(f.journalWriter)
          .append.mock.calls.some(
            ([event]) =>
              event.type === 'error' && event.data.errorCode === `${placement}_action_failed`,
          ),
      ).toBe(true);
      expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds failing terminal cleanup and releases the lock when no failure terminal succeeds', async () => {
    const f = createFixture();
    vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('planner'));
    vi.mocked(f.artifactStore).store.mockRejectedValue(new Error('disk full'));
    const c = config();
    c.workflowDefinition.terminalStates = [...c.workflowDefinition.terminalStates, 'ABORTED'];
    c.workflowDefinition.states['ABORTED'] = { type: 'terminal', description: '', transitions: [] };
    for (const state of c.workflowDefinition.terminalStates) {
      c.workflowDefinition.states[state].entryActions = [
        { type: 'store_artifact', params: { type: 'plan', content: '{}' } },
      ];
    }
    await expect(new LifecycleController(f).start(c)).rejects.toThrow('disk full');
    expect(vi.mocked(f.artifactStore).store).toHaveBeenCalledTimes(3);
    expect(f.statePersistence.load(createRunId(c.runId))?.currentState).toBe('WORK');
    expect(f.statePersistence.load(createRunId(c.runId))?.pendingTerminalState).toBe('ABORTED');
    expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(1);
  });

  it.each(['pr-review', 'task-breakdown'])(
    'aborts %s on budget rejection without a declared wait state',
    async (name) => {
      const f = createFixture();
      const c = config();
      c.workflowDefinition.name = name;
      c.workflowDefinition.terminalStates = [...c.workflowDefinition.terminalStates, 'ABORTED'];
      c.workflowDefinition.states['ABORTED'] = {
        type: 'terminal',
        description: '',
        transitions: [],
      };
      delete c.workflowDefinition.states['WAITING_FOR_HUMAN'];
      const controller = new LifecycleController(f);
      await controller.start({ ...c, budgetMaxTokens: 1 });
      const restored = new LifecycleController(f);
      const checkpoint = f.statePersistence.load(createRunId(c.runId));
      assert(checkpoint);
      restored.restore({ ...c, budgetMaxTokens: 1 }, checkpoint);
      expect((await restored.resume({ type: 'rejection', content: 'stop' })).finalState).toBe(
        'ABORTED',
      );
      expect(f.statePersistence.load(createRunId(c.runId))?.waitingContext).toBeUndefined();
      expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(2);
    },
  );

  it('persists rejection feedback before entering the next worker and preserves it on retry', async () => {
    const f = createFixture();
    const content = JSON.stringify({
      approved: false,
      findings: [{ description: 'Fix transaction handling' }],
    });
    await f.artifactStore.store({
      type: 'plan_review',
      name: 'review',
      content,
      producedBy: 'plan_reviewer',
    });
    vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('plan_reviewer', 'plan_review'));
    const c = config();
    c.workflowDefinition.states['WORK'].type = 'review';
    c.workflowDefinition.states['WORK'].entryActions = [
      { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
    ];
    c.workflowDefinition.states['WORK'].transitions[0] = {
      target: 'REWORK',
      trigger: 'review_rejected',
      guards: [],
      priority: 0,
      governanceRequired: false,
    };
    c.workflowDefinition.states['REWORK'] = {
      type: 'action',
      description: '',
      entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
      transitions: [
        {
          target: 'DONE',
          trigger: 'completion',
          guards: [],
          priority: 0,
          governanceRequired: false,
        },
      ],
    };
    let reworkCheckpoint: ReturnType<typeof f.statePersistence.load>;
    const save = vi.mocked(f.statePersistence).save.getMockImplementation();
    assert(save);
    vi.mocked(f.statePersistence).save.mockImplementation(async (state) => {
      await save(state);
      if (state.currentState === 'REWORK') {
        reworkCheckpoint = structuredClone(state);
      }
    });
    await new LifecycleController(f).start(c);
    assert(reworkCheckpoint);
    expect(reworkCheckpoint.lastReviewContent).toBe(content);
    expect(reworkCheckpoint.lastTrigger).toBe('review_rejected');
    const restored = new LifecycleController(f);
    restored.restore(c, reworkCheckpoint);
    await restored.retry();
    expect(vi.mocked(f.runner).dispatch.mock.calls.at(-1)?.[0].previousReviewContent).toBe(content);
  });
});

describe('LifecycleController resumable entry actions', () => {
  function sessionFixture() {
    const f = createFixture();
    const ref: AgentSessionRef = {
      sessionId: 'session',
      runId: 'regression',
      stateId: 'WORK',
      role: 'plan_reviewer',
      transport: 'remote',
    };
    vi.mocked(f.runner).dispatch.mockResolvedValue({
      ...workerResult('plan_reviewer'),
      sessionOutcome: 'awaiting_human',
      sessionRef: ref,
      pendingRequest: {
        requestId: 'request',
        kind: 'permission',
        createdAt: '',
        payload: { action: 'read' },
      },
    });
    const sessionSupervisor: AgentSessionSupervisor = {
      createSession: vi.fn(),
      attach: vi.fn().mockResolvedValue({ ref, state: 'awaiting_human', pendingRequests: [] }),
      sendHumanResponse: vi.fn().mockResolvedValue(true),
      waitForAdvance: vi.fn().mockResolvedValue({
        kind: 'completed',
        artifactContent: JSON.stringify({ approved: true }),
        durationMs: 1,
        tokenUsage: { inputTokens: 30, outputTokens: 20 },
      }),
      pause: vi.fn(),
      abort: vi.fn(),
      finalize: vi.fn(),
      getSnapshot: vi.fn(),
      getState: vi.fn(),
      listByRun: vi.fn(),
    };
    const c = config();
    c.workflowDefinition.states['WORK'].type = 'review';
    c.workflowDefinition.states['WORK'].entryActions = [
      { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
      { type: 'generate_agreement', params: { type: 'planning_agreement' } },
    ];
    c.workflowDefinition.states['WORK'].transitions[0].trigger = 'review_approved';
    return { ...f, sessionSupervisor, c, ref };
  }

  it.each(['wait', 'terminal'] as const)(
    'reattaches an awaiting-human session in a %s state and resumes its remaining actions',
    async (phase) => {
      const f = sessionFixture();
      const c = f.c;
      c.workflowDefinition.states['WORK'].type = 'action';
      c.workflowDefinition.states['WORK'].entryActions = [];
      c.workflowDefinition.states['WORK'].exitActions = [];
      c.workflowDefinition.states['WORK'].transitions[0].trigger = 'completion';
      c.workflowDefinition.states['WORK'].transitions[0].target =
        phase === 'wait' ? 'WAITING_FOR_HUMAN' : 'DONE';
      c.workflowDefinition.states[phase === 'wait' ? 'WAITING_FOR_HUMAN' : 'DONE'].entryActions = [
        { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
        { type: 'store_artifact', params: { type: 'plan', name: 'after', content: '{}' } },
      ];
      const controller = new LifecycleController(f);
      expect((await controller.start(c)).finalState).toBe('WAITING_FOR_HUMAN');
      const saved = f.statePersistence.load(createRunId(c.runId));
      assert(saved);
      expect(saved.waitingContext?.liveSessionId).toBe('session');
      expect(saved.waitingContext?.pendingRequestId).toBe('request');
      expect(saved.entryActionContinuation?.nextActionIndex).toBe(1);
      const restored = new LifecycleController(f);
      restored.restore(c, saved);
      const result = await restored.resume({ type: 'approval', content: 'yes' });
      if (phase === 'wait') {
        expect(result.finalState).toBe('WAITING_FOR_HUMAN');
        expect(restored.getState().waitingContext?.reason).toBe('waiting_for_human');
        expect(restored.getState().waitingContext?.requestingState).toBe('WORK');
        expect(
          (await restored.resume({ type: 'approval', content: 'approve workflow' })).finalState,
        ).toBe('DONE');
      } else {
        expect(result.finalState).toBe('DONE');
      }
      expect(f.sessionSupervisor.attach).toHaveBeenCalledTimes(1);
      expect(f.sessionSupervisor.sendHumanResponse).toHaveBeenCalledWith('session', 'request', {
        granted: true,
        reason: 'yes',
      });
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
        'plan_reviewer-output',
        'after',
      ]);
    },
  );

  it('preserves the original gate requester across a manual pause in resumed wait actions', async () => {
    const f = sessionFixture();
    const c = f.c;
    c.workflowDefinition.states['WORK'].type = 'action';
    c.workflowDefinition.states['WORK'].entryActions = [];
    c.workflowDefinition.states['WORK'].exitActions = [];
    c.workflowDefinition.states['WORK'].transitions[0].trigger = 'completion';
    c.workflowDefinition.states['WORK'].transitions[0].target = 'WAITING_FOR_HUMAN';
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].entryActions = [
      { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
      { type: 'store_artifact', params: { type: 'plan', name: 'after', content: '{}' } },
    ];
    const controller = new LifecycleController(f);
    await controller.start(c);
    let finish!: (ref: ArtifactRef) => void;
    let signal!: () => void;
    const started = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const original = vi.mocked(f.artifactStore).store.getMockImplementation();
    assert(original);
    vi.mocked(f.artifactStore).store.mockImplementation((request) => {
      if (request.name !== 'after') {
        return original(request);
      }
      return new Promise<ArtifactRef>((resolve) => {
        finish = resolve;
        signal();
      });
    });
    const resuming = controller.resume({ type: 'approval', content: 'yes' });
    await started;
    await controller.pause({
      reason: 'manual',
      requiredInput: 'approval',
      requestingState: 'WAITING_FOR_HUMAN',
      autoResumeSafe: true,
      presentedArtifacts: [],
      waitingSince: new Date().toISOString(),
    });
    finish(createArtifactRef('plan'));
    await resuming;
    const saved = f.statePersistence.load(createRunId(c.runId));
    assert(saved);
    const restored = new LifecycleController(f);
    restored.restore(c, saved);
    await restored.resume({ type: 'approval', content: 'continue' });
    expect(restored.getState().waitingContext?.requestingState).toBe('WORK');
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].transitions[0].guards = [
      { type: 'waiting_context_matches', params: { requestingState: 'WORK' } },
    ];
    expect((await restored.resume({ type: 'approval', content: 'approve gate' })).finalState).toBe(
      'DONE',
    );
  });

  it.each(['completed', 'failed', 'dead'] as const)(
    'resumes an exit session with outcome %s without repeating entry work',
    async (outcome) => {
      const f = sessionFixture();
      const c = config();
      c.workflowDefinition.states['WORK'].entryActions = [
        { type: 'store_artifact', params: { type: 'plan', name: 'entry', content: '{}' } },
      ];
      c.workflowDefinition.states['WORK'].exitActions = [
        { type: 'store_artifact', params: { type: 'plan', name: 'before', content: '{}' } },
        { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
        { type: 'store_artifact', params: { type: 'plan', name: 'after', content: '{}' } },
      ];
      const controller = new LifecycleController(f);
      expect((await controller.start(c)).finalState).toBe('WAITING_FOR_HUMAN');
      const saved = f.statePersistence.load(createRunId(c.runId));
      assert(saved);
      expect(saved.waitingContext?.liveSessionId).toBe('session');
      expect(saved.entryActionContinuation?.nextActionIndex).toBe(1);
      expect(saved.entryActionContinuation?.completedExitResults).toHaveLength(2);
      expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
        'entry',
        'before',
      ]);
      if (outcome === 'failed') {
        vi.mocked(f.sessionSupervisor).waitForAdvance.mockResolvedValue({
          kind: 'failed',
          error: 'session failed',
        });
      } else if (outcome === 'dead') {
        vi.mocked(f.sessionSupervisor).attach.mockResolvedValue(null);
      }
      const restored = new LifecycleController(f);
      restored.restore(c, saved);
      expect((await restored.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
        outcome === 'completed' ? 'DONE' : 'FAILED',
      );
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
      const names = vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name);
      expect(names.filter((name) => name === 'entry')).toHaveLength(1);
      expect(names.filter((name) => name === 'before')).toHaveLength(1);
      expect(names.filter((name) => name === 'after')).toHaveLength(
        outcome === 'completed' ? 1 : 0,
      );
      expect(
        f.statePersistence.load(createRunId(c.runId))?.entryActionContinuation,
      ).toBeUndefined();
    },
  );

  it.each(['approval', 'rejection'] as const)(
    'handles %s of an exit-worker budget pause across restore',
    async (decision) => {
      const f = createFixture();
      const c = config();
      c.budgetMaxTokens = 100;
      c.workflowDefinition.states['WORK'].entryActions = [
        { type: 'store_artifact', params: { type: 'plan', name: 'entry', content: '{}' } },
      ];
      c.workflowDefinition.states['WORK'].exitActions = [
        { type: 'dispatch_worker', params: { role: 'planner' } },
      ];
      const controller = new LifecycleController(f);
      expect((await controller.start(c)).finalState).toBe('WAITING_FOR_HUMAN');
      const saved = f.statePersistence.load(createRunId(c.runId));
      assert(saved);
      expect(saved.waitingContext?.reason).toBe('token_budget_exceeded');
      expect(saved.entryActionContinuation?.completedExitResults).toHaveLength(1);
      const restored = new LifecycleController(f);
      restored.restore(c, saved);
      expect(
        (await restored.resume({ type: decision, content: 'budget decision' })).finalState,
      ).toBe(decision === 'approval' ? 'DONE' : 'ABORTED');
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(f.artifactStore).store.mock.calls.filter(([request]) => request.name === 'entry'),
      ).toHaveLength(1);
      expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeInputTokens).toBe(100);
      expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeOutputTokens).toBe(50);
    },
  );

  it.each(['entry', 'exit', 'wait', 'terminal'] as const)(
    'replays %s session completion before the next checkpoint without another approval or token charge',
    async (phase) => {
      const f = sessionFixture();
      const c = config();
      const actions = [
        { type: 'dispatch_worker' as const, params: { role: 'plan_reviewer' as const } },
        {
          type: 'store_artifact' as const,
          params: { type: 'plan' as const, name: 'after', content: '{}' },
        },
      ];
      c.workflowDefinition.states['WORK'].entryActions = [];
      c.workflowDefinition.states['WORK'].exitActions = [];
      if (phase === 'entry') {
        c.workflowDefinition.states['WORK'].entryActions = actions;
      }
      if (phase === 'exit') {
        c.workflowDefinition.states['WORK'].exitActions = actions;
      }
      if (phase === 'terminal') {
        c.workflowDefinition.states['DONE'].entryActions = actions;
      }
      if (phase === 'wait') {
        c.workflowDefinition.states['WORK'].transitions[0].target = 'WAITING_FOR_HUMAN';
        c.workflowDefinition.states['WAITING_FOR_HUMAN'].entryActions = actions;
      }
      const controller = new LifecycleController(f);
      await controller.start(c);
      await controller.resume({ type: 'approval', content: 'yes' });
      const events = vi
        .mocked(f.journalWriter)
        .append.mock.calls.map(([event], index) => ({ ...event, sequence: index + 1 }));
      const end = events.findIndex((event) => event.type === 'worker_completed');
      assert(end >= 0);
      const recovered = new DefaultStatePersistence(
        '/private/tmp/workflow-replay-unused',
      ).reconstructFromJournal(createRunId(c.runId), events.slice(0, end + 1));
      assert(recovered);
      expect(recovered.waitingContext).toBeUndefined();
      vi.mocked(f.artifactStore).store.mockClear();
      const restored = new LifecycleController(f);
      restored.restore(c, recovered);
      expect((await restored.retry()).finalState).toBe(
        phase === 'wait' ? 'WAITING_FOR_HUMAN' : 'DONE',
      );
      expect(f.sessionSupervisor.sendHumanResponse).toHaveBeenCalledTimes(1);
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
        'after',
      ]);
      expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeInputTokens).toBe(40);
      expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeOutputTokens).toBe(25);
      if (phase === 'wait') {
        expect(restored.getState().waitingContext?.requestingState).toBe('WORK');
      }
    },
  );

  it.each([false, true])(
    'resumes dynamic task sessions with a completed peer: %s',
    async (completedPeer) => {
      const f = sessionFixture();
      const c = config();
      await f.artifactStore.store({
        type: 'task_breakdown',
        name: 'task_breakdown',
        content: JSON.stringify({ tasks: [{ id: 'A' }, { id: 'B' }] }),
        producedBy: 'system',
      });
      const secondRef = { ...f.ref, sessionId: 'session-B' };
      const pending = {
        ...workerResult('plan_reviewer'),
        sessionOutcome: 'awaiting_human' as const,
        sessionRef: f.ref,
        pendingRequest: {
          requestId: 'request',
          kind: 'permission' as const,
          createdAt: '',
          payload: { action: 'read', resource: '.' },
        },
      };
      vi.mocked(f.runner).dispatchParallel.mockResolvedValue([
        completedPeer
          ? {
              ...workerResult('plan_reviewer'),
              outputArtifacts: [{ ...createArtifactRef('plan_review'), name: 'A' }],
            }
          : pending,
        { ...pending, sessionRef: secondRef },
      ]);
      vi.mocked(f.sessionSupervisor).attach.mockImplementation((sessionId) =>
        Promise.resolve({
          ref: sessionId === 'session-B' ? secondRef : f.ref,
          state: 'awaiting_human',
          pendingRequests: [],
        }),
      );
      c.workflowDefinition.states['WORK'].entryActions = [
        {
          type: 'dispatch_dynamic_workers',
          params: { role: 'plan_reviewer', sourceArtifact: 'task_breakdown', itemsPath: 'tasks' },
        },
        { type: 'store_artifact', params: { type: 'plan', name: 'after', content: '{}' } },
      ];
      c.workflowDefinition.states['WORK'].exitActions = [];
      const controller = new LifecycleController(f);
      expect((await controller.start(c)).finalState).toBe('WAITING_FOR_HUMAN');
      expect(f.statePersistence.load(createRunId(c.runId))?.waitingContext?.liveSessionId).toBe(
        completedPeer ? 'session-B' : 'session',
      );
      expect(f.artifactStore.stored.has('task_specifications')).toBe(false);
      const first = await controller.resume({ type: 'approval', content: 'yes' });
      if (!completedPeer) {
        expect(first.finalState).toBe('WAITING_FOR_HUMAN');
        expect(f.statePersistence.load(createRunId(c.runId))?.waitingContext?.liveSessionId).toBe(
          'session-B',
        );
        expect(f.artifactStore.stored.has('task_specifications')).toBe(false);
        const events = vi
          .mocked(f.journalWriter)
          .append.mock.calls.map(([event], index) => ({ ...event, sequence: index + 1 }));
        const completedIndex = events.findIndex((event) => event.type === 'worker_completed');
        const replay = new DefaultStatePersistence(
          '/private/tmp/dynamic-replay-unused',
        ).reconstructFromJournal(createRunId(c.runId), events.slice(0, completedIndex + 1));
        assert(replay);
        const restored = new LifecycleController(f);
        restored.restore(c, replay);
        expect((await restored.retry()).finalState).toBe('WAITING_FOR_HUMAN');
        expect(f.statePersistence.load(createRunId(c.runId))?.waitingContext?.liveSessionId).toBe(
          'session-B',
        );
        expect((await restored.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
          'DONE',
        );
      } else {
        expect(first.finalState).toBe('DONE');
      }
      expect(f.runner.dispatchParallel).toHaveBeenCalledTimes(1);
      expect(f.runner.dispatch).not.toHaveBeenCalled();
      const aggregate = f.artifactStore.stored.get('task_specifications');
      assert(aggregate);
      expect(JSON.parse(aggregate.content) as unknown).toMatchObject({
        tasks: [
          { taskId: 'A', specificationRef: { type: 'plan_review', version: 1 } },
          {
            taskId: 'B',
            specificationRef: { type: 'plan_review', version: completedPeer ? 1 : 2 },
          },
        ],
      });
      if (completedPeer) {
        expect(JSON.parse(aggregate.content) as unknown).toMatchObject({
          tasks: [{ taskId: 'A', specificationRef: { name: 'A' } }, { taskId: 'B' }],
        });
      }
      const saved = f.statePersistence.load(createRunId(c.runId));
      expect(saved?.cumulativeInputTokens).toBe(completedPeer ? 50 : 80);
      expect(
        vi.mocked(f.artifactStore).store.mock.calls.filter(([request]) => request.name === 'after'),
      ).toHaveLength(1);
    },
  );

  it('uses the attached pending request when a legacy checkpoint only identifies the session', async () => {
    const f = sessionFixture();
    await new LifecycleController(f).start(f.c);
    const saved = f.statePersistence.load(createRunId(f.c.runId));
    assert(saved?.waitingContext);
    delete saved.waitingContext.pendingRequestId;
    vi.mocked(f.sessionSupervisor).attach.mockResolvedValue({
      ref: f.ref,
      state: 'awaiting_human',
      pendingRequests: [
        { requestId: 'legacy-request', kind: 'permission', createdAt: '', payload: {} },
      ],
    });
    const restored = new LifecycleController(f);
    restored.restore(f.c, saved);
    expect((await restored.resume({ type: 'approval', content: 'yes' })).finalState).toBe('DONE');
    expect(f.sessionSupervisor.sendHumanResponse).toHaveBeenCalledWith(
      'session',
      'legacy-request',
      { granted: true, reason: 'yes' },
    );
  });

  it('rejects legacy live-session recovery when session identity is unavailable', async () => {
    const f = sessionFixture();
    await new LifecycleController(f).start(f.c);
    const saved = f.statePersistence.load(createRunId(f.c.runId));
    assert(saved?.waitingContext);
    delete saved.waitingContext.liveSessionId;
    const restored = new LifecycleController(f);
    restored.restore(f.c, saved);
    await expect(restored.resume({ type: 'approval', content: 'yes' })).rejects.toThrow(
      'missing session identity',
    );
    expect(restored.getState().currentState).toBe('WAITING_FOR_HUMAN');
    expect(f.artifactStore.stored.has('planning_agreement')).toBe(false);
  });

  it('recovers the live session, pending request, and action cursor from the journal alone', async () => {
    const f = sessionFixture();
    await new LifecycleController(f).start(f.c);
    const events = vi
      .mocked(f.journalWriter)
      .append.mock.calls.map(([event], index) => ({ ...event, sequence: index + 1 }));
    const rebuilt = new DefaultStatePersistence(
      '/private/tmp/session-replay-unused',
    ).reconstructFromJournal(createRunId(f.c.runId), events);
    assert(rebuilt);
    expect(rebuilt.waitingContext).toMatchObject({
      liveSessionId: 'session',
      pendingRequestId: 'request',
      liveRequestType: 'permission',
      sessionTransport: 'remote',
    });
    expect(rebuilt.entryActionContinuation?.nextActionIndex).toBe(1);
    const restored = new LifecycleController(f);
    restored.restore(f.c, rebuilt);
    expect((await restored.resume({ type: 'approval', content: 'yes' })).finalState).toBe('DONE');
    expect(f.sessionSupervisor.attach).toHaveBeenCalledTimes(1);
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
    expect(f.artifactStore.stored.has('planning_agreement')).toBe(true);
  });

  it.each(['attach', 'getSnapshot', 'sendHumanResponse'] as const)(
    'does not advance or grant permission after cancellation during %s',
    async (step) => {
      const f = sessionFixture();
      let finish!: () => void;
      let signal!: () => void;
      const started = new Promise<void>((resolve) => {
        signal = resolve;
      });
      if (step === 'attach') {
        vi.mocked(f.sessionSupervisor).attach.mockImplementationOnce(
          () =>
            new Promise<AgentSessionHandle | null>((resolve) => {
              finish = () => {
                resolve({ ref: f.ref, state: 'awaiting_human', pendingRequests: [] });
              };
              signal();
            }),
        );
      } else if (step === 'getSnapshot') {
        vi.mocked(f.sessionSupervisor).attach.mockResolvedValue(null);
        vi.mocked(f.sessionSupervisor).getSnapshot.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = () => {
                resolve(null);
              };
              signal();
            }),
        );
      } else {
        vi.mocked(f.sessionSupervisor).sendHumanResponse.mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              finish = () => {
                resolve(true);
              };
              signal();
            }),
        );
      }
      const controller = new LifecycleController(f);
      await controller.start(f.c);
      const resuming = controller.resume({ type: 'approval', content: 'yes' });
      await started;
      await controller.abort('cancelled');
      finish();
      expect((await resuming).finalState).toBe('ABORTED');
      expect(f.sessionSupervisor.waitForAdvance).not.toHaveBeenCalled();
      if (step !== 'sendHumanResponse') {
        expect(f.sessionSupervisor.sendHumanResponse).not.toHaveBeenCalled();
      }
      expect(f.artifactStore.stored.has('planning_agreement')).toBe(false);
    },
  );

  it.each(['ABORTED', 'CUSTOM_FAILURE'] as const)(
    'routes dead sessions to the declared %s failure transition and runs cleanup',
    async (target) => {
      const f = sessionFixture();
      f.c.workflowDefinition.terminalStates = ['DONE', target];
      delete f.c.workflowDefinition.states['FAILED'];
      f.c.workflowDefinition.states[target] = {
        type: 'terminal',
        description: '',
        transitions: [],
        entryActions: [
          { type: 'store_artifact', params: { type: 'plan', name: 'cleanup', content: '{}' } },
        ],
      };
      f.c.workflowDefinition.states['WORK'].transitions[1].target = target;
      vi.mocked(f.sessionSupervisor).attach.mockResolvedValue(null);
      vi.mocked(f.sessionSupervisor).getSnapshot.mockResolvedValue(null);
      const controller = new LifecycleController(f);
      await controller.start(f.c);
      expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
        target,
      );
      const saved = f.statePersistence.load(createRunId(f.c.runId));
      expect(saved?.currentState).toBe(target);
      expect(saved?.pendingTerminalState).toBeUndefined();
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name),
      ).toContain('cleanup');
    },
  );

  it('journals resumed session usage for journal-only budget recovery', async () => {
    const f = sessionFixture();
    vi.mocked(f.runner).dispatch.mockResolvedValue({
      ...workerResult('plan_reviewer'),
      metrics: { ...workerResult('plan_reviewer').metrics, inputTokens: 0, outputTokens: 0 },
      sessionOutcome: 'awaiting_human',
      sessionRef: f.ref,
      pendingRequest: { requestId: 'request', kind: 'permission', createdAt: '', payload: {} },
    });
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe('DONE');
    const events = vi
      .mocked(f.journalWriter)
      .append.mock.calls.map(([event], index) => ({ ...event, sequence: index + 1 }));
    const rebuilt = new DefaultStatePersistence(
      '/private/tmp/session-replay-unused',
    ).reconstructFromJournal(createRunId(f.c.runId), events);
    const saved = f.statePersistence.load(createRunId(f.c.runId));
    expect(rebuilt?.cumulativeInputTokens).toBe(30);
    expect(rebuilt?.cumulativeOutputTokens).toBe(20);
    expect(rebuilt?.cumulativeInputTokens).toBe(saved?.cumulativeInputTokens);
    expect(rebuilt?.stateHistory).toEqual(saved?.stateHistory);
    expect(events.filter((event) => event.type === 'worker_completed')).toHaveLength(1);
  });

  it('resumes legacy session checkpoints without an action cursor', async () => {
    const f = sessionFixture();
    await new LifecycleController(f).start(f.c);
    const checkpoint = f.statePersistence.load(createRunId(f.c.runId));
    assert(checkpoint);
    delete checkpoint.entryActionContinuation;
    const restored = new LifecycleController(f);
    restored.restore(f.c, checkpoint);
    expect((await restored.resume({ type: 'approval', content: 'yes' })).finalState).toBe('DONE');
    expect(f.artifactStore.stored.get('planning_agreement')?.content).toContain('approved');
    expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(1);
  });

  it('preserves the other parallel reviewer result when a paused reviewer completes', async () => {
    const f = sessionFixture();
    await f.artifactStore.store({
      type: 'static_review',
      name: 'static',
      producedBy: 'static_reviewer',
      content: JSON.stringify({ approved: false }),
    });
    vi.mocked(f.runner).dispatchParallel.mockResolvedValue([
      {
        ...workerResult('plan_reviewer'),
        sessionOutcome: 'awaiting_human',
        sessionRef: f.ref,
        pendingRequest: {
          requestId: 'request',
          kind: 'permission',
          createdAt: '',
          payload: { action: 'read' },
        },
      },
      workerResult('static_reviewer', 'static_review'),
    ]);
    f.c.workflowDefinition.states['WORK'].entryActions = [
      {
        type: 'dispatch_parallel_workers',
        params: { roles: ['plan_reviewer', 'static_reviewer'] },
      },
    ];
    f.c.workflowDefinition.states['WORK'].transitions = [
      ...f.c.workflowDefinition.states['WORK'].transitions,
      {
        target: 'FAILED',
        trigger: 'review_rejected',
        guards: [],
        priority: 3,
        governanceRequired: false,
      },
    ];
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
      'FAILED',
    );
    expect(vi.mocked(f.runner).dispatchParallel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.runner).dispatch).not.toHaveBeenCalled();
    expect(f.statePersistence.load(createRunId(f.c.runId))?.cumulativeInputTokens).toBe(50);
  });

  it('advances the cursor across two separate session waits without repeating workers', async () => {
    const f = sessionFixture();
    const secondRef = { ...f.ref, role: 'planner', sessionId: 'session-2' };
    vi.mocked(f.runner)
      .dispatch.mockResolvedValueOnce({
        ...workerResult('plan_reviewer'),
        sessionOutcome: 'awaiting_human',
        sessionRef: f.ref,
      })
      .mockResolvedValue({
        ...workerResult('planner'),
        sessionOutcome: 'awaiting_human',
        sessionRef: secondRef,
      });
    vi.mocked(f.sessionSupervisor).attach.mockImplementation((sessionId) =>
      Promise.resolve({
        ref: sessionId === 'session-2' ? secondRef : f.ref,
        state: 'awaiting_human',
        pendingRequests: [],
      }),
    );
    f.c.workflowDefinition.states['WORK'].type = 'action';
    f.c.workflowDefinition.states['WORK'].transitions[0].trigger = 'completion';
    f.c.workflowDefinition.states['WORK'].entryActions = [
      { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
      { type: 'dispatch_worker', params: { role: 'planner' } },
      { type: 'generate_agreement', params: { type: 'planning_agreement' } },
    ];
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
      'WAITING_FOR_HUMAN',
    );
    const checkpoint = f.statePersistence.load(createRunId(f.c.runId));
    assert(checkpoint);
    expect(checkpoint.entryActionContinuation?.nextActionIndex).toBe(2);
    const restored = new LifecycleController(f);
    restored.restore(f.c, checkpoint);
    expect((await restored.resume({ type: 'approval', content: 'yes' })).finalState).toBe('DONE');
    expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(2);
    expect(f.statePersistence.load(createRunId(f.c.runId))?.cumulativeInputTokens).toBe(80);
    expect(f.artifactStore.stored.get('planning_agreement')?.content).toContain('approved');
  });

  it('runs agreement generation after reviewer completion across checkpoint restore', async () => {
    const f = sessionFixture();
    await new LifecycleController(f).start(f.c);
    expect(f.artifactStore.stored.has('planning_agreement')).toBe(false);
    const checkpoint = f.statePersistence.load(createRunId(f.c.runId));
    assert(checkpoint);
    expect(checkpoint.entryActionContinuation?.nextActionIndex).toBe(1);
    const restored = new LifecycleController(f);
    restored.restore(f.c, structuredClone(checkpoint));
    expect((await restored.resume({ type: 'approval', content: 'yes' })).finalState).toBe('DONE');
    expect(f.artifactStore.stored.get('planning_agreement')?.content).toContain('approved');
    expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(1);
    expect(f.statePersistence.load(createRunId(f.c.runId))?.cumulativeInputTokens).toBe(40);
    expect(f.statePersistence.load(createRunId(f.c.runId))?.cumulativeOutputTokens).toBe(25);
    expect(
      f.statePersistence.load(createRunId(f.c.runId))?.entryActionContinuation,
    ).toBeUndefined();
  });

  it.each(['attach', 'sendHumanResponse', 'waitForAdvance'] as const)(
    'preserves the session and unlocks after %s throws, then supports retry',
    async (operation) => {
      const f = sessionFixture();
      const controller = new LifecycleController(f);
      await controller.start(f.c);
      const original = vi.mocked(f.sessionSupervisor)[operation].getMockImplementation();
      assert(original);
      vi.mocked(f.sessionSupervisor)[operation].mockRejectedValueOnce(new Error('connection lost'));
      await expect(controller.resume({ type: 'approval', content: 'yes' })).rejects.toThrow(
        'connection lost',
      );
      expect(controller.getState().waitingContext?.requestingState).toBe('WORK');
      expect(f.statePersistence.load(createRunId(f.c.runId))?.waitingContext?.liveSessionId).toBe(
        'session',
      );
      expect(
        f.statePersistence.load(createRunId(f.c.runId))?.entryActionContinuation?.nextActionIndex,
      ).toBe(1);
      expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(2);
      expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
        'DONE',
      );
      expect(vi.mocked(f.runner).dispatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(f.statePersistence).releaseLock).toHaveBeenCalledTimes(3);
    },
  );

  it('does not overwrite a checkpoint when another process owns the resume lock', async () => {
    const f = sessionFixture();
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    const saveCount = vi.mocked(f.statePersistence).save.mock.calls.length;
    vi.mocked(f.statePersistence).acquireLock.mockImplementation(() => {
      throw new Error('another owner');
    });
    await expect(controller.resume({ type: 'approval', content: 'yes' })).rejects.toThrow(
      'another owner',
    );
    expect(vi.mocked(f.statePersistence).save).toHaveBeenCalledTimes(saveCount);
    expect(controller.getState().waitingContext?.requestingState).toBe('WORK');
    expect(vi.mocked(f.sessionSupervisor).attach).not.toHaveBeenCalled();
  });

  it('does not generate an agreement when session output cannot be stored', async () => {
    const f = sessionFixture();
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    vi.mocked(f.artifactStore).store.mockRejectedValue(new Error('disk full'));
    expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
      'FAILED',
    );
    expect(vi.mocked(f.artifactStore).store).toHaveBeenCalledTimes(1);
  });

  it('preserves abort while waiting for a session to complete', async () => {
    const f = sessionFixture();
    let complete: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      vi.mocked(f.sessionSupervisor).waitForAdvance.mockImplementation(
        () =>
          new Promise((finish) => {
            complete = () => {
              finish({ kind: 'completed', artifactContent: '{}', durationMs: 0 });
            };
            resolve();
          }),
      );
    });
    f.c.workflowDefinition.terminalStates = [...f.c.workflowDefinition.terminalStates, 'ABORTED'];
    f.c.workflowDefinition.states['ABORTED'] = {
      type: 'terminal',
      description: '',
      transitions: [],
    };
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    const resuming = controller.resume({ type: 'approval', content: 'yes' });
    await started;
    await controller.abort('cancelled');
    assert(complete);
    complete();
    expect((await resuming).finalState).toBe('ABORTED');
    expect(f.artifactStore.stored.has('planning_agreement')).toBe(false);
  });
});

describe('human transition and abort cleanup regressions', () => {
  function waitingConfig(stateId = 'WAITING_FOR_HUMAN') {
    const c = config();
    c.workflowDefinition.initialState = stateId;
    c.workflowDefinition.states[stateId] = {
      type: 'wait',
      description: '',
      entryActions: [{ type: 'notify_human', params: { reason: 'clarification_needed' } }],
      transitions: ['human_input', 'human_approved', 'human_rejected'].map((trigger) => ({
        target: 'WORK',
        trigger: trigger as 'human_input' | 'human_approved' | 'human_rejected',
        guards: [],
        priority: 1,
        governanceRequired: false,
      })),
    };
    c.workflowDefinition.states['WORK'].exitActions = [];
    c.workflowDefinition.terminalStates = ['DONE', 'FAILED', 'ABORTED'];
    c.workflowDefinition.states['ABORTED'] = {
      type: 'terminal',
      description: '',
      transitions: [],
      entryActions: ['first', 'second'].map((name) => ({
        type: 'store_artifact',
        params: { type: 'plan', name, content: '{}' },
      })),
    };
    return c;
  }

  it('forwards text answers to the next worker after checkpoint restore', async () => {
    const f = createFixture();
    const c = waitingConfig();
    await new LifecycleController(f).start(c);
    const saved = f.statePersistence.load(createRunId(c.runId));
    assert(saved);
    const restored = new LifecycleController(f);
    restored.restore(c, saved);
    expect((await restored.resume({ type: 'text', content: 'Use PostgreSQL' })).finalState).toBe(
      'DONE',
    );
    expect(f.runner.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ humanFeedback: 'Use PostgreSQL' }),
      undefined,
    );
  });

  it.each([undefined, '/cloned-repository'])(
    'restores the repository override %s before configuring worker dispatch',
    async (repoRoot) => {
      const f = createFixture();
      const c = { ...waitingConfig(), repoRoot: '/original' };
      await new LifecycleController(f).start(c);
      const saved = f.statePersistence.load(createRunId(c.runId));
      assert(saved);
      const restored = new LifecycleController(f);
      restored.restore(c, { ...saved, repoRoot });
      await restored.resume({ type: 'approval', content: 'yes' });
      expect(vi.mocked(f.runner).dispatch.mock.calls[0]?.[0].variableOverrides?.repoRoot).toBe(
        repoRoot ?? '/original',
      );
      expect(c.repoRoot).toBe('/original');
    },
  );

  it('exposes a named wait through restore and rejects retry until it receives input', async () => {
    const f = createFixture();
    const c = waitingConfig('APPROVAL');
    const controller = new LifecycleController(f);
    expect((await controller.start(c)).finalState).toBe('APPROVAL');
    expect(controller.getState()).toMatchObject({
      isWaitingForHuman: true,
      waitingContext: { requiredInput: 'text' },
    });
    const saved = f.statePersistence.load(createRunId(c.runId));
    assert(saved);
    const restored = new LifecycleController(f);
    restored.restore(c, saved);
    await expect(restored.retry()).rejects.toThrow('Cannot retry a waiting run');
    expect((await restored.resume({ type: 'text', content: 'continue' })).finalState).toBe('DONE');
  });

  it.each(['approval', 'rejection'] as const)('runs all wait exit actions on %s', async (type) => {
    const f = createFixture();
    const c = waitingConfig();
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].exitActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'wait-exit', content: '{}' } },
    ];
    const controller = new LifecycleController(f);
    await controller.start(c);
    expect((await controller.resume({ type, content: 'feedback' })).finalState).toBe('DONE');
    expect(
      vi.mocked(f.artifactStore).store.mock.calls.filter(([input]) => input.name === 'wait-exit'),
    ).toHaveLength(1);
  });

  it('fails the run when a required wait exit action fails', async () => {
    const f = createFixture();
    const c = waitingConfig();
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].exitActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'wait-exit', content: '{}' } },
    ];
    const controller = new LifecycleController(f);
    await controller.start(c);
    vi.mocked(f.artifactStore).store.mockRejectedValue(new Error('disk full'));
    expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
      'FAILED',
    );
    expect(f.runner.dispatch).not.toHaveBeenCalled();
  });

  it('runs every abort cleanup action exactly once after an idle human wait', async () => {
    const f = createFixture();
    const controller = new LifecycleController(f);
    await controller.start(waitingConfig());
    await controller.abort('stop');
    await controller.abort('stop again');
    const names = vi.mocked(f.artifactStore).store.mock.calls.map(([input]) => input.name);
    expect(names).toEqual(['first', 'second']);
    expect(controller.getState().currentState).toBe('ABORTED');
    expect(
      f.statePersistence.load(createRunId('regression'))?.pendingTerminalState,
    ).toBeUndefined();
  });

  it('continues abort cleanup from a waiting source state after checkpoint failure', async () => {
    const f = createFixture();
    const c = waitingConfig();
    const controller = new LifecycleController(f);
    await controller.start(c);
    const save = vi.mocked(f.statePersistence).save.getMockImplementation();
    assert(save);
    vi.mocked(f.statePersistence).save.mockImplementation(async (state) => {
      if (
        state.pendingTerminalState === 'ABORTED' &&
        state.entryActionContinuation?.nextActionIndex === 1
      ) {
        throw new Error('checkpoint unavailable');
      }
      await save(state);
    });
    await expect(controller.abort('stop')).rejects.toThrow('checkpoint unavailable');
    const events = vi
      .mocked(f.journalWriter)
      .append.mock.calls.map(([event], index) => ({ ...event, sequence: index + 1 }));
    const rebuilt = new DefaultStatePersistence(
      '/private/tmp/abort-cleanup-replay-unused',
    ).reconstructFromJournal(createRunId(c.runId), events);
    assert(rebuilt);
    expect(rebuilt.currentState).toBe('WAITING_FOR_HUMAN');
    expect(rebuilt.pendingTerminalState).toBe('ABORTED');
    vi.mocked(f.statePersistence).save.mockImplementation(save);
    const restored = new LifecycleController(f);
    restored.restore(c, rebuilt);
    expect((await restored.retry()).finalState).toBe('ABORTED');
    expect(vi.mocked(f.artifactStore).store.mock.calls.map(([input]) => input.name)).toEqual([
      'first',
      'second',
    ]);
  });

  it('does not execute abort cleanup when another process owns the run lock', async () => {
    const f = createFixture();
    const controller = new LifecycleController(f);
    await controller.start(waitingConfig());
    vi.mocked(f.statePersistence).acquireLock.mockImplementationOnce(() => {
      throw new Error('run locked');
    });
    await expect(controller.abort('stop')).rejects.toThrow('run locked');
    expect(f.artifactStore.store).not.toHaveBeenCalled();
  });

  it('runs abort cleanup when rejection happens within an active resume call', async () => {
    const f = createFixture();
    let locked = false;
    const acquire = vi.mocked(f.statePersistence).acquireLock.getMockImplementation();
    const store = vi.mocked(f.artifactStore).store.getMockImplementation();
    assert(acquire);
    assert(store);
    vi.mocked(f.statePersistence).acquireLock.mockImplementation((runId) => {
      locked = true;
      return acquire(runId);
    });
    vi.mocked(f.statePersistence).releaseLock.mockImplementation(() => {
      locked = false;
    });
    vi.mocked(f.artifactStore).store.mockImplementation(async (input) => {
      if ((input.name === 'first' || input.name === 'second') && !locked) {
        throw new Error('cleanup requires the run lock');
      }
      return store(input);
    });
    const c = { ...waitingConfig(), budgetMaxTokens: 1 };
    c.workflowDefinition.initialState = 'WORK';
    const controller = new LifecycleController(f);
    await controller.start(c);
    expect(controller.getState().waitingContext?.reason).toBe('token_budget_exceeded');
    expect((await controller.resume({ type: 'rejection', content: 'stop' })).finalState).toBe(
      'ABORTED',
    );
    expect(vi.mocked(f.artifactStore).store.mock.calls.map(([input]) => input.name)).toEqual([
      'plan',
      'first',
      'second',
    ]);
  });

  it('restores a manual pause during wait exit actions without repeating completed exit work', async () => {
    const f = createFixture();
    const c = waitingConfig();
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].exitActions = [
      'exit-first',
      'exit-second',
    ].map((name) => ({ type: 'store_artifact', params: { type: 'plan', name, content: '{}' } }));
    const controller = new LifecycleController(f);
    await controller.start(c);
    vi.mocked(f.artifactStore).store.mockImplementationOnce(async () => {
      await controller.pause({
        reason: 'manual',
        requiredInput: 'approval',
        requestingState: 'WAITING_FOR_HUMAN',
        autoResumeSafe: false,
        presentedArtifacts: [],
        waitingSince: '',
      });
      return createArtifactRef('plan');
    });
    expect((await controller.resume({ type: 'text', content: 'Use PostgreSQL' })).finalState).toBe(
      'WAITING_FOR_HUMAN',
    );
    const saved = f.statePersistence.load(createRunId(c.runId));
    assert(saved);
    expect(saved.executionPaused).toBe(true);
    const restored = new LifecycleController(f);
    restored.restore(c, saved);
    expect((await restored.resume({ type: 'approval', content: 'continue' })).finalState).toBe(
      'DONE',
    );
    expect(
      vi
        .mocked(f.artifactStore)
        .store.mock.calls.filter(([input]) => input.name.startsWith('exit-'))
        .map(([input]) => input.name),
    ).toEqual(['exit-first', 'exit-second']);
    expect(vi.mocked(f.runner).dispatch.mock.calls[0]?.[0].humanFeedback).toBe('Use PostgreSQL');
  });

  it('retains the original human response when resuming a failed exit checkpoint', async () => {
    const f = createFixture();
    const c = waitingConfig();
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].exitActions = [
      'exit-first',
      'exit-second',
    ].map((name) => ({ type: 'store_artifact', params: { type: 'plan', name, content: '{}' } }));
    const controller = new LifecycleController(f);
    await controller.start(c);
    const save = vi.mocked(f.statePersistence).save.getMockImplementation();
    assert(save);
    let failed = false;
    vi.mocked(f.statePersistence).save.mockImplementation(async (state) => {
      if (!failed && state.entryActionContinuation?.completedExitResults?.length === 1) {
        failed = true;
        throw new Error('checkpoint failed');
      }
      await save(state);
    });
    await expect(controller.resume({ type: 'text', content: 'Use PostgreSQL' })).rejects.toThrow(
      'checkpoint failed',
    );
    const saved = f.statePersistence.load(createRunId(c.runId));
    assert(saved);
    const restored = new LifecycleController(f);
    restored.restore(c, saved);
    expect(
      (await restored.resume({ type: 'approval', content: 'Resumed via CLI' })).finalState,
    ).toBe('DONE');
    expect(
      vi
        .mocked(f.artifactStore)
        .store.mock.calls.filter(([input]) => input.name.startsWith('exit-'))
        .map(([input]) => input.name),
    ).toEqual(['exit-first', 'exit-second']);
    expect(vi.mocked(f.runner).dispatch.mock.calls[0]?.[0].humanFeedback).toBe('Use PostgreSQL');
  });

  it('honors abort during a human transition exit action and completes abort cleanup', async () => {
    const f = createFixture();
    const c = waitingConfig();
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].exitActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'exit', content: '{}' } },
    ];
    const controller = new LifecycleController(f);
    await controller.start(c);
    vi.mocked(f.artifactStore).store.mockImplementationOnce(async () => {
      await controller.abort('cancelled during exit');
      return createArtifactRef('plan');
    });
    expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
      'ABORTED',
    );
    expect(f.runner.dispatch).not.toHaveBeenCalled();
    expect(vi.mocked(f.artifactStore).store.mock.calls.map(([input]) => input.name)).toEqual([
      'exit',
      'first',
      'second',
    ]);
  });

  it.each(['session', 'budget'] as const)(
    'restores wait exit work interrupted by a %s without losing the original answer',
    async (mode) => {
      const f = createFixture();
      const c = { ...waitingConfig(), ...(mode === 'budget' ? { budgetMaxTokens: 1 } : {}) };
      c.workflowDefinition.states['WAITING_FOR_HUMAN'].exitActions = [
        { type: 'store_artifact', params: { type: 'plan', name: 'before-exit', content: '{}' } },
        { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
        { type: 'store_artifact', params: { type: 'plan', name: 'after-exit', content: '{}' } },
      ];
      const ref: AgentSessionRef = {
        sessionId: 'exit-session',
        runId: c.runId,
        stateId: 'WAITING_FOR_HUMAN',
        role: 'plan_reviewer',
        transport: 'remote',
      };
      if (mode === 'session') {
        vi.mocked(f.runner).dispatch.mockResolvedValueOnce({
          ...workerResult('plan_reviewer'),
          sessionRef: ref,
          sessionOutcome: 'awaiting_human',
        });
      }
      const sessionSupervisor: AgentSessionSupervisor = {
        createSession: vi.fn(),
        attach: vi.fn().mockResolvedValue({ ref, state: 'awaiting_human', pendingRequests: [] }),
        waitForAdvance: vi.fn().mockResolvedValue({
          kind: 'completed',
          artifactContent: '{"approved":true}',
          durationMs: 1,
        }),
        sendHumanResponse: vi.fn(),
        pause: vi.fn(),
        abort: vi.fn(),
        finalize: vi.fn(),
        getSnapshot: vi.fn(),
        getState: vi.fn(),
        listByRun: vi.fn(),
      };
      const controller = new LifecycleController({ ...f, sessionSupervisor });
      await controller.start(c);
      expect(
        (await controller.resume({ type: 'text', content: 'Use PostgreSQL' })).finalState,
      ).toBe('WAITING_FOR_HUMAN');
      const saved = f.statePersistence.load(createRunId(c.runId));
      assert(saved);
      expect(saved.entryActionContinuation?.resumeInput).toEqual({
        type: 'text',
        content: 'Use PostgreSQL',
      });
      const restored = new LifecycleController({ ...f, sessionSupervisor });
      restored.restore(c, structuredClone(saved));
      expect(
        (await restored.resume({ type: 'approval', content: 'Continue exit work' })).finalState,
      ).toBe('DONE');
      expect(
        vi
          .mocked(f.artifactStore)
          .store.mock.calls.filter(([input]) => input.name === 'before-exit'),
      ).toHaveLength(1);
      expect(
        vi
          .mocked(f.artifactStore)
          .store.mock.calls.filter(([input]) => input.name === 'after-exit'),
      ).toHaveLength(1);
      const plannerCalls = vi
        .mocked(f.runner)
        .dispatch.mock.calls.filter(([request]) => request.role === 'planner');
      expect(plannerCalls).toHaveLength(1);
      expect(plannerCalls[0]?.[0].humanFeedback).toBe('Use PostgreSQL');
    },
  );
});

async function deferredRun(
  f: ReturnType<typeof createFixture>,
  c: WorkflowRunConfig,
  options: { workflowTimeoutMs?: number } = {},
) {
  let finish!: (result: DispatchResult) => void;
  let signal!: () => void;
  const started = new Promise<void>((resolve) => {
    signal = resolve;
  });
  vi.mocked(f.runner).dispatch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
        signal();
      }),
  );
  const controller = new LifecycleController({ ...f, ...options });
  const running = controller.start(c);
  await started;
  return { controller, running, finish };
}

describe('LifecycleController interruption and durability regressions', () => {
  it('holds a manual pause and restores the remaining actions without repeating completed work', async () => {
    const f = createFixture();
    const c = config();
    c.workflowDefinition.states['WORK'].entryActions = [
      ...(c.workflowDefinition.states['WORK'].entryActions ?? []),
      { type: 'dispatch_worker', params: { role: 'implementer' } },
    ];
    const { controller, running, finish } = await deferredRun(f, c);
    await controller.pause({
      reason: 'manual',
      requiredInput: 'approval',
      requestingState: 'WORK',
      autoResumeSafe: true,
      presentedArtifacts: [],
      waitingSince: new Date().toISOString(),
    });
    finish(workerResult('planner'));
    expect((await running).finalState).toBe('WAITING_FOR_HUMAN');
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
    expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(1);
    const checkpoint = f.statePersistence.load(createRunId(c.runId));
    assert(checkpoint);
    expect(checkpoint.entryActionContinuation?.nextActionIndex).toBe(1);
    const restored = new LifecycleController(f);
    restored.restore(c, checkpoint);
    expect((await restored.resume({ type: 'approval', content: 'continue' })).finalState).toBe(
      'DONE',
    );
    expect(vi.mocked(f.runner).dispatch.mock.calls.map(([request]) => request.role)).toEqual([
      'planner',
      'implementer',
    ]);
    expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeInputTokens).toBe(110);
  });

  it('aborts a manually paused run when its continuation is rejected', async () => {
    const f = createFixture();
    const c = config();
    const { controller, running, finish } = await deferredRun(f, c);
    await controller.pause({
      reason: 'manual',
      requiredInput: 'approval',
      requestingState: 'WORK',
      autoResumeSafe: true,
      presentedArtifacts: [],
      waitingSince: new Date().toISOString(),
    });
    finish(workerResult('planner'));
    await running;
    expect((await controller.resume({ type: 'rejection', content: 'stop' })).finalState).toBe(
      'ABORTED',
    );
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch another worker after abort even when the pending worker succeeds', async () => {
    const f = createFixture();
    const c = config();
    c.workflowDefinition.terminalStates = [...c.workflowDefinition.terminalStates, 'ABORTED'];
    c.workflowDefinition.states['ABORTED'] = { type: 'terminal', description: '', transitions: [] };
    c.workflowDefinition.states['WORK'].entryActions = [
      ...(c.workflowDefinition.states['WORK'].entryActions ?? []),
      { type: 'dispatch_worker', params: { role: 'implementer' } },
    ];
    const { controller, running, finish } = await deferredRun(f, c);
    await controller.abort('stop');
    finish(workerResult('planner'));
    expect((await running).finalState).toBe('ABORTED');
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
  });

  it('releases the lock and preserves the original error if error journaling fails', async () => {
    const f = createFixture();
    vi.mocked(f.journalWriter).append.mockImplementation(() => {
      throw new Error('disk full');
    });
    const c = config();
    c.globalTransitionLimit = 0;
    await expect(new LifecycleController(f).start(c)).rejects.toThrow('transition');
    expect(f.statePersistence.acquireLock).toHaveBeenCalledTimes(1);
    expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases the retry lock if its initial journal write fails', async () => {
    const f = createFixture();
    const c = config();
    const original = new LifecycleController(f);
    await original.start(c);
    const checkpoint = f.statePersistence.load(createRunId(c.runId));
    assert(checkpoint);
    checkpoint.currentState = 'WORK';
    const restored = new LifecycleController(f);
    restored.restore(c, checkpoint);
    vi.mocked(f.statePersistence).releaseLock.mockClear();
    vi.mocked(f.journalWriter).append.mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(restored.retry()).rejects.toThrow('disk full');
    expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('rejects an overdue final worker and skips the remaining actions', async () => {
    const f = createFixture();
    const c = config();
    c.workflowDefinition.states['WORK'].entryActions = [
      ...(c.workflowDefinition.states['WORK'].entryActions ?? []),
      { type: 'dispatch_worker', params: { role: 'implementer' } },
    ];
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { running, finish } = await deferredRun(f, c, { workflowTimeoutMs: 100 });
      const rejected = expect(running).rejects.toThrow('timed out');
      now += 1000;
      finish(workerResult('planner'));
      await rejected;
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
      expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('preserves budget approval when restored at a subsequent human gate', async () => {
    const f = createFixture();
    const c = config();
    c.budgetMaxTokens = 100;
    c.workflowDefinition.states['WORK'].transitions[0].target = 'WAITING_FOR_HUMAN';
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].transitions[0].target = 'SECOND';
    c.workflowDefinition.states['SECOND'] = {
      type: 'action',
      description: '',
      entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
      transitions: [
        {
          target: 'DONE',
          trigger: 'completion',
          guards: [],
          priority: 1,
          governanceRequired: false,
        },
      ],
    };
    const controller = new LifecycleController(f);
    expect((await controller.start(c)).finalState).toBe('WAITING_FOR_HUMAN');
    expect(
      (await controller.resume({ type: 'approval', content: 'approve budget' })).finalState,
    ).toBe('WAITING_FOR_HUMAN');
    const checkpoint = f.statePersistence.load(createRunId(c.runId));
    assert(checkpoint);
    expect(checkpoint.budgetApproved).toBe(true);
    const restored = new LifecycleController(f);
    restored.restore(c, checkpoint);
    expect((await restored.resume({ type: 'approval', content: 'approve gate' })).finalState).toBe(
      'DONE',
    );
    expect(f.runner.dispatch).toHaveBeenCalledTimes(2);
    expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeInputTokens).toBe(200);
  });

  it('regenerates dependent agreements from the escalated review and keeps dispatch context', async () => {
    const f = createFixture();
    let calls = 0;
    vi.mocked(f.runner).dispatch.mockImplementation(async () => {
      calls++;
      await f.artifactStore.store({
        type: 'plan_review',
        name: 'review',
        content: JSON.stringify({ approved: calls > 1 }),
        producedBy: 'plan_reviewer',
      });
      return workerResult('plan_reviewer', 'plan_review');
    });
    vi.mocked(f.governanceEngine)
      .evaluateTransition.mockReturnValueOnce(escalation())
      .mockReturnValue({ allowed: true, reason: 'pass' });
    const c = config();
    c.workflowDefinition.states['WORK'].type = 'review';
    c.workflowDefinition.states['WORK'].entryActions = [
      { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
      { type: 'generate_agreement', params: { type: 'planning_agreement' } },
    ];
    c.workflowDefinition.states['WORK'].transitions[0].trigger = 'review_approved';
    c.workflowDefinition.states['WORK'].transitions = [
      ...c.workflowDefinition.states['WORK'].transitions,
      { ...c.workflowDefinition.states['WORK'].transitions[0], trigger: 'review_rejected' },
    ];
    const first = new LifecycleController(f);
    await first.start(c);
    expect(f.artifactStore.stored.get('planning_agreement')?.content).toContain('approved');
    expect(calls).toBe(2);
    const saved = f.statePersistence.load(createRunId(c.runId));
    assert(saved);
    expect(saved.cumulativeInputTokens).toBe(20);
    const checkpoint = {
      ...saved,
      currentState: 'WORK',
      lastHumanFeedback: 'Check transactions',
      lastReviewContent: 'Earlier findings',
    };
    calls = 0;
    vi.mocked(f.runner).dispatch.mockClear();
    vi.mocked(f.governanceEngine)
      .evaluateTransition.mockReturnValueOnce(escalation())
      .mockReturnValue({ allowed: true, reason: 'pass' });
    const restored = new LifecycleController(f);
    restored.restore(c, checkpoint);
    await restored.retry();
    const requests = vi.mocked(f.runner).dispatch.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.humanFeedback).toBe('Check transactions');
    expect(requests[1]?.previousReviewContent).toBe('Earlier findings');
  });
});

describe('LifecycleController asynchronous pause boundaries', () => {
  it.each(['exit', 'terminal'] as const)(
    'preserves a pause inside %s actions across restore',
    async (phase) => {
      const f = createFixture();
      const c = config();
      vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('planner'));
      const actions = [
        {
          type: 'store_artifact' as const,
          params: { type: 'plan' as const, name: 'first', content: '{}' },
        },
        {
          type: 'store_artifact' as const,
          params: { type: 'plan' as const, name: 'second', content: '{}' },
        },
      ];
      if (phase === 'exit') {
        c.workflowDefinition.states['WORK'].exitActions = actions;
      } else {
        c.workflowDefinition.states['DONE'].entryActions = actions;
      }
      let finish!: (ref: ArtifactRef) => void;
      let signal!: () => void;
      const started = new Promise<void>((resolve) => {
        signal = resolve;
      });
      vi.mocked(f.artifactStore).store.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
            signal();
          }),
      );
      const controller = new LifecycleController(f);
      const running = controller.start(c);
      await started;
      await controller.pause({
        reason: 'manual',
        requiredInput: 'approval',
        requestingState: phase === 'exit' ? 'WORK' : 'DONE',
        autoResumeSafe: true,
        presentedArtifacts: [],
        waitingSince: new Date().toISOString(),
      });
      finish(createArtifactRef('plan'));
      expect((await running).finalState).toBe('WAITING_FOR_HUMAN');
      expect(f.artifactStore.store).toHaveBeenCalledTimes(1);
      const saved = f.statePersistence.load(createRunId(c.runId));
      assert(saved);
      const restored = new LifecycleController(f);
      restored.restore(c, saved);
      expect((await restored.resume({ type: 'approval', content: 'continue' })).finalState).toBe(
        'DONE',
      );
      expect(f.artifactStore.store).toHaveBeenCalledTimes(2);
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
    },
  );

  it('does not apply an evaluated transition over a manual pause', async () => {
    const f = createFixture();
    const c = config();
    let finish!: (value: null) => void;
    let signal!: () => void;
    const started = new Promise<void>((resolve) => {
      signal = resolve;
    });
    vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('planner'));
    vi.mocked(f.artifactStore).getLatest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          signal();
        }),
    );
    c.workflowDefinition.states['WORK'].transitions[0].guards = [
      { type: 'artifact_exists', params: { artifactType: 'verification' } },
    ];
    const controller = new LifecycleController(f);
    const running = controller.start(c);
    await started;
    await controller.pause({
      reason: 'manual',
      requiredInput: 'approval',
      requestingState: 'WORK',
      autoResumeSafe: true,
      presentedArtifacts: [],
      waitingSince: new Date().toISOString(),
    });
    finish(null);
    expect((await running).finalState).toBe('WAITING_FOR_HUMAN');
    expect(controller.getState().waitingContext?.reason).toBe('manual');
    expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(1);
  });

  it.each(['exit', 'terminal'] as const)(
    'rejects an overdue %s action instead of returning success',
    async (phase) => {
      const f = createFixture();
      const c = config();
      vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('planner'));
      const actions = [
        {
          type: 'store_artifact' as const,
          params: { type: 'plan' as const, name: 'slow', content: '{}' },
        },
      ];
      if (phase === 'exit') {
        c.workflowDefinition.states['WORK'].exitActions = actions;
      } else {
        c.workflowDefinition.states['DONE'].entryActions = actions;
      }
      let now = 1000;
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
      vi.mocked(f.artifactStore).store.mockImplementation(() => {
        now += 1000;
        return Promise.resolve(createArtifactRef('plan'));
      });
      try {
        await expect(
          new LifecycleController({ ...f, workflowTimeoutMs: 100 }).start(c),
        ).rejects.toThrow('timed out');
        expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(1);
      } finally {
        clock.mockRestore();
      }
    },
  );
});

describe('budget approval checkpoint replay', () => {
  it('does not redispatch or recount completed work after a crash at the approval checkpoint', async () => {
    const f = createFixture();
    const c = config();
    c.budgetMaxTokens = 100;
    const controller = new LifecycleController(f);
    expect((await controller.start(c)).finalState).toBe('WAITING_FOR_HUMAN');
    const save = vi.mocked(f.statePersistence).save.getMockImplementation();
    assert(save);
    vi.mocked(f.statePersistence).save.mockImplementationOnce(async (state) => {
      await save(state);
      throw new Error('interrupted after checkpoint');
    });
    await expect(controller.resume({ type: 'approval', content: 'extend' })).rejects.toThrow(
      'interrupted after checkpoint',
    );
    const saved = f.statePersistence.load(createRunId(c.runId));
    assert(saved);
    expect(saved.budgetApproved).toBe(true);
    expect(saved.entryActionContinuation?.completedResults).toHaveLength(1);
    const restored = new LifecycleController(f);
    restored.restore(c, saved);
    expect((await restored.retry()).finalState).toBe('DONE');
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
    expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeInputTokens).toBe(100);
    expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeOutputTokens).toBe(50);
  });
});

describe('LifecycleController lifecycle ownership and required actions', () => {
  it('waits for a paused execution to settle before resuming its cursor', async () => {
    const f = createFixture();
    const c = config();
    const { controller, running, finish } = await deferredRun(f, c);
    await controller.pause({
      reason: 'manual',
      requiredInput: 'approval',
      requestingState: 'WORK',
      autoResumeSafe: true,
      presentedArtifacts: [],
      waitingSince: new Date().toISOString(),
    });
    const resuming = controller.resume({ type: 'approval', content: 'continue' });
    await Promise.resolve();
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
    expect(f.statePersistence.releaseLock).not.toHaveBeenCalled();
    finish(workerResult('planner'));
    expect((await running).finalState).toBe('WAITING_FOR_HUMAN');
    expect((await resuming).finalState).toBe('DONE');
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
    expect(f.statePersistence.acquireLock).toHaveBeenCalledTimes(2);
    expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeInputTokens).toBe(10);
  });

  it('rejects overlapping execution and restore operations without mutating the active run', async () => {
    const f = createFixture();
    const c = config();
    const { controller, running, finish } = await deferredRun(f, c);
    await expect(controller.start({ ...c, runId: 'other' })).rejects.toThrow('already active');
    await expect(controller.resume({ type: 'approval', content: 'yes' })).rejects.toThrow(
      'already active',
    );
    await expect(controller.retry()).rejects.toThrow('already active');
    expect(controller.getState().runId).toBe(c.runId);
    finish(workerResult('planner'));
    await running;
    const checkpoint = f.statePersistence.load(createRunId(c.runId));
    assert(checkpoint);
    const next = await deferredRun(f, c);
    expect(() => {
      next.controller.restore(c, checkpoint);
    }).toThrow('execution is active');
    next.finish(workerResult('planner'));
    await next.running;
  });

  it('starts with fresh usage, metrics, feedback, and iteration counters when reused', async () => {
    const f = createFixture();
    const controller = new LifecycleController(f);
    const first = config();
    await controller.start(first);
    const saved = f.statePersistence.load(createRunId(first.runId));
    assert(saved);
    controller.restore(first, {
      ...saved,
      lastHumanFeedback: 'old feedback',
      lastReviewContent: 'old review',
      interruptedActionResults: [
        { action: { type: 'dispatch_worker', params: { role: 'planner' } }, success: false },
      ],
    });
    f.contractRegistry.recordStateEntry('PLAN_REVIEW');
    const second = { ...config(), runId: 'new-run', budgetMaxTokens: 200 };
    expect((await controller.start(second)).finalState).toBe('DONE');
    const fresh = f.statePersistence.load(createRunId(second.runId));
    expect(f.runner.dispatch).toHaveBeenCalledTimes(2);
    expect(fresh?.cumulativeInputTokens).toBe(100);
    expect(fresh?.workerMetricsByRole?.['planner']?.dispatches).toBe(1);
    expect(fresh?.iterationCounts['plan_review_loop']).toBe(0);
    expect(fresh?.interruptedActionResults).toBeUndefined();
    expect(vi.mocked(f.runner).dispatch.mock.calls.at(-1)?.[0].humanFeedback).toBeUndefined();
    expect(
      vi.mocked(f.runner).dispatch.mock.calls.at(-1)?.[0].previousReviewContent,
    ).toBeUndefined();
  });

  it('fails a required wait entry action and does not present approval as safe', async () => {
    const f = createFixture();
    const c = config();
    vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('planner'));
    vi.mocked(f.artifactStore).store.mockRejectedValue(new Error('cannot store required artifact'));
    c.workflowDefinition.states['WORK'].transitions[0].target = 'WAITING_FOR_HUMAN';
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'required', content: '{}' } },
    ];
    const controller = new LifecycleController(f);
    expect((await controller.start(c)).finalState).toBe('FAILED');
    expect(controller.getState().waitingContext).toBeUndefined();
    expect(f.statePersistence.load(createRunId(c.runId))?.currentState).toBe('FAILED');
    expect(
      vi
        .mocked(f.journalWriter)
        .append.mock.calls.some(
          ([event]) => event.type === 'error' && event.data.errorCode === 'wait_action_failed',
        ),
    ).toBe(true);
  });

  it.each(['storage_failure', 'empty_output'] as const)(
    'fails the script output contract on %s',
    async (failure) => {
      const f = createFixture();
      const c = config();
      c.workflowDefinition.states['WORK'].entryActions = [
        {
          type: 'run_script',
          params: {
            script: 'generate.ts',
            storeOutput: { artifactType: 'plan', producedBy: 'planner' },
          },
        },
      ];
      const execution = vi.spyOn(ScriptExecutor.prototype, 'execute').mockResolvedValue({
        action: { type: 'run_script', params: { script: 'generate.ts' } },
        success: true,
        scriptResult: {
          exitCode: 0,
          stdout: failure === 'empty_output' ? '  ' : '{}',
          stderr: '',
          durationMs: 1,
        },
      });
      vi.mocked(f.artifactStore).store.mockRejectedValue(new Error('disk full'));
      try {
        expect((await new LifecycleController(f).start(c)).finalState).toBe('FAILED');
        expect(f.artifactStore.stored.has('plan')).toBe(false);
      } finally {
        execution.mockRestore();
      }
    },
  );

  it('keeps terminal work retryable and checkpoints its cursor before reporting completion', async () => {
    const f = createFixture();
    const c = config();
    vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('planner'));
    c.workflowDefinition.states['DONE'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'first', content: '{}' } },
      { type: 'store_artifact', params: { type: 'plan', name: 'second', content: '{}' } },
    ];
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(f.artifactStore).store.mockImplementationOnce(() => {
      now += 1000;
      return Promise.resolve(createArtifactRef('plan'));
    });
    try {
      const controller = new LifecycleController({ ...f, workflowTimeoutMs: 100 });
      await expect(controller.start(c)).rejects.toThrow('timed out');
      const saved = f.statePersistence.load(createRunId(c.runId));
      assert(saved);
      expect(saved.currentState).toBe('WORK');
      expect(saved.pendingTerminalState).toBe('DONE');
      expect(saved.entryActionContinuation?.nextActionIndex).toBe(1);
      expect(controller.getState().currentState).toBe('WORK');
      const restored = new LifecycleController(f);
      restored.restore(c, saved);
      expect((await restored.retry()).finalState).toBe('DONE');
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
        'first',
        'second',
      ]);
      expect(f.statePersistence.load(createRunId(c.runId))?.pendingTerminalState).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });
});

describe('LifecycleController cancellation, budget, and journal boundaries', () => {
  it('cannot complete successfully while abort cancellation is pending', async () => {
    const f = createFixture();
    const c = config();
    vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('planner'));
    c.workflowDefinition.states['DONE'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'cleanup', content: '{}' } },
    ];
    let finishAction!: (ref: ArtifactRef) => void;
    let actionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      actionStarted = resolve;
    });
    vi.mocked(f.artifactStore).store.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAction = resolve;
          actionStarted();
        }),
    );
    let finishCancel!: () => void;
    vi.mocked(f.runner).cancelAllWorkers.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCancel = resolve;
        }),
    );
    const controller = new LifecycleController(f);
    let settled = false;
    const running = controller.start(c).then((result) => {
      settled = true;
      return result;
    });
    await started;
    const aborting = controller.abort('cancelled');
    expect(controller.getState().currentState).toBe('ABORTED');
    finishAction(createArtifactRef('plan'));
    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(controller.start({ ...c, runId: 'next-run' })).rejects.toThrow('already active');
    finishCancel();
    await aborting;
    expect((await running).finalState).toBe('ABORTED');
    expect(f.statePersistence.load(createRunId(c.runId))?.currentState).toBe('ABORTED');
    expect(
      vi
        .mocked(f.journalWriter)
        .append.mock.calls.some(([event]) => event.type === 'run_completed'),
    ).toBe(false);
  });

  it.each(['wait', 'terminal'] as const)(
    'enforces the budget for %s workers without replaying their usage or work',
    async (phase) => {
      const f = createFixture();
      const c = config();
      c.budgetMaxTokens = 100;
      c.workflowDefinition.states['WORK'].entryActions = [];
      c.workflowDefinition.states['WORK'].exitActions = [];
      c.workflowDefinition.states['WORK'].transitions[0].target =
        phase === 'wait' ? 'WAITING_FOR_HUMAN' : 'DONE';
      c.workflowDefinition.states[phase === 'wait' ? 'WAITING_FOR_HUMAN' : 'DONE'].entryActions = [
        { type: 'dispatch_worker', params: { role: 'planner' } },
      ];
      const controller = new LifecycleController(f);
      expect((await controller.start(c)).finalState).toBe('WAITING_FOR_HUMAN');
      const saved = f.statePersistence.load(createRunId(c.runId));
      assert(saved);
      expect(saved.waitingContext?.reason).toBe('token_budget_exceeded');
      const restored = new LifecycleController(f);
      restored.restore(c, saved);
      await expect(restored.retry()).rejects.toThrow('use resume');
      const result = await restored.resume({ type: 'approval', content: 'extend budget' });
      if (phase === 'wait') {
        expect(result.finalState).toBe('WAITING_FOR_HUMAN');
        expect(restored.getState().waitingContext?.reason).toBe('waiting_for_human');
        expect(
          (await restored.resume({ type: 'approval', content: 'approve workflow' })).finalState,
        ).toBe('DONE');
      } else {
        expect(result.finalState).toBe('DONE');
      }
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
      expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeInputTokens).toBe(100);
      expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeOutputTokens).toBe(50);
    },
  );

  it('uses declared failure transitions and their guards when a wait entry action fails', async () => {
    const f = createFixture();
    const c = config();
    c.workflowDefinition.terminalStates = ['DONE', 'CUSTOM_FAILURE'];
    delete c.workflowDefinition.states['FAILED'];
    c.workflowDefinition.states['CUSTOM_FAILURE'] = {
      type: 'terminal',
      description: '',
      transitions: [],
    };
    c.workflowDefinition.states['WORK'].entryActions = [];
    c.workflowDefinition.states['WORK'].exitActions = [];
    c.workflowDefinition.states['WORK'].transitions[0].target = 'WAITING_FOR_HUMAN';
    c.workflowDefinition.states['WORK'].transitions[1].target = 'CUSTOM_FAILURE';
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'required', content: '{}' } },
    ];
    c.workflowDefinition.states['WAITING_FOR_HUMAN'].transitions = [
      {
        target: 'DONE',
        trigger: 'failure',
        guards: [{ type: 'artifact_exists', params: { artifactType: 'verification' } }],
        priority: 0,
        governanceRequired: false,
      },
      ...c.workflowDefinition.states['WAITING_FOR_HUMAN'].transitions,
      {
        target: 'CUSTOM_FAILURE',
        trigger: 'failure',
        guards: [],
        priority: 2,
        governanceRequired: false,
      },
    ];
    vi.mocked(f.artifactStore).store.mockRejectedValue(new Error('disk full'));
    expect((await new LifecycleController(f).start(c)).finalState).toBe('CUSTOM_FAILURE');
    expect(f.statePersistence.load(createRunId(c.runId))?.currentState).toBe('CUSTOM_FAILURE');
  });

  it('restores completed terminal actions from journal snapshots and does not repeat side effects', async () => {
    const f = createFixture();
    const c = config();
    vi.mocked(f.runner).dispatch.mockResolvedValue(workerResult('planner'));
    c.workflowDefinition.states['DONE'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'first', content: '{}' } },
      { type: 'store_artifact', params: { type: 'plan', name: 'second', content: '{}' } },
    ];
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(f.artifactStore).store.mockImplementationOnce(() => {
      now += 1000;
      return Promise.resolve(createArtifactRef('plan'));
    });
    try {
      await expect(
        new LifecycleController({ ...f, workflowTimeoutMs: 100 }).start(c),
      ).rejects.toThrow('timed out');
      const events = vi
        .mocked(f.journalWriter)
        .append.mock.calls.map(([event], index) => ({ ...event, sequence: index + 1 }));
      const rebuilt = new DefaultStatePersistence(
        '/private/tmp/terminal-replay-unused',
      ).reconstructFromJournal(createRunId(c.runId), events);
      assert(rebuilt);
      expect(rebuilt.pendingTerminalState).toBe('DONE');
      expect(rebuilt.entryActionContinuation?.nextActionIndex).toBe(1);
      const restored = new LifecycleController(f);
      restored.restore(c, rebuilt);
      expect((await restored.retry()).finalState).toBe('DONE');
      expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
        'first',
        'second',
      ]);
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
      expect(f.statePersistence.load(createRunId(c.runId))?.cumulativeInputTokens).toBe(10);
    } finally {
      clock.mockRestore();
    }
  });
});
