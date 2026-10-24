/* eslint-disable @typescript-eslint/unbound-method -- Assertions inspect Vitest mock methods. */
import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultIterationContractRegistry } from '@ai-dev-orchestrator/governance';
import type { AgentSessionSupervisor, SessionAdvanceResult } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import { DefaultRoleRegistry } from '@ai-dev-orchestrator/role-system';
import type {
  DispatchResult,
  PersistedState,
  WorkflowRunConfig,
} from '@ai-dev-orchestrator/schemas';
import {
  createMockArtifactStore,
  createMockGovernance,
  createMockJournalWriter,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
  TEST_ROLES,
} from '@ai-dev-orchestrator/test-utils';
import { assert, describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../lifecycle-controller';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const artifactStore = createMockArtifactStore();
  const runner = createMockRunnerSystem({ artifactStore });
  const statePersistence = createMockStatePersistence();
  const c: WorkflowRunConfig = {
    runId: createRunId('async-boundaries'),
    sources: [],
    governancePolicy: {},
    roleAssignments: {},
    workflowDefinition: {
      name: 'async-boundaries',
      version: '1',
      initialState: 'WORK',
      terminalStates: ['DONE', 'FAILED', 'ABORTED'],
      states: {
        WORK: {
          type: 'action',
          description: '',
          entryActions: [
            { type: 'dispatch_worker', params: { role: 'planner' } },
            { type: 'store_artifact', params: { type: 'plan', name: 'after', content: '{}' } },
          ],
          transitions: [
            {
              target: 'DONE',
              trigger: 'completion',
              priority: 0,
              guards: [],
              governanceRequired: false,
            },
            {
              target: 'FAILED',
              trigger: 'failure',
              priority: 0,
              guards: [],
              governanceRequired: false,
            },
          ],
        },
        WAITING_FOR_HUMAN: { type: 'wait', description: '', transitions: [] },
        DONE: { type: 'terminal', description: '', transitions: [] },
        FAILED: { type: 'terminal', description: '', transitions: [] },
        ABORTED: { type: 'terminal', description: '', transitions: [] },
      },
    },
  };
  return {
    c,
    runner,
    artifactStore,
    statePersistence,
    journalWriter: createMockJournalWriter(),
    governanceEngine: createMockGovernance(),
    contractRegistry: new DefaultIterationContractRegistry(),
    manifestProducer: createMockManifestProducer(),
    roleRegistry: new DefaultRoleRegistry(TEST_ROLES, {
      assignments: {},
      defaultAssignment: { model: 'small' },
    }),
  };
}

function sessionFixture(role: 'planner' | 'plan_reviewer' = 'planner') {
  const f = fixture();
  const ref = {
    sessionId: 'session',
    runId: f.c.runId,
    stateId: 'WORK',
    role,
    transport: 'remote' as const,
  };
  const pending: DispatchResult = {
    workerId: 'worker',
    role,
    status: 'success',
    outputArtifacts: [],
    metrics: {
      startedAt: '',
      completedAt: '',
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      retryCount: 0,
      modelUsed: 'small',
    },
    sessionOutcome: 'awaiting_human',
    sessionRef: ref,
    pendingRequest: {
      requestId: 'permission',
      kind: 'permission',
      createdAt: '',
      payload: { action: 'read', resource: '.' },
    },
  };
  vi.mocked(f.runner).dispatch.mockResolvedValue(pending);
  const sessionSupervisor: AgentSessionSupervisor = {
    createSession: vi.fn(),
    attach: vi.fn().mockResolvedValue({ ref, state: 'awaiting_human', pendingRequests: [] }),
    sendHumanResponse: vi.fn().mockResolvedValue(true),
    waitForAdvance: vi.fn().mockResolvedValue({
      kind: 'completed',
      artifactContent: '{"summary":"finished"}',
      durationMs: 5,
      tokenUsage: { inputTokens: 30, outputTokens: 20 },
    }),
    pause: vi.fn(),
    abort: vi.fn(),
    finalize: vi.fn(),
    getSnapshot: vi.fn(),
    getState: vi.fn(),
    listByRun: vi.fn(),
  };
  return { ...f, sessionSupervisor, pending };
}

function manualPause() {
  return {
    reason: 'manual',
    requiredInput: 'approval' as const,
    requestingState: 'WORK',
    autoResumeSafe: true,
    presentedArtifacts: [],
    waitingSince: new Date().toISOString(),
  };
}

