import type {
  AgentDispatchResult,
  AgentRunner,
  ArtifactStore,
  EventBus,
  PromptEngine,
  RoleRegistry,
} from '@ai-orchestrator/ports';
import { createRunId } from '@ai-orchestrator/ports';
import type { Artifact } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { DefaultRunnerSystem } from '../default-runner-system';
import { resetWorkerCounter } from '../worker-spawner';

function makeRoleRegistry(): RoleRegistry {
  return {
    getRole: vi.fn().mockReturnValue({
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

function makePromptEngine(): PromptEngine {
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

function makeArtifactStore(): ArtifactStore {
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

function makeLegacyRunner(): AgentRunner {
  return {
    dispatch: vi.fn().mockResolvedValue({
      taskId: 'worker-1',
      status: 'success',
      artifactContent: '{"files": ["src/index.ts"]}',
      durationMs: 5000,
      tokenUsage: { inputTokens: 200, outputTokens: 100 },
    }),
  };
}

function makeResumableRunner(sessionResult: AgentDispatchResult): AgentRunner {
  return {
    supportsResumableSessions: true,
    dispatch: vi.fn().mockResolvedValue({
      taskId: 'worker-1',
      status: 'success',
      artifactContent: '{"files": ["src/index.ts"]}',
      durationMs: 5000,
    }),
    dispatchWithSession: vi.fn().mockResolvedValue(sessionResult),
  };
}

describe('DefaultRunnerSystem session dispatch', () => {
  it('uses legacy dispatch for runners without session support', async () => {
    resetWorkerCounter();
    const runner = makeLegacyRunner();
    const registry = new Map<string, AgentRunner>([['cli', runner]]);

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: registry, repoRoot: '/repo', runDir: '.ai/runs' },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'IMPL',
      role: 'implementer',
      inputArtifacts: [],
    });

    expect(result.status).toBe('success');
    expect(result.sessionOutcome).toBeUndefined();
    expect(result.sessionRef).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(runner.dispatch)).toHaveBeenCalled();
  });

  it('uses dispatchWithSession for resumable runners returning terminal result', async () => {
    resetWorkerCounter();
    const runner = makeResumableRunner({
      kind: 'terminal',
      result: {
        taskId: 'worker-1',
        status: 'success',
        artifactContent: '{"files": ["src/index.ts"]}',
        durationMs: 200,
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      },
    });
    const registry = new Map<string, AgentRunner>([['cli', runner]]);

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: registry, repoRoot: '/repo', runDir: '.ai/runs' },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'IMPL',
      role: 'implementer',
      inputArtifacts: [],
    });

    expect(result.status).toBe('success');
    expect(result.outputArtifacts).toHaveLength(1);
    expect(vi.mocked(runner.dispatchWithSession)).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(runner.dispatch)).not.toHaveBeenCalled();
  });

  it('returns session-backed result for resumable runners returning session handle', async () => {
    resetWorkerCounter();
    const runner = makeResumableRunner({
      kind: 'session',
      handle: {
        ref: {
          sessionId: 'sess-1',
          runId: 'run-1',
          stateId: 'IMPL',
          role: 'implementer',
          transport: 'stdio',
        },
        state: 'awaiting_human',
        pendingRequests: [
          {
            requestId: 'msg-1',
            kind: 'permission',
            createdAt: '2026-01-01T00:00:00Z',
            payload: { action: 'write_file' },
          },
        ],
      },
    });
    const registry = new Map<string, AgentRunner>([['cli', runner]]);

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: registry, repoRoot: '/repo', runDir: '.ai/runs' },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'IMPL',
      role: 'implementer',
      inputArtifacts: [],
    });

    expect(result.status).toBe('success');
    expect(result.sessionOutcome).toBe('awaiting_human');
    expect(result.sessionRef?.sessionId).toBe('sess-1');
    expect(result.pendingRequest?.requestId).toBe('msg-1');
    expect(result.outputArtifacts).toHaveLength(0);
  });

  it('returns session_active when handle has no pending requests', async () => {
    resetWorkerCounter();
    const runner = makeResumableRunner({
      kind: 'session',
      handle: {
        ref: {
          sessionId: 'sess-2',
          runId: 'run-1',
          stateId: 'IMPL',
          role: 'implementer',
          transport: 'stdio',
        },
        state: 'running',
        pendingRequests: [],
      },
    });
    const registry = new Map<string, AgentRunner>([['cli', runner]]);

    const system = new DefaultRunnerSystem(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
      makeEventBus(),
      { runnerRegistry: registry, repoRoot: '/repo', runDir: '.ai/runs' },
    );

    const result = await system.dispatch({
      runId: createRunId('run-1'),
      stateId: 'IMPL',
      role: 'implementer',
      inputArtifacts: [],
    });

    expect(result.sessionOutcome).toBe('session_active');
    expect(result.sessionRef?.sessionId).toBe('sess-2');
    expect(result.pendingRequest).toBeUndefined();
  });
});
