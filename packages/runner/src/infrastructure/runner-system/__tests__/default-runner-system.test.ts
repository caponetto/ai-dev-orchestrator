import type {
  AgentRunner,
  AgentSessionSupervisor,
  ArtifactStore,
  EventBus,
  PromptEngine,
  RoleRegistry,
} from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { AgentResult, Artifact } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { DefaultRunnerSystem } from '../default-runner-system';
import { resetWorkerCounter } from '../worker-spawner';

function makeArtifactStore(): ArtifactStore {
  return {
    store: vi.fn().mockResolvedValue({
      type: 'static_review',
      name: 'architect-output',
      version: 1,
      checksum: 'abc',
    }),
    get: vi.fn().mockResolvedValue({
      ref: { type: 'implementation', name: 'src-1', version: 1, checksum: 'abc' },
      type: 'implementation',
      name: 'src-1',
      version: 1,
      checksum: 'abc',
      content: 'const x = 1;',
      producedBy: 'developer',
      createdAt: '2024-01-01T00:00:00Z',
      sizeBytes: 12,
      metadata: {},
    } satisfies Artifact),
    getLatest: vi.fn(),
    list: vi.fn(),
    history: vi.fn(),
    verify: vi.fn(),
    inventory: vi.fn(),
  };
}

function makeRoleRegistry(): RoleRegistry {
  return {
    getRole: vi.fn().mockReturnValue({
      id: 'architect',
      name: 'architect',
      description: 'Reviews architecture',
      ownedArtifacts: ['static_review'],
      readableArtifacts: ['implementation'],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: [],
      dispatchType: 'agent',
      runner: 'cli',
      agentConfig: {},
    }),
    listRoles: vi.fn().mockReturnValue([]),
    getModelAssignment: vi.fn().mockReturnValue({
      roleId: 'architect',
      model: 'claude-3',
      maxTokens: 4096,
    }),
    getRecommendedModel: vi.fn().mockReturnValue({
      roleId: 'architect',
      model: 'claude-3',
      maxTokens: 4096,
    }),
    getNextTier: vi.fn().mockReturnValue(null),
    validate: vi.fn(),
  };
}

function makeMockAgentRunner() {
  return {
    dispatch: vi.fn().mockResolvedValue({
      taskId: 'task-1',
      status: 'success',
      artifactContent: '{"result": "ok"}',
      durationMs: 1000,
      tokenUsage: { inputTokens: 100, outputTokens: 50 },
    }),
  };
}

function makePromptEngine(): PromptEngine {
  return {
    render: vi.fn().mockResolvedValue({
      text: 'rendered prompt',
      templateRef: { role: 'architect', version: '1.0', source: 'built-in' },
      tokenEstimate: 50,
      truncations: [],
      outputContract: {
        role: 'architect',
        artifactType: 'static_review',
        schema: {},
        format: 'freeform',
        required: false,
        repairEnabled: false,
        maxRepairAttempts: 0,
      },
      metadata: {
        templateVersion: '1.0',
        resolvedFrom: 'architect.md',
        renderedAt: '2024-01-01T00:00:00Z',
        inputArtifactRefs: [],
        variablesUsed: [],
        partialsIncluded: [],
      },
    }),
    validateOutput: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    validateTemplate: vi.fn(),
  };
}

function makeEventBus(): EventBus {
  return {
    publish: vi.fn().mockReturnValue({
      id: 'evt-1',
      runId: createRunId('run-1'),
      sequence: 1,
      timestamp: '',
      type: 'worker.dispatched',
      data: {},
      source: 'runner_system',
    }),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    replay: vi.fn(),
  };
}

