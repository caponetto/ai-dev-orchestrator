import type {
  AgentRunner,
  ArtifactStore,
  EventBus,
  JournalWriter,
  PromptEngine,
  ProvenanceTracker,
  RoleRegistry,
} from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { Artifact, JournalEvent } from '@ai-dev-orchestrator/schemas';
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

function makePromptEngine(repairEnabled = false): PromptEngine {
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
        repairEnabled,
        maxRepairAttempts: repairEnabled ? 3 : 0,
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

function makeProvenanceTracker(): ProvenanceTracker {
  return {
    recordDerivation: vi.fn(),
    getInputs: vi.fn().mockReturnValue([]),
    getOutputs: vi.fn().mockReturnValue([]),
    getProvenanceChain: vi.fn().mockReturnValue({ artifact: {}, inputs: [] }),
    allRecords: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
  };
}

function makeJournalWriter(): JournalWriter {
  return {
    append: vi.fn(),
    appendBatch: vi.fn(),
  };
}

function makeDefaultAgentRunner() {
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

function defaultRunnerRegistry() {
  return new Map<string, AgentRunner>([['cli', makeDefaultAgentRunner()]]);
}

describe('Sprint 12 Runner System Enhancements', () => {
  it('records provenance after successful dispatch', async () => {
    resetWorkerCounter();
    const provenance = makeProvenanceTracker();
    const inputRef = {
      type: 'implementation' as const,
      name: 'src-1',
      version: 1,
      checksum: 'abc',
    };

    const runner = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { provenanceTracker: provenance, runnerRegistry: defaultRunnerRegistry() },
    );

    await runner.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [inputRef],
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provenance.recordDerivation).toHaveBeenCalledTimes(1);
    const call = (provenance.recordDerivation as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toEqual({
      type: 'static_review',
      name: 'architect-output',
      version: 1,
      checksum: 'abc',
    });
    expect(call[1]).toEqual([inputRef]);
  });

  it('does not record provenance on failure', async () => {
    resetWorkerCounter();
    const provenance = makeProvenanceTracker();
    const failRunner = makeDefaultAgentRunner();
    failRunner.dispatch.mockResolvedValue({
      taskId: 'task-1',
      status: 'failure',
      error: 'Agent crashed',
      durationMs: 500,
    });

    const runner = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { provenanceTracker: provenance, runnerRegistry: new Map([['cli', failRunner]]) },
    );

    await runner.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provenance.recordDerivation).not.toHaveBeenCalled();
  });

  it('writes journal entry on successful dispatch', async () => {
    resetWorkerCounter();
    const journal = makeJournalWriter();

    const runner = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { journalWriter: journal, runnerRegistry: defaultRunnerRegistry() },
    );

    await runner.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(journal.append).toHaveBeenCalledTimes(1);
    const event = (journal.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as JournalEvent;
    expect(event.type).toBe('worker_completed');
    expect(event.data).toMatchObject({ kind: 'worker', status: 'success' });
  });

  it('writes journal entry on failed dispatch', async () => {
    resetWorkerCounter();
    const journal = makeJournalWriter();
    const failRunner = makeDefaultAgentRunner();
    failRunner.dispatch.mockResolvedValue({
      taskId: 'task-1',
      status: 'failure',
      error: 'Agent crashed',
      durationMs: 500,
    });

    const runner = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { journalWriter: journal, runnerRegistry: new Map([['cli', failRunner]]) },
    );

    await runner.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(journal.append).toHaveBeenCalledTimes(1);
    const event = (journal.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as JournalEvent;
    expect(event.type).toBe('worker_failed');
    expect(event.data).toMatchObject({ status: 'failure' });
  });

  it('respects maxConcurrency option for parallel dispatch', async () => {
    resetWorkerCounter();
    let activeCount = 0;
    let maxActive = 0;

    const concurrencyRunner = makeDefaultAgentRunner();
    concurrencyRunner.dispatch.mockImplementation(async () => {
      activeCount += 1;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise((r) => {
        setTimeout(r, 10);
      });
      activeCount -= 1;
      return {
        taskId: 'task-1',
        status: 'success',
        artifactContent: '{"result": "ok"}',
        durationMs: 10,
        tokenUsage: { inputTokens: 10, outputTokens: 5 },
      };
    });

    const runner = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { maxConcurrency: 2, runnerRegistry: new Map([['cli', concurrencyRunner]]) },
    );

    const requests = Array.from({ length: 4 }, () => ({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    }));

    const results = await runner.dispatchParallel(requests);

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === 'success')).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('works without optional dependencies (except runner registry)', async () => {
    resetWorkerCounter();
    const runner = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: defaultRunnerRegistry() },
    );

    const result = await runner.dispatch({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(result.status).toBe('success');
  });

  describe('agent dispatch', () => {
    function makeAgentRoleRegistry(): RoleRegistry {
      return {
        getRole: vi.fn().mockReturnValue({
          id: 'implementer',
          name: 'implementer',
          description: 'Implements code',
          ownedArtifacts: ['implementation'],
          readableArtifacts: ['plan'],
          forbiddenArtifacts: [],
          reviewedBy: ['static_reviewer'],
          reviews: [],
          agreementParticipation: [],
          requiredCapabilities: [],
          dispatchType: 'agent',
          runner: 'claude-code',
        }),
        listRoles: vi.fn().mockReturnValue([]),
        getModelAssignment: vi.fn().mockReturnValue({
          roleId: 'implementer',
          model: 'claude-3',
          maxTokens: 4096,
        }),
        validate: vi.fn(),
      };
    }

    function makeAgentPromptEngine(): PromptEngine {
      return {
        render: vi.fn().mockResolvedValue({
          text: 'rendered prompt',
          templateRef: { role: 'implementer', version: '1.0', source: 'built-in' },
          tokenEstimate: 50,
          truncations: [],
          outputContract: {
            role: 'implementer',
            artifactType: 'implementation',
            schema: {},
            format: 'json',
            required: true,
            repairEnabled: false,
            maxRepairAttempts: 0,
          },
          metadata: {
            templateVersion: '1.0',
            resolvedFrom: 'implementer.md',
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

    function makeAgentArtifactStore(): ArtifactStore {
      return {
        store: vi.fn().mockResolvedValue({
          type: 'implementation',
          name: 'implementer-output',
          version: 1,
          checksum: 'def',
        }),
        get: vi.fn().mockResolvedValue({
          ref: { type: 'plan', name: 'plan-1', version: 1, checksum: 'abc' },
          type: 'plan',
          name: 'plan-1',
          version: 1,
          checksum: 'abc',
          content: 'implement feature X',
          producedBy: 'planner',
          createdAt: '2024-01-01T00:00:00Z',
          sizeBytes: 19,
          metadata: {},
        } satisfies Artifact),
        getLatest: vi.fn(),
        list: vi.fn(),
        history: vi.fn(),
        verify: vi.fn(),
        inventory: vi.fn(),
      };
    }

    function makeMockRunner(
      result?: Partial<ReturnType<AgentRunner['dispatch']> extends Promise<infer R> ? R : never>,
    ): AgentRunner {
      return {
        dispatch: vi.fn().mockResolvedValue({
          taskId: 'worker-1',
          status: 'success',
          artifactContent: '{"files": ["src/index.ts"]}',
          durationMs: 5000,
          tokenUsage: { inputTokens: 200, outputTokens: 100 },
          ...result,
        }),
      };
    }

    it('dispatches to agent runner when role has dispatchType agent', async () => {
      resetWorkerCounter();
      const mockRunner = makeMockRunner();
      const registry = new Map<string, AgentRunner>([['claude-code', mockRunner]]);

      const runner = new DefaultRunnerSystem(
        makeAgentArtifactStore(),
        makeAgentRoleRegistry(),
        makeAgentPromptEngine(),
        makeEventBus(),
        { runnerRegistry: registry, repoRoot: '/repo', runDir: '.ai/runs' },
      );

      const result = await runner.dispatch({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'implementer',
        inputArtifacts: [],
      });

      expect(result.status).toBe('success');
      expect(result.outputArtifacts).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockRunner.dispatch).toHaveBeenCalledTimes(1);
    });

    it('returns failure when agent returns non-success status', async () => {
      resetWorkerCounter();
      const mockRunner = makeMockRunner({
        status: 'failure',
        artifactContent: undefined,
        error: 'Agent crashed',
      });
      const registry = new Map<string, AgentRunner>([['claude-code', mockRunner]]);

      const runner = new DefaultRunnerSystem(
        makeAgentArtifactStore(),
        makeAgentRoleRegistry(),
        makeAgentPromptEngine(),
        makeEventBus(),
        { runnerRegistry: registry },
      );

      const result = await runner.dispatch({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'implementer',
        inputArtifacts: [],
      });

      expect(result.status).toBe('failure');
      expect(result.error?.message).toBe('Agent crashed');
    });

    it('returns timeout status when agent times out', async () => {
      resetWorkerCounter();
      const mockRunner = makeMockRunner({
        status: 'timeout',
        artifactContent: undefined,
        error: 'Exceeded 60s timeout',
      });
      const registry = new Map<string, AgentRunner>([['claude-code', mockRunner]]);

      const runner = new DefaultRunnerSystem(
        makeAgentArtifactStore(),
        makeAgentRoleRegistry(),
        makeAgentPromptEngine(),
        makeEventBus(),
        { runnerRegistry: registry },
      );

      const result = await runner.dispatch({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'implementer',
        inputArtifacts: [],
      });

      expect(result.status).toBe('timeout');
      expect(result.error?.type).toBe('timeout');
    });

    it('throws WorkerDispatchError when runner key is not registered', async () => {
      resetWorkerCounter();
      const runner = new DefaultRunnerSystem(
        makeAgentArtifactStore(),
        makeAgentRoleRegistry(),
        makeAgentPromptEngine(),
        makeEventBus(),
        { runnerRegistry: new Map() },
      );

      const result = await runner.dispatch({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'implementer',
        inputArtifacts: [],
      });

      expect(result.status).toBe('failure');
      expect(result.error?.message).toContain('No runner registered');
    });

    it('returns failure when agent output fails validation', async () => {
      resetWorkerCounter();
      const mockRunner = makeMockRunner({ artifactContent: 'invalid json' });
      const registry = new Map<string, AgentRunner>([['claude-code', mockRunner]]);

      const engine = makeAgentPromptEngine();
      (engine.render as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: 'rendered prompt',
        templateRef: { role: 'implementer', version: '1.0', source: 'built-in' },
        tokenEstimate: 50,
        truncations: [],
        outputContract: {
          role: 'implementer',
          artifactType: 'implementation',
          schema: { type: 'object', properties: { files: { type: 'array' } }, required: ['files'] },
          format: 'json',
          required: true,
          repairEnabled: false,
          maxRepairAttempts: 0,
        },
        metadata: {
          templateVersion: '1.0',
          resolvedFrom: 'implementer.md',
          renderedAt: '2024-01-01T00:00:00Z',
          inputArtifactRefs: [],
          variablesUsed: [],
          partialsIncluded: [],
        },
      });
      (engine.validateOutput as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: false,
        errors: [{ path: '/files', message: 'required', expected: 'array', actual: 'undefined' }],
      });

      const runner = new DefaultRunnerSystem(
        makeAgentArtifactStore(),
        makeAgentRoleRegistry(),
        engine,
        makeEventBus(),
        { runnerRegistry: registry },
      );

      const result = await runner.dispatch({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'implementer',
        inputArtifacts: [],
      });

      expect(result.status).toBe('failure');
      expect(result.error?.type).toBe('invalid_output');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(engine.validateOutput).toHaveBeenCalledWith(
        'invalid json',
        expect.objectContaining({ format: 'json' }),
      );
    });

    it('passes template output format into validateOutput', async () => {
      resetWorkerCounter();
      const mockRunner = makeMockRunner({ artifactContent: '---\napproved: true\n---\n' });
      const registry = new Map<string, AgentRunner>([['claude-code', mockRunner]]);

      const engine = makeAgentPromptEngine();
      (engine.render as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: 'rendered prompt',
        templateRef: { role: 'implementer', version: '1.0', source: 'built-in' },
        tokenEstimate: 50,
        truncations: [],
        outputContract: {
          role: 'implementer',
          artifactType: 'implementation',
          schema: { type: 'object', properties: { approved: { type: 'boolean' } } },
          format: 'markdown_with_frontmatter',
          required: true,
          repairEnabled: false,
          maxRepairAttempts: 0,
        },
        metadata: {
          templateVersion: '1.0',
          resolvedFrom: 'implementer.md',
          renderedAt: '2024-01-01T00:00:00Z',
          inputArtifactRefs: [],
          variablesUsed: [],
          partialsIncluded: [],
        },
      });
      (engine.validateOutput as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: true,
        errors: [],
      });

      const runner = new DefaultRunnerSystem(
        makeAgentArtifactStore(),
        makeAgentRoleRegistry(),
        engine,
        makeEventBus(),
        { runnerRegistry: registry },
      );

      await runner.dispatch({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'implementer',
        inputArtifacts: [],
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(engine.validateOutput).toHaveBeenCalledWith(
        '---\napproved: true\n---\n',
        expect.objectContaining({ format: 'markdown_with_frontmatter' }),
      );
    });

    it('emits failed metrics when agent output fails validation', async () => {
      resetWorkerCounter();
      const mockRunner = makeMockRunner({ artifactContent: 'invalid json' });
      const registry = new Map<string, AgentRunner>([['claude-code', mockRunner]]);
      const eventBus = makeEventBus();

      const engine = makeAgentPromptEngine();
      (engine.render as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: 'rendered prompt',
        templateRef: { role: 'implementer', version: '1.0', source: 'built-in' },
        tokenEstimate: 50,
        truncations: [],
        outputContract: {
          role: 'implementer',
          artifactType: 'implementation',
          schema: { type: 'object', properties: { files: { type: 'array' } }, required: ['files'] },
          format: 'json',
          required: true,
          repairEnabled: false,
          maxRepairAttempts: 0,
        },
        metadata: {
          templateVersion: '1.0',
          resolvedFrom: 'implementer.md',
          renderedAt: '2024-01-01T00:00:00Z',
          inputArtifactRefs: [],
          variablesUsed: [],
          partialsIncluded: [],
        },
      });
      (engine.validateOutput as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: false,
        errors: [{ path: '/files', message: 'required', expected: 'array', actual: 'undefined' }],
      });

      const runner = new DefaultRunnerSystem(
        makeAgentArtifactStore(),
        makeAgentRoleRegistry(),
        engine,
        eventBus,
        { runnerRegistry: registry },
      );

      await runner.dispatch({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'implementer',
        inputArtifacts: [],
      });

      const publishCalls = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls;
      const failedEvent = publishCalls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'worker.failed',
      );
      expect(failedEvent).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect((failedEvent![0] as { data: { errorCategory: string } }).data.errorCategory).toBe(
        'validation_error',
      );
    });

    it('writes worker_failed journal entry when agent output fails validation', async () => {
      resetWorkerCounter();
      const mockRunner = makeMockRunner({ artifactContent: 'invalid json' });
      const registry = new Map<string, AgentRunner>([['claude-code', mockRunner]]);
      const journal = makeJournalWriter();

      const engine = makeAgentPromptEngine();
      (engine.render as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: 'rendered prompt',
        templateRef: { role: 'implementer', version: '1.0', source: 'built-in' },
        tokenEstimate: 50,
        truncations: [],
        outputContract: {
          role: 'implementer',
          artifactType: 'implementation',
          schema: { type: 'object', properties: { files: { type: 'array' } }, required: ['files'] },
          format: 'json',
          required: true,
          repairEnabled: false,
          maxRepairAttempts: 0,
        },
        metadata: {
          templateVersion: '1.0',
          resolvedFrom: 'implementer.md',
          renderedAt: '2024-01-01T00:00:00Z',
          inputArtifactRefs: [],
          variablesUsed: [],
          partialsIncluded: [],
        },
      });
      (engine.validateOutput as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: false,
        errors: [{ path: '/files', message: 'required', expected: 'array', actual: 'undefined' }],
      });

      const runner = new DefaultRunnerSystem(
        makeAgentArtifactStore(),
        makeAgentRoleRegistry(),
        engine,
        makeEventBus(),
        { runnerRegistry: registry, journalWriter: journal },
      );

      await runner.dispatch({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'implementer',
        inputArtifacts: [],
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(journal.append).toHaveBeenCalledTimes(1);
      const event = (journal.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as JournalEvent;
      expect(event.type).toBe('worker_failed');
      expect(event.data).toMatchObject({ status: 'failure', error: '/files: required' });
    });

    it('emits stream event when agent output fails validation', async () => {
      resetWorkerCounter();
      const mockRunner = makeMockRunner({ artifactContent: 'invalid json' });
      const registry = new Map<string, AgentRunner>([['claude-code', mockRunner]]);
      const streamEvents: Array<{ type: string; content: string }> = [];

      const engine = makeAgentPromptEngine();
      (engine.render as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: 'rendered prompt',
        templateRef: { role: 'implementer', version: '1.0', source: 'built-in' },
        tokenEstimate: 50,
        truncations: [],
        outputContract: {
          role: 'implementer',
          artifactType: 'implementation',
          schema: { type: 'object', properties: { files: { type: 'array' } }, required: ['files'] },
          format: 'json',
          required: true,
          repairEnabled: false,
          maxRepairAttempts: 0,
        },
        metadata: {
          templateVersion: '1.0',
          resolvedFrom: 'implementer.md',
          renderedAt: '2024-01-01T00:00:00Z',
          inputArtifactRefs: [],
          variablesUsed: [],
          partialsIncluded: [],
        },
      });
      (engine.validateOutput as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: false,
        errors: [{ path: '/files', message: 'required', expected: 'array', actual: 'undefined' }],
      });

      const runner = new DefaultRunnerSystem(
        makeAgentArtifactStore(),
        makeAgentRoleRegistry(),
        engine,
        makeEventBus(),
        { runnerRegistry: registry },
      );

      await runner.dispatch(
        {
          runId: createRunId('run-1'),
          stateId: 'state-1',
          role: 'implementer',
          inputArtifacts: [],
        },
        (event) => {
          streamEvents.push(event);
        },
      );

      const errorEvent = streamEvents.find((e) => e.type === 'stderr');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.content).toContain('[output-validation-error]');
      expect(errorEvent?.content).toContain('role=implementer');
      expect(errorEvent?.content).toContain('/files: required');
    });

    it('emits stream event when agent result is not success', async () => {
      resetWorkerCounter();
      const mockRunner = makeMockRunner({ status: 'failure', error: 'agent crashed' });
      const registry = new Map<string, AgentRunner>([['claude-code', mockRunner]]);
      const streamEvents: Array<{ type: string; content: string }> = [];

      const runner = new DefaultRunnerSystem(
        makeAgentArtifactStore(),
        makeAgentRoleRegistry(),
        makeAgentPromptEngine(),
        makeEventBus(),
        { runnerRegistry: registry },
      );

      await runner.dispatch(
        {
          runId: createRunId('run-1'),
          stateId: 'state-1',
          role: 'implementer',
          inputArtifacts: [],
        },
        (event) => {
          streamEvents.push(event);
        },
      );

      const errorEvent = streamEvents.find((e) => e.type === 'stderr');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.content).toContain('[agent-result-error]');
      expect(errorEvent?.content).toContain('role=implementer');
      expect(errorEvent?.content).toContain('agent crashed');
    });
  });

  it('emits input artifact refs on task_prompt and output refs when produced', async () => {
    resetWorkerCounter();
    const inputRef = {
      type: 'implementation' as const,
      name: 'src-1',
      version: 1,
      checksum: 'abc',
    };
    const streamEvents: Array<{ structuredData?: Record<string, unknown> }> = [];

    const runner = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: defaultRunnerRegistry() },
    );

    await runner.dispatch(
      {
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'architect',
        inputArtifacts: [inputRef],
      },
      (event) => {
        streamEvents.push(event);
      },
    );

    const taskPrompt = streamEvents.find(
      (event) => event.structuredData?.['messageType'] === 'task_prompt',
    );
    expect(taskPrompt?.structuredData?.['inputArtifacts']).toEqual([inputRef]);

    const produced = streamEvents.find(
      (event) => event.structuredData?.['phase'] === 'artifact_produced',
    );
    expect(produced?.structuredData?.['outputArtifacts']).toEqual([
      {
        type: 'static_review',
        name: 'architect-output',
        version: 1,
        checksum: 'abc',
      },
    ]);
  });

  it('emits rolePrompt in task_prompt stream event', async () => {
    resetWorkerCounter();
    const streamEvents: Array<{ structuredData?: Record<string, unknown> }> = [];

    const runner = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: defaultRunnerRegistry() },
    );

    await runner.dispatch(
      {
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'architect',
        inputArtifacts: [],
      },
      (event) => {
        streamEvents.push(event);
      },
    );

    const taskPrompt = streamEvents.find(
      (event) => event.structuredData?.['messageType'] === 'task_prompt',
    );
    expect(taskPrompt?.structuredData?.['rolePrompt']).toContain('rendered prompt');
  });
});