describe('session output interruption boundaries', () => {
  it('preserves a manual pause requested while awaiting session advancement', async () => {
    const f = sessionFixture();
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    const entered = deferred<undefined>();
    const release = deferred<SessionAdvanceResult>();
    vi.mocked(f.sessionSupervisor).waitForAdvance.mockImplementationOnce(() => {
      entered.resolve(undefined);
      return release.promise;
    });
    const completing = controller.resume({ type: 'approval', content: 'yes' });
    await entered.promise;
    await controller.pause(manualPause());
    release.resolve({
      kind: 'completed',
      artifactContent: '{"summary":"finished"}',
      durationMs: 5,
      tokenUsage: { inputTokens: 30, outputTokens: 20 },
    });
    expect((await completing).finalState).toBe('WAITING_FOR_HUMAN');
    const saved = f.statePersistence.load(createRunId(f.c.runId));
    expect(saved).toMatchObject({
      currentState: 'WAITING_FOR_HUMAN',
      executionPaused: true,
      waitingContext: { reason: 'manual', requestingState: 'WORK' },
      cumulativeInputTokens: 30,
      cumulativeOutputTokens: 20,
    });
    expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
      'planner-output',
    ]);
    assert(saved);
    const restored = new LifecycleController(f);
    restored.restore(f.c, saved);
    expect((await restored.resume({ type: 'approval', content: 'continue' })).finalState).toBe(
      'DONE',
    );
    expect(f.sessionSupervisor.sendHumanResponse).toHaveBeenCalledTimes(1);
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
    expect(f.statePersistence.load(createRunId(f.c.runId))?.cumulativeInputTokens).toBe(30);
  });

  it.each(['stored', 'failed'] as const)(
    'persists completed usage when abort arrives during %s artifact storage',
    async (outcome) => {
      const f = sessionFixture();
      const controller = new LifecycleController(f);
      await controller.start(f.c);
      const entered = deferred<undefined>();
      const release = deferred<undefined>();
      const store = vi.mocked(f.artifactStore).store.getMockImplementation();
      assert(store);
      vi.mocked(f.artifactStore).store.mockImplementationOnce(async (request) => {
        entered.resolve(undefined);
        await release.promise;
        if (outcome === 'failed') {
          throw new Error('storage unavailable');
        }
        return store(request);
      });
      const resuming = controller.resume({ type: 'approval', content: 'yes' });
      await entered.promise;
      await controller.abort('abort during storage');
      release.resolve(undefined);
      expect((await resuming).finalState).toBe('ABORTED');
      if (outcome === 'stored') {
        expect(f.artifactStore.stored.get('plan')?.content).toContain('finished');
      } else {
        expect(f.artifactStore.stored.has('plan')).toBe(false);
      }
      expect(f.statePersistence.load(createRunId(f.c.runId))).toMatchObject({
        currentState: 'ABORTED',
        cumulativeInputTokens: 30,
        cumulativeOutputTokens: 20,
      });
      const events = vi
        .mocked(f.journalWriter)
        .append.mock.calls.map(([event], i) => ({ ...event, sequence: i + 1 }));
      const replay = new DefaultStatePersistence(
        '/private/tmp/async-replay-unused',
      ).reconstructFromJournal(createRunId(f.c.runId), events);
      expect(replay).toMatchObject({
        currentState: 'ABORTED',
        cumulativeInputTokens: 30,
        cumulativeOutputTokens: 20,
      });
      expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
        'planner-output',
      ]);
      expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
      expect(
        events.filter(
          (event) => event.type === (outcome === 'stored' ? 'worker_completed' : 'worker_failed'),
        ),
      ).toHaveLength(1);
      expect(
        f.statePersistence.load(createRunId(f.c.runId))?.entryActionContinuation,
      ).toBeUndefined();
    },
  );

  it('settles output storage before immediate resume without another approval or charge', async () => {
    const f = sessionFixture();
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const store = vi.mocked(f.artifactStore).store.getMockImplementation();
    assert(store);
    vi.mocked(f.artifactStore).store.mockImplementationOnce(async (request) => {
      entered.resolve(undefined);
      await release.promise;
      return store(request);
    });
    const completing = controller.resume({ type: 'approval', content: 'yes' });
    await entered.promise;
    await controller.pause(manualPause());
    const continuing = controller.resume({ type: 'approval', content: 'continue' });
    expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(1);
    release.resolve(undefined);
    expect((await completing).finalState).toBe('WAITING_FOR_HUMAN');
    expect((await continuing).finalState).toBe('DONE');
    expect(f.statePersistence.load(createRunId(f.c.runId))).toMatchObject({
      cumulativeInputTokens: 30,
      cumulativeOutputTokens: 20,
    });
    expect(f.sessionSupervisor.sendHumanResponse).toHaveBeenCalledTimes(1);
    expect(f.runner.dispatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
      'planner-output',
      'after',
    ]);
  });

  it('keeps completed peer artifacts when abort interrupts dynamic aggregate storage', async () => {
    const f = sessionFixture('plan_reviewer');
    await f.artifactStore.store({
      type: 'plan',
      name: 'source',
      content: '{"tasks":[{"id":"A"},{"id":"B"}]}',
      producedBy: 'planner',
    });
    const peer = await f.artifactStore.store({
      type: 'plan_review',
      name: 'peer',
      content: '{"summary":"peer"}',
      producedBy: 'plan_reviewer',
    });
    f.c.workflowDefinition.states['WORK'].entryActions = [
      {
        type: 'dispatch_dynamic_workers',
        params: { role: 'plan_reviewer', sourceArtifact: 'plan', itemsPath: 'tasks' },
      },
      { type: 'store_artifact', params: { type: 'plan', name: 'after', content: '{}' } },
    ];
    vi.mocked(f.runner).dispatchParallel.mockResolvedValue([
      f.pending,
      {
        ...f.pending,
        sessionOutcome: 'completed',
        sessionRef: undefined,
        pendingRequest: undefined,
        outputArtifacts: [peer],
      },
    ]);
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const store = vi.mocked(f.artifactStore).store.getMockImplementation();
    assert(store);
    vi.mocked(f.artifactStore).store.mockImplementation(async (request) => {
      if (request.type === 'task_specifications') {
        entered.resolve(undefined);
        await release.promise;
      }
      return store(request);
    });
    const completing = controller.resume({ type: 'approval', content: 'yes' });
    await entered.promise;
    await controller.abort('cancel aggregate');
    release.resolve(undefined);
    expect((await completing).finalState).toBe('ABORTED');
    const aggregate = JSON.parse(
      f.artifactStore.stored.get('task_specifications')?.content ?? '{}',
    ) as { tasks: { taskId: string; specificationRef: typeof peer }[] };
    expect(aggregate.tasks).toHaveLength(2);
    expect(aggregate.tasks[1]).toEqual({ taskId: 'B', specificationRef: peer });
    expect(f.artifactStore.stored.get('plan_review')?.content).toContain('finished');
    expect(f.statePersistence.load(createRunId(f.c.runId))).toMatchObject({
      currentState: 'ABORTED',
      cumulativeInputTokens: 30,
      cumulativeOutputTokens: 20,
    });
    expect(f.runner.dispatchParallel).toHaveBeenCalledTimes(1);
    expect(f.runner.dispatch).not.toHaveBeenCalled();
    expect(
      vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name),
    ).not.toContain('after');
    expect(
      f.statePersistence.load(createRunId(f.c.runId))?.entryActionContinuation,
    ).toBeUndefined();
  });
});