describe('DefaultRunnerSystem', () => {
  it('dispatches a worker and returns success result', async () => {
    const mockRunner = makeMockAgentRunner();
    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(result.status).toBe('success');
    expect(result.role).toBe('architect');
    expect(result.outputArtifacts).toHaveLength(1);
    expect(result.metrics.inputTokens).toBe(100);
    expect(result.metrics.outputTokens).toBe(50);
  });

  it('returns failure when role not found', async () => {
    const registry = makeRoleRegistry();
    (registry.getRole as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const runner = new DefaultRunnerSystem(
      makeArtifactStore(),
      registry,
      makePromptEngine(),
      makeEventBus(),
    );

    const result = await runner.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'unknown',
      inputArtifacts: [],
    });

    expect(result.status).toBe('failure');
    expect(result.error?.message).toContain('not found');
  });

  it('returns failure when agent runner errors', async () => {
    const mockRunner = makeMockAgentRunner();
    mockRunner.dispatch.mockResolvedValue({
      taskId: 'task-1',
      status: 'failure',
      error: 'Agent crashed',
      durationMs: 500,
    });

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(result.status).toBe('failure');
  });

  it('dispatches parallel workers', async () => {
    const mockRunner = makeMockAgentRunner();
    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    const results = await system.dispatchParallel([
      { runId: createRunId('run-1'), stateId: 'state-1', role: 'architect', inputArtifacts: [] },
      { runId: createRunId('run-1'), stateId: 'state-1', role: 'architect', inputArtifacts: [] },
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('tracks worker status', async () => {
    const mockRunner = makeMockAgentRunner();
    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(system.getWorkerStatus('nonexistent')).toBeNull();
  });

  it('cancels a worker by marking it failed', async () => {
    const mockRunner = makeMockAgentRunner();
    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    await expect(system.cancelWorker('nonexistent')).resolves.toBeUndefined();
  });

  it('agent dispatch emits lifecycle events and journal entries', async () => {
    const eventBus = makeEventBus();
    const journal = { append: vi.fn(), appendBatch: vi.fn() };
    const mockRunner = {
      dispatch: vi.fn().mockResolvedValue({
        taskId: 'task-1',
        status: 'success',
        artifactContent: '{"result": "ok"}',
        durationMs: 1000,
        tokenUsage: { inputTokens: 50, outputTokens: 25 },
      }),
    };
    const registry = makeRoleRegistry();
    (registry.getRole as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'implementer',
      name: 'implementer',
      description: 'Implements code',
      ownedArtifacts: ['implementation'],
      readableArtifacts: ['plan'],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: [],
      dispatchType: 'agent',
      runner: 'cli',
      agentConfig: {},
    });

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      registry,
      makePromptEngine(),
      eventBus,
      { journalWriter: journal, runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'IMPLEMENTATION',
      role: 'implementer',
      inputArtifacts: [],
    });

    expect(result.status).toBe('success');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const eventCalls = vi.mocked(eventBus.publish).mock.calls;
    const eventTypes = eventCalls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(eventTypes).toContain('worker.dispatched');
    expect(eventTypes).toContain('worker.completed');

    expect(journal.append).toHaveBeenCalled();
    const journalCall = vi.mocked(journal.append).mock.calls[0][0] as {
      type: string;
      data: { status: string; role: string };
    };
    expect(journalCall.type).toBe('worker_completed');
    expect(journalCall.data.role).toBe('implementer');
  });

  it('agent dispatch emits failed events on agent error', async () => {
    const eventBus = makeEventBus();
    const journal = { append: vi.fn(), appendBatch: vi.fn() };
    const mockRunner = {
      dispatch: vi.fn().mockResolvedValue({
        taskId: 'task-1',
        status: 'failure',
        error: 'Agent crashed',
        durationMs: 500,
      }),
    };
    const registry = makeRoleRegistry();
    (registry.getRole as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'implementer',
      name: 'implementer',
      description: 'Implements code',
      ownedArtifacts: ['implementation'],
      readableArtifacts: ['plan'],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: [],
      dispatchType: 'agent',
      runner: 'cli',
      agentConfig: {},
    });

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      registry,
      makePromptEngine(),
      eventBus,
      { journalWriter: journal, runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'IMPLEMENTATION',
      role: 'implementer',
      inputArtifacts: [],
    });

    expect(result.status).toBe('failure');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const eventCalls = vi.mocked(eventBus.publish).mock.calls;
    const eventTypes = eventCalls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(eventTypes).toContain('worker.dispatched');
    expect(eventTypes).toContain('worker.failed');

    expect(journal.append).toHaveBeenCalled();
    const journalCall = vi.mocked(journal.append).mock.calls[0][0] as {
      type: string;
      data: { status: string };
    };
    expect(journalCall.type).toBe('worker_failed');
  });

  it('emits events during dispatch', async () => {
    const eventBus = makeEventBus();
    const mockRunner = makeMockAgentRunner();
    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      eventBus,
      { runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(eventBus.publish).toHaveBeenCalled();
    const calls = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls;
    const eventTypes = calls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(eventTypes).toContain('worker.dispatched');
    expect(eventTypes).toContain('worker.completed');
  });

  it('cancelWorker aborts the AbortController of an active worker', async () => {
    resetWorkerCounter();
    let resolveRunner: ((value: AgentResult) => void) | undefined;
    const mockRunner = {
      dispatch: vi.fn().mockImplementation(
        () =>
          new Promise<AgentResult>((resolve) => {
            resolveRunner = resolve;
          }),
      ),
    };

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    const dispatchPromise = system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    // Wait for context assembly to complete so runner.dispatch is called
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(mockRunner.dispatch).toHaveBeenCalled();

    // Cancel the worker while its AbortController is still active
    await system.cancelWorker('worker-000001');

    const status = system.getWorkerStatus('worker-000001');
    expect(status).not.toBeNull();
    expect(status?.state).toBe('failed');

    // Resolve the pending runner dispatch to avoid hanging
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    resolveRunner!({
      taskId: 'task-1',
      status: 'success',
      artifactContent: '{"result": "ok"}',
      durationMs: 1000,
      tokenUsage: { inputTokens: 100, outputTokens: 50 },
    });

    await dispatchPromise;
  });

  it('cancelAllWorkers calls killAll on runners that support it', async () => {
    resetWorkerCounter();
    const mockRunner = {
      dispatch: vi.fn().mockResolvedValue({
        taskId: 'task-1',
        status: 'success',
        artifactContent: '{"result": "ok"}',
        durationMs: 1000,
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      }),
      killAll: vi.fn(),
    };

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: new Map<string, AgentRunner>([['cli', mockRunner]]) },
    );

    await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    await system.cancelAllWorkers();

    expect(mockRunner.killAll).toHaveBeenCalled();
  });

  it('returns retryable false when runner rejects with a non-Error value', async () => {
    resetWorkerCounter();
    const mockRunner = {
      dispatch: vi.fn().mockRejectedValue('plain string error'),
    };

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(result.status).toBe('failure');
    expect(result.error?.message).toBe('plain string error');
    expect(result.error?.retryable).toBe(false);
  });

  it('handleSessionResult returns awaiting_human when supervisor resolves with awaiting_human', async () => {
    resetWorkerCounter();
    const sessionRunner = {
      supportsResumableSessions: true as const,
      dispatch: vi.fn(),
      dispatchWithSession: vi.fn().mockResolvedValue({
        kind: 'session' as const,
        handle: {
          ref: {
            sessionId: 'sess-1',
            runId: 'run-1',
            stateId: 'state-1',
            role: 'architect',
            transport: 'stdio',
          },
          state: 'running',
          pendingRequests: [],
        },
      }),
    };

    const supervisor: AgentSessionSupervisor = {
      createSession: vi.fn(),
      attach: vi.fn(),
      sendHumanResponse: vi.fn(),
      pause: vi.fn(),
      abort: vi.fn(),
      finalize: vi.fn(),
      getSnapshot: vi.fn(),
      getState: vi.fn(),
      listByRun: vi.fn(),
      waitForAdvance: vi.fn().mockResolvedValue({
        kind: 'awaiting_human',
        pendingRequest: {
          requestId: 'req-1',
          kind: 'permission',
          createdAt: '2026-01-01T00:00:00Z',
          payload: { action: 'write_file' },
        },
      }),
    };

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      {
        runnerRegistry: new Map<string, AgentRunner>([['cli', sessionRunner]]),
        sessionSupervisor: supervisor,
      },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(result.status).toBe('success');
    expect(result.sessionOutcome).toBe('awaiting_human');
    expect(result.pendingRequest?.requestId).toBe('req-1');
    expect(result.sessionRef?.sessionId).toBe('sess-1');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(supervisor.waitForAdvance).toHaveBeenCalledWith('sess-1');
  });

  it('handleSessionResult returns completed with token usage from supervisor', async () => {
    resetWorkerCounter();
    const sessionRunner = {
      supportsResumableSessions: true as const,
      dispatch: vi.fn(),
      dispatchWithSession: vi.fn().mockResolvedValue({
        kind: 'session' as const,
        handle: {
          ref: {
            sessionId: 'sess-2',
            runId: 'run-1',
            stateId: 'state-1',
            role: 'architect',
            transport: 'stdio',
          },
          state: 'running',
          pendingRequests: [],
        },
      }),
    };

    const supervisor: AgentSessionSupervisor = {
      createSession: vi.fn(),
      attach: vi.fn(),
      sendHumanResponse: vi.fn(),
      pause: vi.fn(),
      abort: vi.fn(),
      finalize: vi.fn(),
      getSnapshot: vi.fn(),
      getState: vi.fn(),
      listByRun: vi.fn(),
      waitForAdvance: vi.fn().mockResolvedValue({
        kind: 'completed',
        artifactContent: '{"files": ["done.ts"]}',
        durationMs: 500,
        tokenUsage: { inputTokens: 150, outputTokens: 75 },
      }),
    };

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      {
        runnerRegistry: new Map<string, AgentRunner>([['cli', sessionRunner]]),
        sessionSupervisor: supervisor,
      },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(result.status).toBe('success');
    expect(result.sessionOutcome).toBe('completed');
    expect(result.outputArtifacts).toHaveLength(1);
    expect(result.metrics.inputTokens).toBe(150);
    expect(result.metrics.outputTokens).toBe(75);
    expect(result.sessionRef?.sessionId).toBe('sess-2');
  });

  it('handleSessionResult uses initial metrics when supervisor returns completed without tokenUsage', async () => {
    resetWorkerCounter();
    const sessionRunner = {
      supportsResumableSessions: true as const,
      dispatch: vi.fn(),
      dispatchWithSession: vi.fn().mockResolvedValue({
        kind: 'session' as const,
        handle: {
          ref: {
            sessionId: 'sess-3',
            runId: 'run-1',
            stateId: 'state-1',
            role: 'architect',
            transport: 'stdio',
          },
          state: 'running',
          pendingRequests: [],
        },
      }),
    };

    const supervisor: AgentSessionSupervisor = {
      createSession: vi.fn(),
      attach: vi.fn(),
      sendHumanResponse: vi.fn(),
      pause: vi.fn(),
      abort: vi.fn(),
      finalize: vi.fn(),
      getSnapshot: vi.fn(),
      getState: vi.fn(),
      listByRun: vi.fn(),
      waitForAdvance: vi.fn().mockResolvedValue({
        kind: 'completed',
        artifactContent: '{"files": ["done.ts"]}',
        durationMs: 500,
      }),
    };

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      {
        runnerRegistry: new Map<string, AgentRunner>([['cli', sessionRunner]]),
        sessionSupervisor: supervisor,
      },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(result.status).toBe('success');
    expect(result.sessionOutcome).toBe('completed');
    expect(result.outputArtifacts).toHaveLength(1);
    // Initial metrics have zero tokens since no token usage was provided
    expect(result.metrics.inputTokens).toBe(0);
    expect(result.metrics.outputTokens).toBe(0);
  });

  it('handleSessionResult returns session_active when supervisor returns unknown kind', async () => {
    resetWorkerCounter();
    const sessionRunner = {
      supportsResumableSessions: true as const,
      dispatch: vi.fn(),
      dispatchWithSession: vi.fn().mockResolvedValue({
        kind: 'session' as const,
        handle: {
          ref: {
            sessionId: 'sess-4',
            runId: 'run-1',
            stateId: 'state-1',
            role: 'architect',
            transport: 'stdio',
          },
          state: 'running',
          pendingRequests: [],
        },
      }),
    };

    const supervisor: AgentSessionSupervisor = {
      createSession: vi.fn(),
      attach: vi.fn(),
      sendHumanResponse: vi.fn(),
      pause: vi.fn(),
      abort: vi.fn(),
      finalize: vi.fn(),
      getSnapshot: vi.fn(),
      getState: vi.fn(),
      listByRun: vi.fn(),
      waitForAdvance: vi.fn().mockResolvedValue({
        kind: 'failed',
        error: 'session crashed',
      }),
    };

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      {
        runnerRegistry: new Map<string, AgentRunner>([['cli', sessionRunner]]),
        sessionSupervisor: supervisor,
      },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(result.status).toBe('success');
    expect(result.sessionOutcome).toBe('session_active');
    expect(result.sessionRef?.sessionId).toBe('sess-4');
    expect(result.outputArtifacts).toHaveLength(0);
  });

  it('dispatch catch block emits stderr stream event on context assembly error', async () => {
    resetWorkerCounter();
    const registry = makeRoleRegistry();
    (registry.getRole as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const streamEvents: Array<{ type: string; content: string }> = [];
    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      registry,
      makePromptEngine(),
      makeEventBus(),
    );

    const result = await system.dispatch(
      {
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'unknown',
        inputArtifacts: [],
      },
      (event) => {
        streamEvents.push({ type: event.type, content: event.content });
      },
    );

    expect(result.status).toBe('failure');
    const stderrEvent = streamEvents.find((e) => e.type === 'stderr');
    expect(stderrEvent).toBeDefined();
    expect(stderrEvent?.content).toContain('dispatch-error');
    expect(stderrEvent?.content).toContain('unknown');
  });

  it('passes agentConfig.model as modelHint to the runner', async () => {
    resetWorkerCounter();
    const registry = makeRoleRegistry();
    (registry.getRole as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'architect',
      name: 'architect',
      description: 'Reviews architecture',
      ownedArtifacts: ['static_review'],
      readableArtifacts: ['implementation'],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: [],
      dispatchType: 'agent',
      runner: 'cli',
      agentConfig: { model: 'custom-model' },
    });

    const mockRunner = makeMockAgentRunner();
    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      registry,
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    const taskArg = mockRunner.dispatch.mock.calls[0][0] as { modelHint?: string };
    expect(taskArg.modelHint).toBe('custom-model');
  });

  it('sets modelHint to undefined when modelAssignment.model is agent and no agentConfig.model', async () => {
    resetWorkerCounter();
    const registry = makeRoleRegistry();
    (registry.getModelAssignment as ReturnType<typeof vi.fn>).mockReturnValue({
      roleId: 'architect',
      model: 'agent',
      maxTokens: 4096,
    });
    (registry.getRecommendedModel as ReturnType<typeof vi.fn>).mockReturnValue({
      roleId: 'architect',
      model: 'agent',
      maxTokens: 4096,
    });

    const mockRunner = makeMockAgentRunner();
    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      registry,
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: new Map([['cli', mockRunner]]) },
    );

    await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    const taskArg = mockRunner.dispatch.mock.calls[0][0] as { modelHint?: string };
    expect(taskArg.modelHint).toBeUndefined();
  });
});
