/* eslint-disable @typescript-eslint/unbound-method -- Inspect Vitest mock calls, never invoke unbound port methods. */
import type { AgentSessionSupervisor } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import { ShutdownCoordinator } from '@ai-dev-orchestrator/recovery';
import type {
  DispatchResult,
  SessionPendingRequest,
  WorkflowRunConfig,
} from '@ai-dev-orchestrator/schemas';
import {
  createMockArtifactStore,
  createMockContractRegistry,
  createMockGovernance,
  createMockJournalWriter,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
} from '@ai-dev-orchestrator/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../lifecycle-controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const config: WorkflowRunConfig = {
  runId: 'shutdown',
  governancePolicy: {},
  roleAssignments: {},
  sources: [],
  workflowDefinition: {
    name: 'shutdown',
    version: '1',
    initialState: 'WORK',
    terminalStates: ['DONE', 'FAILED', 'ABORTED'],
    states: {
      WORK: {
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
      },
      WAITING_FOR_HUMAN: { type: 'wait', description: '', transitions: [] },
      DONE: { type: 'terminal', description: '', transitions: [] },
      FAILED: { type: 'terminal', description: '', transitions: [] },
      ABORTED: { type: 'terminal', description: '', transitions: [] },
    },
  },
};
function result(): DispatchResult {
  return {
    workerId: 'worker',
    role: 'planner',
    status: 'success',
    outputArtifacts: [],
    metrics: {
      startedAt: '',
      completedAt: '',
      durationMs: 1,
      inputTokens: 0,
      outputTokens: 0,
      retryCount: 0,
      modelUsed: 'test',
    },
  };
}
function fixture(supervisor?: AgentSessionSupervisor) {
  const artifactStore = createMockArtifactStore();
  const runner = createMockRunnerSystem({ artifactStore });
  const statePersistence = createMockStatePersistence();
  const journalWriter = createMockJournalWriter();
  const coordinator = new ShutdownCoordinator(statePersistence, journalWriter);
  const engine = new LifecycleController({
    runner,
    artifactStore,
    statePersistence,
    journalWriter,
    shutdownCoordinator: coordinator,
    sessionSupervisor: supervisor,
    governanceEngine: createMockGovernance(),
    contractRegistry: createMockContractRegistry(),
    manifestProducer: createMockManifestProducer(),
  });
  return { engine, runner, coordinator, statePersistence, journalWriter, artifactStore };
}
describe('workflow shutdown ownership', () => {
  it('returns ABORTED without dispatch when shutdown was already requested', async () => {
    const f = fixture();
    f.coordinator.requestShutdown('signal');
    expect((await f.engine.start(config)).finalState).toBe('ABORTED');
    expect(f.runner.dispatch).not.toHaveBeenCalled();
    expect(f.statePersistence.load(createRunId('shutdown'))?.currentState).toBe('ABORTED');
    expect(f.statePersistence.releaseLock).toHaveBeenCalledOnce();
  });
  it.each([true, false])(
    'reports interruption when dispatch resolves/rejects during cancellation (resolve=%s)',
    async (resolve) => {
      const f = fixture();
      const dispatched = deferred<DispatchResult>();
      vi.mocked(f.runner.dispatch).mockReturnValueOnce(dispatched.promise);
      vi.mocked(f.runner.cancelAllWorkers).mockImplementationOnce(async () => {
        await Promise.resolve();
        if (resolve) {
          dispatched.resolve({ ...result(), status: 'failure', error: 'cancelled' });
        } else {
          dispatched.reject(new Error('worker interrupted'));
        }
      });
      const execution = f.engine.start(config);
      await vi.waitFor(() => {
        expect(f.runner.dispatch).toHaveBeenCalledOnce();
      });
      f.coordinator.requestShutdown('signal');
      f.coordinator.requestShutdown('signal');
      expect((await execution).finalState).toBe('ABORTED');
      expect(f.runner.cancelAllWorkers).toHaveBeenCalledOnce();
      expect(f.statePersistence.releaseLock).toHaveBeenCalledOnce();
    },
  );
  it('retains the lock while a cancelled dispatch is still executing', async () => {
    const f = fixture();
    const dispatched = deferred<DispatchResult>();
    vi.mocked(f.runner.dispatch).mockReturnValueOnce(dispatched.promise);
    const execution = f.engine.start(config);
    await vi.waitFor(() => {
      expect(f.runner.dispatch).toHaveBeenCalledOnce();
    });
    f.coordinator.requestShutdown('signal');
    await vi.waitFor(() => {
      expect(f.statePersistence.load(createRunId('shutdown'))?.currentState).toBe('ABORTED');
    });
    expect(f.statePersistence.releaseLock).not.toHaveBeenCalled();
    dispatched.resolve(result());
    expect((await execution).finalState).toBe('ABORTED');
    expect(f.statePersistence.releaseLock).toHaveBeenCalledOnce();
  });
  it('does not rewrite DONE or cancel workers after execution has finished', async () => {
    const f = fixture();
    vi.mocked(f.runner.dispatch).mockResolvedValueOnce(result());
    expect((await f.engine.start(config)).finalState).toBe('DONE');
    f.coordinator.requestShutdown('signal');
    expect(f.runner.cancelAllWorkers).not.toHaveBeenCalled();
    expect(f.statePersistence.load(createRunId('shutdown'))?.currentState).toBe('DONE');
  });
  it('preserves completion when a signal arrives during the DONE checkpoint', async () => {
    const f = fixture();
    const saving = deferred<undefined>();
    vi.mocked(f.runner.dispatch).mockResolvedValueOnce(result());
    vi.mocked(f.statePersistence.save).mockImplementationOnce(() => saving.promise);
    const execution = f.engine.start(config);
    await vi.waitFor(() => {
      expect(f.statePersistence.save).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(f.statePersistence.save).mock.calls[0]?.[0].currentState).toBe('DONE');
    f.coordinator.requestShutdown('signal');
    expect(f.runner.cancelAllWorkers).not.toHaveBeenCalled();
    saving.resolve(undefined);
    expect((await execution).finalState).toBe('DONE');
    expect(f.statePersistence.releaseLock).toHaveBeenCalledOnce();
  });
  it('propagates persistence failure instead of reporting a successful shutdown', async () => {
    const f = fixture();
    const dispatched = deferred<DispatchResult>();
    vi.mocked(f.runner.dispatch).mockReturnValueOnce(dispatched.promise);
    const execution = f.engine.start(config);
    const rejected = expect(execution).rejects.toThrow('disk unavailable');
    await vi.waitFor(() => {
      expect(f.runner.dispatch).toHaveBeenCalledOnce();
    });
    vi.mocked(f.statePersistence.save).mockRejectedValue(new Error('disk unavailable'));
    f.coordinator.requestShutdown('signal');
    dispatched.resolve(result());
    await rejected;
    expect(f.statePersistence.releaseLock).toHaveBeenCalledOnce();
  });
  it('does not hide a failed abort-cleanup checkpoint behind an interruption result', async () => {
    const f = fixture();
    const dispatched = deferred<DispatchResult>();
    vi.mocked(f.runner.dispatch).mockReturnValueOnce(dispatched.promise);
    const save = vi.mocked(f.statePersistence.save).getMockImplementation();
    vi.mocked(f.statePersistence.save).mockImplementation((state) => {
      if (state.entryActionContinuation?.stateId === 'ABORTED') {
        return Promise.reject(new Error('cleanup checkpoint failed'));
      }
      return save?.(state) ?? Promise.resolve();
    });
    const cleanup: WorkflowRunConfig = {
      ...config,
      workflowDefinition: {
        ...config.workflowDefinition,
        states: {
          ...config.workflowDefinition.states,
          ABORTED: {
            type: 'terminal',
            description: '',
            transitions: [],
            entryActions: [
              { type: 'store_artifact', params: { type: 'plan', name: 'cleanup', content: '{}' } },
            ],
          },
        },
      },
    };
    const execution = f.engine.start(cleanup);
    const rejected = expect(execution).rejects.toThrow('cleanup checkpoint failed');
    await vi.waitFor(() => {
      expect(f.runner.dispatch).toHaveBeenCalledOnce();
    });
    f.coordinator.requestShutdown('signal');
    dispatched.resolve(result());
    await rejected;
    expect(f.statePersistence.releaseLock).toHaveBeenCalledOnce();
  });
  it.each([true, false, 'reject'] as const)(
    'unsubscribes idle waits and cancels resumed session advancement (resume=%s)',
    async (resume) => {
      const advance = deferred<{ kind: 'failed'; error: string }>();
      const ref = {
        runId: 'shutdown',
        sessionId: 'session',
        stateId: 'WORK',
        role: 'planner',
        transport: 'remote',
      } as const;
      const pending: SessionPendingRequest = {
        requestId: 'request',
        kind: 'permission',
        createdAt: '',
        payload: {},
      };
      const abort = vi.fn().mockImplementation(async () => {
        await Promise.resolve();
        if (resume === 'reject') {
          advance.reject(new Error('session interrupted'));
        } else {
          advance.resolve({ kind: 'failed', error: 'interrupted' });
        }
        return true;
      });
      const supervisor = {
        attach: vi
          .fn()
          .mockResolvedValue({ ref, state: 'awaiting_human', pendingRequests: [pending] }),
        waitForAdvance: vi.fn(() => advance.promise),
        sendHumanResponse: vi.fn().mockResolvedValue(true),
        abort,
        listByRun: vi.fn().mockResolvedValue([{ ref, state: 'running' }]),
      } as unknown as AgentSessionSupervisor;
      const f = fixture(supervisor);
      vi.mocked(f.runner.dispatch).mockResolvedValueOnce({
        ...result(),
        sessionOutcome: 'awaiting_human',
        sessionRef: ref,
        pendingRequest: pending,
      });
      expect((await f.engine.start(config)).finalState).toBe('WAITING_FOR_HUMAN');
      if (!resume) {
        f.coordinator.requestShutdown('signal');
        expect(f.runner.cancelAllWorkers).not.toHaveBeenCalled();
        expect(abort).not.toHaveBeenCalled();
        return;
      }
      const execution = f.engine.resume({
        type: 'approval',
        sessionId: 'session',
        requestId: 'request',
      });
      await vi.waitFor(() => {
        expect(supervisor.waitForAdvance).toHaveBeenCalledOnce();
      });
      f.coordinator.requestShutdown('signal');
      expect((await execution).finalState).toBe('ABORTED');
      expect(abort).toHaveBeenCalledExactlyOnceWith('session', 'shutdown:signal');
      expect(f.runner.cancelAllWorkers).toHaveBeenCalledOnce();
      expect(f.statePersistence.load(createRunId('shutdown'))?.waitingContext).toBeUndefined();
    },
  );
});