describe('checkpoint and terminal interruption boundaries', () => {
  it('leaves failed abort cleanup retryable without automatically executing it again', async () => {
    const f = sessionFixture();
    f.c.workflowDefinition.terminalStates = ['DONE', 'ABORTED'];
    f.c.workflowDefinition.states['ABORTED'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'abort-cleanup', content: '{}' } },
    ];
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    const entered = deferred<undefined>();
    const release = deferred<SessionAdvanceResult>();
    vi.mocked(f.sessionSupervisor).waitForAdvance.mockImplementationOnce(() => {
      entered.resolve(undefined);
      return release.promise;
    });
    vi.mocked(f.artifactStore).store.mockRejectedValue(new Error('cleanup unavailable'));
    const resuming = controller.resume({ type: 'approval', content: 'yes' });
    const rejected = expect(resuming).rejects.toThrow('cleanup unavailable');
    await entered.promise;
    await controller.abort('cancel session');
    release.resolve({ kind: 'completed', artifactContent: '{}', durationMs: 0 });
    await rejected;
    expect(f.artifactStore.store).toHaveBeenCalledTimes(1);
    expect(f.statePersistence.load(createRunId(f.c.runId))).toMatchObject({
      pendingTerminalState: 'ABORTED',
      entryActionContinuation: {
        stateId: 'ABORTED',
        nextActionIndex: 1,
        completedResults: [{ success: false }],
      },
    });
    expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(2);
  });

  it('finishes abort cleanup when session I/O fails after cancellation has already committed', async () => {
    const f = sessionFixture();
    f.c.workflowDefinition.states['ABORTED'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'abort-cleanup', content: '{}' } },
    ];
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    vi.mocked(f.sessionSupervisor).waitForAdvance.mockImplementationOnce(async () => {
      entered.resolve(undefined);
      await release.promise;
      throw new Error('late session I/O failure');
    });
    const resuming = controller.resume({ type: 'approval', content: 'yes' });
    const rejected = expect(resuming).rejects.toThrow('late session I/O failure');
    await entered.promise;
    await controller.abort('cancel session');
    const releases = vi.mocked(f.statePersistence).releaseLock.mock.calls.length;
    release.resolve(undefined);
    await rejected;
    expect(releases).toBe(1);
    expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
      'abort-cleanup',
    ]);
    expect(f.statePersistence.load(createRunId(f.c.runId))).toMatchObject({
      currentState: 'ABORTED',
      pendingTerminalState: undefined,
    });
  });

  it('does not let a late pause overwrite an aborted run', async () => {
    const f = sessionFixture();
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    await controller.abort('stop');
    const saves = vi.mocked(f.statePersistence).save.mock.calls.length;
    await controller.pause(manualPause());
    expect(controller.getState().currentState).toBe('ABORTED');
    expect(f.statePersistence.load(createRunId(f.c.runId))?.currentState).toBe('ABORTED');
    expect(f.statePersistence.save).toHaveBeenCalledTimes(saves);
    const saved = f.statePersistence.load(createRunId(f.c.runId));
    assert(saved);
    const restored = new LifecycleController(f);
    restored.restore(f.c, saved);
    await restored.pause(manualPause());
    expect(restored.getState().currentState).toBe('ABORTED');
    expect(f.statePersistence.save).toHaveBeenCalledTimes(saves);
  });

  it('retains the lock until cancellation settles when an active checkpoint fails', async () => {
    const f = fixture();
    f.c.workflowDefinition.states['WORK'].entryActions = [];
    f.c.workflowDefinition.states['ABORTED'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'abort-cleanup', content: '{}' } },
    ];
    const entered = deferred<undefined>();
    const failSave = deferred<undefined>();
    const cancelEntered = deferred<undefined>();
    const failureJournalled = deferred<undefined>();
    const releaseCancel = deferred<undefined>();
    const save = vi.mocked(f.statePersistence).save.getMockImplementation();
    assert(save);
    vi.mocked(f.journalWriter).append.mockImplementation((event) => {
      if (event.type === 'error') {
        failureJournalled.resolve(undefined);
      }
    });
    let failFirst = true;
    vi.mocked(f.statePersistence).save.mockImplementation(async (state) => {
      if (failFirst) {
        failFirst = false;
        entered.resolve(undefined);
        await failSave.promise;
        throw new Error('checkpoint failed during abort');
      }
      if (state.currentState === 'ABORTED' || state.pendingTerminalState === 'ABORTED') {
        cancelEntered.resolve(undefined);
        await releaseCancel.promise;
      }
      await save(state);
    });
    const controller = new LifecycleController(f);
    const running = controller.start(f.c);
    const rejected = expect(running).rejects.toThrow('checkpoint failed during abort');
    await entered.promise;
    const aborting = controller.abort('cancel failed execution');
    failSave.resolve(undefined);
    await cancelEntered.promise;
    await failureJournalled.promise;
    const releasedDuringCancellation = vi.mocked(f.statePersistence).releaseLock.mock.calls.length;
    releaseCancel.resolve(undefined);
    await Promise.all([rejected, aborting]);
    expect(releasedDuringCancellation).toBe(0);
    expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(1);
    expect(f.statePersistence.load(createRunId(f.c.runId))?.currentState).toBe('ABORTED');
    expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
      'abort-cleanup',
    ]);
  });

  it('orders a pending pause save before abort so an older snapshot cannot overwrite cancellation', async () => {
    const f = sessionFixture();
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const save = vi.mocked(f.statePersistence).save.getMockImplementation();
    assert(save);
    let savesInFlight = 0;
    let maxSavesInFlight = 0;
    vi.mocked(f.statePersistence).save.mockImplementation(async (state) => {
      savesInFlight += 1;
      maxSavesInFlight = Math.max(maxSavesInFlight, savesInFlight);
      if (state.executionPaused) {
        entered.resolve(undefined);
        await release.promise;
      }
      await save(state);
      savesInFlight -= 1;
    });
    const pausing = controller.pause(manualPause());
    await entered.promise;
    const aborting = controller.abort('abort during save');
    release.resolve(undefined);
    await Promise.all([pausing, aborting]);
    expect(maxSavesInFlight).toBe(1);
    expect(f.statePersistence.load(createRunId(f.c.runId))?.currentState).toBe('ABORTED');
    expect(controller.getState().currentState).toBe('ABORTED');
    const events = vi
      .mocked(f.journalWriter)
      .append.mock.calls.map(([event], i) => ({ ...event, sequence: i + 1 }));
    expect(
      new DefaultStatePersistence('/private/tmp/async-replay-unused').reconstructFromJournal(
        createRunId(f.c.runId),
        events,
      )?.currentState,
    ).toBe('ABORTED');
  });

  it('allows the queued abort checkpoint to commit after the older pause save fails', async () => {
    const f = sessionFixture();
    const controller = new LifecycleController(f);
    await controller.start(f.c);
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const save = vi.mocked(f.statePersistence).save.getMockImplementation();
    assert(save);
    vi.mocked(f.statePersistence).save.mockImplementation(async (state) => {
      if (state.executionPaused) {
        entered.resolve(undefined);
        await release.promise;
        throw new Error('pause save failed');
      }
      await save(state);
    });
    const pausing = expect(controller.pause(manualPause())).rejects.toThrow('pause save failed');
    await entered.promise;
    const aborting = controller.abort('abort despite failed pause');
    release.resolve(undefined);
    await Promise.all([pausing, aborting]);
    expect(f.statePersistence.load(createRunId(f.c.runId))?.currentState).toBe('ABORTED');
    expect(f.statePersistence.releaseLock).toHaveBeenCalledTimes(2);
  });

  it('stops remaining success actions and runs abort cleanup after an in-flight terminal action', async () => {
    const f = fixture();
    f.c.workflowDefinition.states['WORK'].entryActions = [];
    f.c.workflowDefinition.states['DONE'].entryActions = ['started', 'must-not-run'].map(
      (name) => ({ type: 'store_artifact', params: { type: 'plan', name, content: '{}' } }),
    );
    f.c.workflowDefinition.states['ABORTED'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'abort-cleanup', content: '{}' } },
    ];
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const store = vi.mocked(f.artifactStore).store.getMockImplementation();
    assert(store);
    vi.mocked(f.artifactStore).store.mockImplementationOnce(async (request) => {
      entered.resolve(undefined);
      await release.promise;
      return store(request);
    });
    const controller = new LifecycleController(f);
    const running = controller.start(f.c);
    await entered.promise;
    await controller.abort('cancel success cleanup');
    release.resolve(undefined);
    expect((await running).finalState).toBe('ABORTED');
    expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
      'started',
      'abort-cleanup',
    ]);
    expect(f.statePersistence.load(createRunId(f.c.runId))).toMatchObject({
      currentState: 'ABORTED',
      pendingTerminalState: undefined,
      entryActionContinuation: undefined,
    });
    expect(
      vi
        .mocked(f.journalWriter)
        .append.mock.calls.some(([event]) => event.type === 'run_completed'),
    ).toBe(false);
  });

  it('does not start success cleanup after abort during its initial checkpoint', async () => {
    const f = fixture();
    f.c.workflowDefinition.states['WORK'].entryActions = [];
    f.c.workflowDefinition.states['DONE'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'success-cleanup', content: '{}' } },
    ];
    f.c.workflowDefinition.states['ABORTED'].entryActions = [
      { type: 'store_artifact', params: { type: 'plan', name: 'abort-cleanup', content: '{}' } },
    ];
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const save = vi.mocked(f.statePersistence).save.getMockImplementation();
    assert(save);
    let delayed = false;
    vi.mocked(f.statePersistence).save.mockImplementation(async (state: PersistedState) => {
      if (
        state.pendingTerminalState === 'DONE' &&
        state.entryActionContinuation?.stateId === 'DONE' &&
        !delayed
      ) {
        delayed = true;
        entered.resolve(undefined);
        await release.promise;
      }
      await save(state);
    });
    const controller = new LifecycleController(f);
    const running = controller.start(f.c);
    await entered.promise;
    const aborting = controller.abort('cancel before cleanup');
    release.resolve(undefined);
    await aborting;
    expect((await running).finalState).toBe('ABORTED');
    expect(vi.mocked(f.artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
      'abort-cleanup',
    ]);
    expect(f.statePersistence.load(createRunId(f.c.runId))?.currentState).toBe('ABORTED');
  });
});
