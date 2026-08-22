import type {
  AgentStreamBus,
  AgentStreamEvent,
  AgreementGate,
  ArtifactStore,
  JournalWriter,
  RunnerSystem,
  StalenessDetector,
} from '@ai-orchestrator/ports';
import { createRunId } from '@ai-orchestrator/ports';
import type { Action, AgreementGateResult } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { ActionDispatcher } from '../action-dispatcher';

function makeRunner(overrides: Partial<RunnerSystem> = {}): RunnerSystem {
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
    ...overrides,
  };
}

function makeStore(opts: { reviewsApproved?: boolean } = {}): ArtifactStore {
  const approved = opts.reviewsApproved ?? true;
  const reviewTypeToRole: Record<string, string> = {
    plan_review: 'plan_reviewer',
    static_review: 'static_reviewer',
    security_review: 'security_reviewer',
    performance_review: 'performance_reviewer',
    adversarial_review: 'adversarial_reviewer',
    design_review: 'design_reviewer',
    docs_review: 'docs_reviewer',
    ux_review: 'ux_reviewer',
    verification: 'verifier',
    release_summary: 'summary_writer',
  };
  return {
    store: vi.fn().mockResolvedValue({ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }),
    get: vi.fn().mockResolvedValue(null),
    getLatest: vi.fn().mockImplementation((type: string, name: string) => {
      const expectedRole = reviewTypeToRole[type];
      if (expectedRole && name === `${expectedRole}-output`) {
        return Promise.resolve({
          type,
          name,
          version: 1,
          checksum: 'abc',
          content: JSON.stringify({ approved }),
        });
      }
      return Promise.resolve(null);
    }),
    list: vi.fn().mockResolvedValue([]),
    history: vi.fn().mockResolvedValue([]),
    verify: vi.fn().mockResolvedValue({ valid: true }),
    inventory: vi.fn().mockResolvedValue({ artifacts: [], totalSize: 0 }),
  };
}

function makeJournal(): JournalWriter {
  return {
    append: vi.fn(),
    appendBatch: vi.fn(),
  };
}

function makeGate(): AgreementGate {
  const gateStore = new Map<string, AgreementGateResult>();
  return {
    check: vi.fn((type: string) => gateStore.get(type) ?? { exists: false, valid: false }),
    register: vi.fn((type: string, result: AgreementGateResult) => gateStore.set(type, result)),
  };
}

describe('ActionDispatcher', () => {
  it('dispatches worker and returns result', async () => {
    const dispatcher = new ActionDispatcher(makeRunner(), makeStore(), makeJournal());
    const action: Action = { type: 'dispatch_worker', params: { role: 'planner' } };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].artifactRef).toBeDefined();
  });

  it('handles worker dispatch failure', async () => {
    const runner = makeRunner({
      dispatch: vi.fn().mockResolvedValue({
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
      }),
    });
    const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
    const action: Action = { type: 'dispatch_worker', params: { role: 'planner' } };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');
    expect(results[0].success).toBe(false);
  });

  it('records journal event', async () => {
    const journal = makeJournal();
    const dispatcher = new ActionDispatcher(makeRunner(), makeStore(), journal);
    const action: Action = { type: 'record_journal', params: { event: 'run_started' } };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'INTAKE');
    expect(results[0].success).toBe(true);
    expect(journal.append).toHaveBeenCalledOnce(); // eslint-disable-line @typescript-eslint/unbound-method
  });

  it('stores artifact', async () => {
    const store = makeStore();
    const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
    const action: Action = { type: 'store_artifact', params: { type: 'plan', content: 'data' } };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');
    expect(results[0].success).toBe(true);
    expect(store.store).toHaveBeenCalledOnce(); // eslint-disable-line @typescript-eslint/unbound-method
  });

  it('handles notify_human as no-op success', async () => {
    const dispatcher = new ActionDispatcher(makeRunner(), makeStore(), makeJournal());
    const action: Action = { type: 'notify_human', params: { reason: 'clarification_needed' } };
    const results = await dispatcher.executeAll(
      [action],
      createRunId('run-001'),
      'WAITING_FOR_HUMAN',
    );
    expect(results[0].success).toBe(true);
  });

  it('generates and stores agreement artifact', async () => {
    const store = makeStore();
    const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
    const action: Action = { type: 'generate_agreement', params: { type: 'planning_agreement' } };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'IMPLEMENTATION');
    expect(results[0].success).toBe(true);
    expect(results[0].artifactRef).toBeDefined();
    expect(store.store).toHaveBeenCalledOnce(); // eslint-disable-line @typescript-eslint/unbound-method

    const call = (store.store as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(call['type']).toBe('planning_agreement');
    expect(call['producedBy']).toBe('governance');

    const content = JSON.parse(call['content'] as string) as Record<string, unknown>;
    expect(content['version']).toBe(1);
    expect(content['agreementType']).toBe('planning_agreement');
    expect(content['runId']).toBe('run-001');
    expect(content['stageId']).toBe('IMPLEMENTATION');
    expect(content['createdAt']).toEqual(expect.any(String));
    expect(content['approvalStatus']).toBe('approved');
    const participants = content['participants'] as Array<Record<string, string>>;
    expect(participants).toHaveLength(2);
    expect(participants[0]['role']).toBe('planner');
    expect(participants[1]['role']).toBe('plan_reviewer');
  });

  it('generates implementation agreement with all reviewers', async () => {
    const store = makeStore();
    const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
    const action: Action = {
      type: 'generate_agreement',
      params: { type: 'implementation_agreement' },
    };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'VERIFICATION');
    expect(results[0].success).toBe(true);

    const call = (store.store as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const content = JSON.parse(call['content'] as string) as Record<string, unknown>;
    const participants = content['participants'] as Array<Record<string, string>>;
    expect(participants).toHaveLength(8);
    expect(participants.map((p) => p['role'])).toEqual([
      'implementer',
      'static_reviewer',
      'security_reviewer',
      'performance_reviewer',
      'adversarial_reviewer',
      'design_reviewer',
      'docs_reviewer',
      'ux_reviewer',
    ]);
  });

  it('generates verification_agreement with approved status (verifier action is reviewed)', async () => {
    const store = makeStore();
    const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
    const action: Action = {
      type: 'generate_agreement',
      params: { type: 'verification_agreement' },
    };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'DONE');
    expect(results[0].success).toBe(true);

    const call = (store.store as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const content = JSON.parse(call['content'] as string) as Record<string, unknown>;
    expect(content['approvalStatus']).toBe('approved');
    const participants = content['participants'] as Array<Record<string, string>>;
    expect(participants).toHaveLength(1);
    expect(participants[0]['role']).toBe('verifier');
    expect(participants[0]['action']).toBe('reviewed');
  });

  it('handles agreement generation error gracefully', async () => {
    const store = makeStore();
    (store.store as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk full'));
    const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
    const action: Action = { type: 'generate_agreement', params: { type: 'planning_agreement' } };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'IMPLEMENTATION');
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('disk full');
  });

  it('executes multiple actions in order', async () => {
    const dispatcher = new ActionDispatcher(makeRunner(), makeStore(), makeJournal());
    const actions: Action[] = [
      { type: 'record_journal', params: { event: 'run_started' } },
      { type: 'dispatch_worker', params: { role: 'requirements_analyst' } },
    ];
    const results = await dispatcher.executeAll(actions, createRunId('run-001'), 'INTAKE');
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  });

  it('passes onStreamEvent callback as second dispatch argument when agentStreamBus is provided', async () => {
    const published: AgentStreamEvent[] = [];
    const bus: AgentStreamBus = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      publish: vi.fn((event: AgentStreamEvent) => published.push(event)),
      getClientCount: vi.fn().mockReturnValue(0),
    };

    const runner = makeRunner();
    const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal(), undefined, bus);
    const action: Action = { type: 'dispatch_worker', params: { role: 'planner' } };
    await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const dispatchMock = vi.mocked(runner.dispatch);
    const callback = dispatchMock.mock.calls[0][1] as unknown as (
      event: Record<string, string>,
    ) => void;
    expect(callback).toBeTypeOf('function');

    callback({ timestamp: '2026-01-01T00:00:00Z', type: 'stdout', content: 'hello' });

    expect(published).toHaveLength(1);
    expect(published[0].runId).toBe('run-001');
    expect(published[0].stateId).toBe('PLANNING');
    expect(published[0].roleId).toBe('planner');
    expect(published[0].dispatchId).toBe('dispatch-1');
    expect(published[0].content).toBe('hello');
  });

  it('does not pass onStreamEvent when no agentStreamBus', async () => {
    const runner = makeRunner();
    const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
    const action: Action = { type: 'dispatch_worker', params: { role: 'planner' } };
    await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const dispatchMock = vi.mocked(runner.dispatch);
    expect(dispatchMock.mock.calls[0][1]).toBeUndefined();
  });

  describe('dispatch_parallel_workers', () => {
    it('dispatches 3 roles and returns workerResults and artifactRefs', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValue([
          {
            workerId: 'w1',
            role: 'static_reviewer',
            status: 'success',
            outputArtifacts: [
              { type: 'static_review', name: 'static_review', version: 1, checksum: 'a' },
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
          },
          {
            workerId: 'w2',
            role: 'security_reviewer',
            status: 'success',
            outputArtifacts: [
              { type: 'security_review', name: 'security_review', version: 1, checksum: 'b' },
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
          },
          {
            workerId: 'w3',
            role: 'performance_reviewer',
            status: 'success',
            outputArtifacts: [
              { type: 'performance_review', name: 'performance_review', version: 1, checksum: 'c' },
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
          },
        ]),
      });
      const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
      const action: Action = {
        type: 'dispatch_parallel_workers',
        params: { roles: ['static_reviewer', 'security_reviewer', 'performance_reviewer'] },
      };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].workerResults).toHaveLength(3);
      expect(results[0].artifactRefs).toHaveLength(3);
      const workerResults = results[0].workerResults ?? [];
      expect(workerResults[0].role).toBe('static_reviewer');
      expect(workerResults[1].role).toBe('security_reviewer');
      expect(workerResults[2].role).toBe('performance_reviewer');
    });

    it('handles partial worker failure — overall success is true, failed worker marked', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValue([
          {
            workerId: 'w1',
            role: 'static_reviewer',
            status: 'success',
            outputArtifacts: [
              { type: 'static_review', name: 'static_review', version: 1, checksum: 'a' },
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
          },
          {
            workerId: 'w2',
            role: 'security_reviewer',
            status: 'failure',
            outputArtifacts: [],
            error: { type: 'agent_error', message: 'API error', retryable: false },
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 0,
              inputTokens: 0,
              outputTokens: 0,
              retryCount: 0,
              modelUsed: '',
            },
          },
          {
            workerId: 'w3',
            role: 'performance_reviewer',
            status: 'success',
            outputArtifacts: [
              { type: 'performance_review', name: 'performance_review', version: 1, checksum: 'c' },
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
          },
        ]),
      });
      const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
      const action: Action = {
        type: 'dispatch_parallel_workers',
        params: { roles: ['static_reviewer', 'security_reviewer', 'performance_reviewer'] },
      };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
      expect(results[0].success).toBe(true);
      const failedWorkers = results[0].workerResults ?? [];
      expect(failedWorkers[1].success).toBe(false);
      expect(failedWorkers[1].error).toBe('API error');
      expect(results[0].artifactRefs).toHaveLength(2);
    });

    it('single-worker dispatch still works with artifactRef (backward compatibility)', async () => {
      const dispatcher = new ActionDispatcher(makeRunner(), makeStore(), makeJournal());
      const action: Action = { type: 'dispatch_worker', params: { role: 'planner' } };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');
      expect(results[0].artifactRef).toBeDefined();
      expect(results[0].workerResults).toBeUndefined();
      expect(results[0].artifactRefs).toBeUndefined();
    });

    it('dispatch_parallel_workers does NOT return a trigger', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValue([
          {
            workerId: 'w1',
            role: 'static_reviewer',
            status: 'success',
            outputArtifacts: [
              { type: 'static_review', name: 'static_review', version: 1, checksum: 'a' },
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
          },
        ]),
      });
      const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
      const action: Action = {
        type: 'dispatch_parallel_workers',
        params: { roles: ['static_reviewer'] },
      };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
      const result = results[0];
      expect(result).not.toHaveProperty('trigger');
      expect(result.success).toBe(true);
      expect(result.workerResults).toBeDefined();
    });

    it('all workers fail → overall success is false', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValue([
          {
            workerId: 'w1',
            role: 'static_reviewer',
            status: 'failure',
            outputArtifacts: [],
            error: { type: 'agent_error', message: 'API error', retryable: false },
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 0,
              inputTokens: 0,
              outputTokens: 0,
              retryCount: 0,
              modelUsed: '',
            },
          },
          {
            workerId: 'w2',
            role: 'security_reviewer',
            status: 'failure',
            outputArtifacts: [],
            error: { type: 'agent_error', message: 'timeout', retryable: false },
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 0,
              inputTokens: 0,
              outputTokens: 0,
              retryCount: 0,
              modelUsed: '',
            },
          },
        ]),
      });
      const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
      const action: Action = {
        type: 'dispatch_parallel_workers',
        params: { roles: ['static_reviewer', 'security_reviewer'] },
      };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
      expect(results[0].success).toBe(false);
      expect(results[0].workerResults).toHaveLength(2);
      expect(results[0].artifactRefs).toHaveLength(0);
    });

    it('aggregates tokens across parallel workers', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValue([
          {
            workerId: 'w1',
            role: 'static_reviewer',
            status: 'success',
            outputArtifacts: [],
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 0,
              inputTokens: 10,
              outputTokens: 5,
              retryCount: 0,
              modelUsed: '',
            },
          },
          {
            workerId: 'w2',
            role: 'security_reviewer',
            status: 'success',
            outputArtifacts: [],
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 0,
              inputTokens: 20,
              outputTokens: 10,
              retryCount: 0,
              modelUsed: '',
            },
          },
        ]),
      });
      const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
      const action: Action = {
        type: 'dispatch_parallel_workers',
        params: { roles: ['static_reviewer', 'security_reviewer'] },
      };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
      expect(results[0].usageSnapshot?.totalInputTokens).toBeGreaterThanOrEqual(0);
    });

    it('preserves invalid_output errorType for single-worker failure', async () => {
      const runner = makeRunner({
        dispatch: vi.fn().mockResolvedValue({
          workerId: 'w1',
          role: 'plan_reviewer',
          status: 'failure',
          outputArtifacts: [],
          error: {
            type: 'invalid_output',
            message: 'Invalid worker output: /: must have required property approved',
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
      });

      const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
      const [result] = await dispatcher.executeAll(
        [{ type: 'dispatch_worker', params: { role: 'plan_reviewer' } }],
        createRunId('run-001'),
        'PLAN_REVIEW',
      );

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('invalid_output');
      expect(result.error).toContain('Invalid worker output');
    });

    it('preserves per-worker errorType for parallel failures', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValue([
          {
            workerId: 'w1',
            role: 'static_reviewer',
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
          },
          {
            workerId: 'w2',
            role: 'security_reviewer',
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
          },
        ]),
      });

      const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
      const [result] = await dispatcher.executeAll(
        [
          {
            type: 'dispatch_parallel_workers',
            params: { roles: ['static_reviewer', 'security_reviewer'] },
          },
        ],
        createRunId('run-001'),
        'CODE_REVIEW',
      );

      const workerResults = result.workerResults ?? [];
      expect(workerResults[0]).toMatchObject({
        role: 'static_reviewer',
        success: false,
        errorType: 'invalid_output',
      });
      expect(workerResults[1]).toMatchObject({
        role: 'security_reviewer',
        success: false,
        errorType: 'agent_error',
      });
    });

    it('preserves schema_violation errorType for single-worker failure', async () => {
      const runner = makeRunner({
        dispatch: vi.fn().mockResolvedValue({
          workerId: 'w1',
          role: 'plan_reviewer',
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
      });

      const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
      const [result] = await dispatcher.executeAll(
        [{ type: 'dispatch_worker', params: { role: 'plan_reviewer' } }],
        createRunId('run-001'),
        'PLAN_REVIEW',
      );

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('schema_violation');
      expect(result.error).toContain('Output does not match required schema');
    });

    it('handles dispatchParallel throwing', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockRejectedValue(new Error('connection refused')),
      });
      const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
      const action: Action = {
        type: 'dispatch_parallel_workers',
        params: { roles: ['static_reviewer'] },
      };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('connection refused');
    });

    it('uses docsOnlyRoles when canonical_specification has changeType docs_only', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValue([
          {
            workerId: 'w1',
            role: 'docs_reviewer',
            status: 'success',
            outputArtifacts: [
              { type: 'docs_review', name: 'docs_review', version: 1, checksum: 'd' },
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
          },
        ]),
      });
      const store = makeStore();
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      (store.getLatest as ReturnType<typeof vi.fn>).mockImplementation((type: string) => {
        if (type === 'canonical_specification') {
          return Promise.resolve({
            type: 'canonical_specification',
            name: 'canonical_specification',
            version: 1,
            checksum: 'cs1',
            content: JSON.stringify({ extensions: { changeType: 'docs_only' } }),
          });
        }
        return Promise.resolve(null);
      });
      const dispatcher = new ActionDispatcher(runner, store, makeJournal());
      const action: Action = {
        type: 'dispatch_parallel_workers',
        params: {
          roles: ['static_reviewer', 'security_reviewer', 'docs_reviewer'],
          docsOnlyRoles: ['docs_reviewer'],
        },
      };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
      expect(results[0].success).toBe(true);
      const workerResults = results[0].workerResults ?? [];
      expect(workerResults).toHaveLength(1);
      expect(workerResults[0].role).toBe('docs_reviewer');
    });

    it('uses full roles when canonical_specification has changeType code', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValue([
          {
            workerId: 'w1',
            role: 'static_reviewer',
            status: 'success',
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
          },
          {
            workerId: 'w2',
            role: 'docs_reviewer',
            status: 'success',
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
          },
        ]),
      });
      const store = makeStore();
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      (store.getLatest as ReturnType<typeof vi.fn>).mockImplementation((type: string) => {
        if (type === 'canonical_specification') {
          return Promise.resolve({
            type: 'canonical_specification',
            name: 'canonical_specification',
            version: 1,
            checksum: 'cs1',
            content: JSON.stringify({ extensions: { changeType: 'code' } }),
          });
        }
        return Promise.resolve(null);
      });
      const dispatcher = new ActionDispatcher(runner, store, makeJournal());
      const action: Action = {
        type: 'dispatch_parallel_workers',
        params: {
          roles: ['static_reviewer', 'docs_reviewer'],
          docsOnlyRoles: ['docs_reviewer'],
        },
      };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
      expect(results[0].success).toBe(true);
      const workerResults = results[0].workerResults ?? [];
      expect(workerResults).toHaveLength(2);
    });

    it('uses docsOnlyRoles when spec found via list() fallback (name mismatch)', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValue([
          {
            workerId: 'w1',
            role: 'docs_reviewer',
            status: 'success',
            outputArtifacts: [
              { type: 'docs_review', name: 'docs_review', version: 1, checksum: 'd' },
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
          },
        ]),
      });
      const store = makeStore();
      (store.getLatest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const specRef = {
        type: 'canonical_specification',
        name: 'context_analyst-output',
        version: 1,
        checksum: 'cs1',
      };
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      (store.list as ReturnType<typeof vi.fn>).mockImplementation((query: { type: string }) =>
        query.type === 'canonical_specification' ? Promise.resolve([specRef]) : Promise.resolve([]),
      );
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...specRef,
        content: JSON.stringify({ extensions: { changeType: 'docs_only' } }),
      });
      const dispatcher = new ActionDispatcher(runner, store, makeJournal());
      const action: Action = {
        type: 'dispatch_parallel_workers',
        params: {
          roles: ['static_reviewer', 'security_reviewer', 'docs_reviewer'],
          docsOnlyRoles: ['docs_reviewer'],
        },
      };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
      expect(results[0].success).toBe(true);
      const workerResults = results[0].workerResults ?? [];
      expect(workerResults).toHaveLength(1);
      expect(workerResults[0].role).toBe('docs_reviewer');
    });

    it('uses full roles when docsOnlyRoles is not specified', async () => {
      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValue([
          {
            workerId: 'w1',
            role: 'static_reviewer',
            status: 'success',
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
          },
        ]),
      });
      const store = makeStore();
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      (store.getLatest as ReturnType<typeof vi.fn>).mockImplementation((type: string) => {
        if (type === 'canonical_specification') {
          return Promise.resolve({
            type: 'canonical_specification',
            name: 'canonical_specification',
            version: 1,
            checksum: 'cs1',
            content: JSON.stringify({ extensions: { changeType: 'docs_only' } }),
          });
        }
        return Promise.resolve(null);
      });
      const dispatcher = new ActionDispatcher(runner, store, makeJournal());
      const action: Action = {
        type: 'dispatch_parallel_workers',
        params: { roles: ['static_reviewer'] },
      };
      const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
      expect(results[0].success).toBe(true);
      const workerResults = results[0].workerResults ?? [];
      expect(workerResults).toHaveLength(1);
      expect(workerResults[0].role).toBe('static_reviewer');
    });
  });

  describe('dispatch_dynamic_workers', () => {
    it('reads source artifact and spawns one worker per item', async () => {
      const taskBreakdown = JSON.stringify({
        id: 'breakdown-001',
        tasks: [
          { id: 'task-001', title: 'First task' },
          { id: 'task-002', title: 'Second task' },
        ],
      });

      const store = makeStore();
      const artifactRef = {
        type: 'task_breakdown',
        name: 'decomposer-output',
        version: 1,
        checksum: 'abc',
      };
      (store.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([artifactRef]);
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ref: artifactRef,
        type: 'task_breakdown',
        name: 'decomposer-output',
        version: 1,
        content: taskBreakdown,
        checksum: 'abc',
        producedBy: 'decomposer',
        createdAt: new Date().toISOString(),
        sizeBytes: taskBreakdown.length,
      });

      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValueOnce([
          {
            workerId: 'w1',
            role: 'task_spec_writer',
            status: 'success',
            outputArtifacts: [
              {
                type: 'canonical_specification',
                name: 'spec-task-001',
                version: 1,
                checksum: 'c1',
              },
            ],
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 5000,
              inputTokens: 100,
              outputTokens: 200,
              retryCount: 0,
              modelUsed: '',
            },
          },
          {
            workerId: 'w2',
            role: 'task_spec_writer',
            status: 'success',
            outputArtifacts: [
              {
                type: 'canonical_specification',
                name: 'spec-task-002',
                version: 1,
                checksum: 'c2',
              },
            ],
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 5000,
              inputTokens: 100,
              outputTokens: 200,
              retryCount: 0,
              modelUsed: '',
            },
          },
        ]),
      });

      const dispatcher = new ActionDispatcher(runner, store, makeJournal());
      const action: Action = {
        type: 'dispatch_dynamic_workers',
        params: {
          role: 'task_spec_writer',
          sourceArtifact: 'task_breakdown',
          itemsPath: 'tasks',
        },
      };

      const results = await dispatcher.executeAll(
        [action],
        createRunId('run-001'),
        'SPEC_AUTHORING',
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      // 2 individual specs + 1 aggregated task_specifications artifact
      expect(results[0].artifactRefs).toHaveLength(3);
      expect(results[0].workerResults).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(runner.dispatchParallel).toHaveBeenCalledOnce();

      // Verify each dispatch request includes the task item context
      const dispatchCalls = (runner.dispatchParallel as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Array<Record<string, unknown>>;
      expect(dispatchCalls).toHaveLength(2);
      for (const req of dispatchCalls) {
        expect(req['role']).toBe('task_spec_writer');
      }

      // Verify the aggregate task_specifications artifact was stored
      const storeCalls = (store.store as ReturnType<typeof vi.fn>).mock.calls;
      expect(storeCalls).toHaveLength(1);
      const storedArg = storeCalls[0][0] as Record<string, unknown>;
      expect(storedArg['type']).toBe('task_specifications');
      expect(storedArg['name']).toBe('task_specifications');
      expect(storedArg['producedBy']).toBe('system');
      const storedContent = JSON.parse(storedArg['content'] as string) as Record<string, unknown>;
      expect(storedContent['version']).toBe(1);
      expect(storedContent['tasks']).toHaveLength(2);
    });

    it('verifies variableOverrides contain taskItem and taskItemIndex per worker', async () => {
      const taskBreakdown = JSON.stringify({
        id: 'breakdown-001',
        tasks: [
          { id: 'task-001', title: 'First task' },
          { id: 'task-002', title: 'Second task' },
        ],
      });

      const store = makeStore();
      const artifactRef = {
        type: 'task_breakdown',
        name: 'decomposer-output',
        version: 1,
        checksum: 'abc',
      };
      (store.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([artifactRef]);
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ref: artifactRef,
        type: 'task_breakdown',
        name: 'decomposer-output',
        version: 1,
        content: taskBreakdown,
        checksum: 'abc',
        producedBy: 'decomposer',
        createdAt: new Date().toISOString(),
        sizeBytes: taskBreakdown.length,
      });

      const runner = makeRunner({
        dispatchParallel: vi.fn().mockResolvedValueOnce([
          {
            workerId: 'w1',
            role: 'task_spec_writer',
            status: 'success',
            outputArtifacts: [
              {
                type: 'canonical_specification',
                name: 'spec-task-001',
                version: 1,
                checksum: 'c1',
              },
            ],
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 5000,
              inputTokens: 100,
              outputTokens: 200,
              retryCount: 0,
              modelUsed: '',
            },
          },
          {
            workerId: 'w2',
            role: 'task_spec_writer',
            status: 'success',
            outputArtifacts: [
              {
                type: 'canonical_specification',
                name: 'spec-task-002',
                version: 1,
                checksum: 'c2',
              },
            ],
            metrics: {
              startedAt: '',
              completedAt: '',
              durationMs: 5000,
              inputTokens: 100,
              outputTokens: 200,
              retryCount: 0,
              modelUsed: '',
            },
          },
        ]),
      });

      const dispatcher = new ActionDispatcher(runner, store, makeJournal());
      const action: Action = {
        type: 'dispatch_dynamic_workers',
        params: {
          role: 'task_spec_writer',
          sourceArtifact: 'task_breakdown',
          itemsPath: 'tasks',
        },
      };

      await dispatcher.executeAll([action], createRunId('run-001'), 'SPEC_AUTHORING');

      const dispatchCalls = (runner.dispatchParallel as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Array<Record<string, Record<string, string>>>;
      expect(dispatchCalls).toHaveLength(2);

      expect(dispatchCalls[0]['variableOverrides']).toMatchObject({
        taskItem: JSON.stringify({ id: 'task-001', title: 'First task' }),
        taskItemIndex: '0',
      });
      expect(dispatchCalls[1]['variableOverrides']).toMatchObject({
        taskItem: JSON.stringify({ id: 'task-002', title: 'Second task' }),
        taskItemIndex: '1',
      });
    });

    it('fails when source artifact content is invalid JSON', async () => {
      const store = makeStore();
      const artifactRef = {
        type: 'task_breakdown',
        name: 'decomposer-output',
        version: 1,
        checksum: 'abc',
      };
      (store.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([artifactRef]);
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ref: artifactRef,
        type: 'task_breakdown',
        name: 'decomposer-output',
        version: 1,
        content: 'not valid JSON{{{',
        checksum: 'abc',
        producedBy: 'decomposer',
        createdAt: new Date().toISOString(),
        sizeBytes: 17,
      });

      const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
      const action: Action = {
        type: 'dispatch_dynamic_workers',
        params: {
          role: 'task_spec_writer',
          sourceArtifact: 'task_breakdown',
          itemsPath: 'tasks',
        },
      };

      const results = await dispatcher.executeAll(
        [action],
        createRunId('run-001'),
        'SPEC_AUTHORING',
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Failed to parse');
    });

    it('fails when source artifact is not found', async () => {
      const store = makeStore();
      (store.getLatest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
      const action: Action = {
        type: 'dispatch_dynamic_workers',
        params: {
          role: 'task_spec_writer',
          sourceArtifact: 'task_breakdown',
          itemsPath: 'tasks',
        },
      };

      const results = await dispatcher.executeAll(
        [action],
        createRunId('run-001'),
        'SPEC_AUTHORING',
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('task_breakdown');
    });

    it('fails when items path resolves to non-array', async () => {
      const store = makeStore();
      const artifactRef = {
        type: 'task_breakdown',
        name: 'decomposer-output',
        version: 1,
        checksum: 'abc',
      };
      (store.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([artifactRef]);
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ref: artifactRef,
        type: 'task_breakdown',
        name: 'decomposer-output',
        version: 1,
        content: JSON.stringify({ id: 'breakdown-001', tasks: 'not-an-array' }),
        checksum: 'abc',
        producedBy: 'decomposer',
        createdAt: new Date().toISOString(),
        sizeBytes: 100,
      });

      const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
      const action: Action = {
        type: 'dispatch_dynamic_workers',
        params: {
          role: 'task_spec_writer',
          sourceArtifact: 'task_breakdown',
          itemsPath: 'tasks',
        },
      };

      const results = await dispatcher.executeAll(
        [action],
        createRunId('run-001'),
        'SPEC_AUTHORING',
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('tasks');
    });
  });

  describe('agreement verdict from review artifacts', () => {
    it('agreement approved when review artifacts approve', async () => {
      const store = makeStore({ reviewsApproved: true });
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
        { type: 'generate_agreement', params: { type: 'planning_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'PLAN_REVIEW');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls).toHaveLength(1);
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: true,
        approvalStatus: 'approved',
      });

      const storeCalls = (store.store as ReturnType<typeof vi.fn>).mock.calls;
      const lastArg = storeCalls[storeCalls.length - 1][0] as Record<string, string>;
      const content = JSON.parse(lastArg.content) as Record<string, unknown>;
      expect(content['approvalStatus']).toBe('approved');
    });

    it('agreement rejected when review artifacts reject', async () => {
      const store = makeStore({ reviewsApproved: false });
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
        { type: 'generate_agreement', params: { type: 'planning_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'PLAN_REVIEW');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: false,
        approvalStatus: 'rejected',
      });
    });

    it('agreement rejected when no review artifact exists', async () => {
      const store = makeStore();
      (store.getLatest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
        { type: 'generate_agreement', params: { type: 'planning_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'PLAN_REVIEW');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: false,
        approvalStatus: 'rejected',
      });
    });

    it('agreement rejected when any parallel reviewer rejects', async () => {
      const store = makeStore({ reviewsApproved: true });
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      (store.getLatest as ReturnType<typeof vi.fn>).mockImplementation((type: string) => {
        if (type === 'security_review') {
          return Promise.resolve({
            type,
            name: type,
            version: 1,
            checksum: 'abc',
            content: JSON.stringify({ approved: false }),
          });
        }
        return Promise.resolve({
          type,
          name: type,
          version: 1,
          checksum: 'abc',
          content: JSON.stringify({ approved: true }),
        });
      });
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'generate_agreement', params: { type: 'implementation_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'CODE_REVIEW');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: false,
        approvalStatus: 'rejected',
      });
    });

    it('all parallel reviewers approve → agreement approved', async () => {
      const store = makeStore({ reviewsApproved: true });
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'generate_agreement', params: { type: 'implementation_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'CODE_REVIEW');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: true,
        approvalStatus: 'approved',
      });
    });

    it('release agreement approved when producer artifact exists', async () => {
      const store = makeStore();
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'generate_agreement', params: { type: 'release_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'WRAP_UP');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: true,
        approvalStatus: 'approved',
      });
    });

    it('release agreement rejected when producer artifact missing', async () => {
      const store = makeStore();
      (store.getLatest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'generate_agreement', params: { type: 'release_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'WRAP_UP');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: false,
        approvalStatus: 'rejected',
      });
    });

    it('reads approval from passed field in JSON content', async () => {
      const store = makeStore();
      (store.getLatest as ReturnType<typeof vi.fn>).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        (_type: string, name: string) => {
          if (name === 'verifier-output') {
            return Promise.resolve({
              type: 'verification',
              name,
              version: 1,
              checksum: 'abc',
              content: JSON.stringify({ passed: true }),
            });
          }
          return Promise.resolve(null);
        },
      );
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'generate_agreement', params: { type: 'verification_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'DONE');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: true,
        approvalStatus: 'approved',
      });
    });

    it('reads approval from frontmatter approved field', async () => {
      const store = makeStore();
      (store.getLatest as ReturnType<typeof vi.fn>).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        (_type: string, name: string) => {
          if (name === 'plan_reviewer-output') {
            return Promise.resolve({
              type: 'plan_review',
              name,
              version: 1,
              checksum: 'abc',
              content: '---\napproved: true\n---\nLooks good.',
            });
          }
          return Promise.resolve(null);
        },
      );
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'generate_agreement', params: { type: 'planning_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'PLAN_REVIEW');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: true,
        approvalStatus: 'approved',
      });
    });

    it('reads approval from frontmatter passed field', async () => {
      const store = makeStore();
      (store.getLatest as ReturnType<typeof vi.fn>).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        (_type: string, name: string) => {
          if (name === 'verifier-output') {
            return Promise.resolve({
              type: 'verification',
              name,
              version: 1,
              checksum: 'abc',
              content: '---\npassed: true\n---\nAll checks pass.',
            });
          }
          return Promise.resolve(null);
        },
      );
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'generate_agreement', params: { type: 'verification_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'DONE');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: true,
        approvalStatus: 'approved',
      });
    });

    it('rejects when frontmatter has no approved or passed field', async () => {
      const store = makeStore();
      (store.getLatest as ReturnType<typeof vi.fn>).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        (_type: string, name: string) => {
          if (name === 'plan_reviewer-output') {
            return Promise.resolve({
              type: 'plan_review',
              name,
              version: 1,
              checksum: 'abc',
              content: '---\nsummary: Review notes\n---\nSome review text.',
            });
          }
          return Promise.resolve(null);
        },
      );
      const gate = makeGate();
      const dispatcher = new ActionDispatcher(
        makeRunner(),
        store,
        makeJournal(),
        undefined,
        undefined,
        gate,
      );
      const actions: Action[] = [
        { type: 'generate_agreement', params: { type: 'planning_agreement' } },
      ];
      await dispatcher.executeAll(actions, createRunId('run-001'), 'PLAN_REVIEW');

      const registerCalls = (gate.register as ReturnType<typeof vi.fn>).mock.calls;
      expect(registerCalls[0][1]).toMatchObject({
        exists: true,
        valid: false,
        approvalStatus: 'rejected',
      });
    });
  });

  it('handles record_journal failure gracefully', async () => {
    const journal = makeJournal();
    (journal.append as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('journal disk full');
    });
    const dispatcher = new ActionDispatcher(makeRunner(), makeStore(), journal);
    const action: Action = { type: 'record_journal', params: { event: 'run_started' } };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'INTAKE');
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('journal disk full');
  });

  it('handles dispatch_worker throwing', async () => {
    const runner = makeRunner({
      dispatch: vi.fn().mockRejectedValue(new Error('connection timeout')),
    });
    const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
    const action: Action = { type: 'dispatch_worker', params: { role: 'planner' } };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('connection timeout');
  });

  it('stores artifact with custom name when params.name is provided', async () => {
    const store = makeStore();
    const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
    const action: Action = {
      type: 'store_artifact',
      params: { type: 'plan', content: 'data', name: 'custom-plan-name' },
    };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');
    expect(results[0].success).toBe(true);
    const storeCall = (store.store as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(storeCall['name']).toBe('custom-plan-name');
  });

  it('handles store_artifact failure gracefully', async () => {
    const store = makeStore();
    (store.store as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('write error'));
    const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
    const action: Action = { type: 'store_artifact', params: { type: 'plan', content: 'data' } };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('write error');
  });

  it('handles produce_manifest as no-op success', async () => {
    const dispatcher = new ActionDispatcher(makeRunner(), makeStore(), makeJournal());
    const action: Action = { type: 'produce_manifest', params: {} };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'WRAP_UP');
    expect(results[0].success).toBe(true);
  });

  it('uses full roles when docsOnlyRoles is set but no canonical_specification exists', async () => {
    const runner = makeRunner({
      dispatchParallel: vi.fn().mockResolvedValue([
        {
          workerId: 'w1',
          role: 'static_reviewer',
          status: 'success',
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
        },
        {
          workerId: 'w2',
          role: 'docs_reviewer',
          status: 'success',
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
        },
      ]),
    });
    const store = makeStore();
    // No canonical_specification anywhere
    (store.getLatest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (store.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const dispatcher = new ActionDispatcher(runner, store, makeJournal());
    const action: Action = {
      type: 'dispatch_parallel_workers',
      params: {
        roles: ['static_reviewer', 'docs_reviewer'],
        docsOnlyRoles: ['docs_reviewer'],
      },
    };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
    expect(results[0].success).toBe(true);
    const workerResults = results[0].workerResults ?? [];
    // Falls back to full roles since no spec found
    expect(workerResults).toHaveLength(2);
  });

  it('uses full roles when canonical_specification content is not parseable', async () => {
    const runner = makeRunner({
      dispatchParallel: vi.fn().mockResolvedValue([
        {
          workerId: 'w1',
          role: 'static_reviewer',
          status: 'success',
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
        },
        {
          workerId: 'w2',
          role: 'docs_reviewer',
          status: 'success',
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
        },
      ]),
    });
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    (store.getLatest as ReturnType<typeof vi.fn>).mockImplementation((type: string) => {
      if (type === 'canonical_specification') {
        return Promise.resolve({
          type: 'canonical_specification',
          name: 'canonical_specification',
          version: 1,
          checksum: 'cs1',
          content: '{{not valid json',
        });
      }
      return Promise.resolve(null);
    });
    const dispatcher = new ActionDispatcher(runner, store, makeJournal());
    const action: Action = {
      type: 'dispatch_parallel_workers',
      params: {
        roles: ['static_reviewer', 'docs_reviewer'],
        docsOnlyRoles: ['docs_reviewer'],
      },
    };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
    expect(results[0].success).toBe(true);
    const workerResults = results[0].workerResults ?? [];
    // Falls back to full roles since spec is not parseable
    expect(workerResults).toHaveLength(2);
  });

  it('records staleness detection when stalenessDetector is provided', async () => {
    const journal = makeJournal();
    const stalenessDetector: StalenessDetector = {
      computeStaleSet: vi.fn().mockReturnValue({
        staleArtifacts: [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
        rebuildOrder: ['plan'],
      }),
    };
    const dispatcher = new ActionDispatcher(makeRunner(), makeStore(), journal, stalenessDetector);
    const action: Action = { type: 'dispatch_worker', params: { role: 'planner' } };
    await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');

    /* eslint-disable @typescript-eslint/unbound-method */
    expect(journal.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'artifact_staleness_detected' }),
    );
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('parallel dispatch with session outcomes returns first awaiting_human session', async () => {
    const runner = makeRunner({
      dispatchParallel: vi.fn().mockResolvedValue([
        {
          workerId: 'w1',
          role: 'static_reviewer',
          status: 'success',
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
          sessionOutcome: 'awaiting_human',
          sessionRef: 'session-1',
          pendingRequest: { type: 'permission', message: 'Need approval' },
        },
        {
          workerId: 'w2',
          role: 'security_reviewer',
          status: 'success',
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
          sessionOutcome: 'completed',
          sessionRef: 'session-2',
        },
      ]),
    });
    const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
    const action: Action = {
      type: 'dispatch_parallel_workers',
      params: { roles: ['static_reviewer', 'security_reviewer'] },
    };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
    expect(results[0].sessionOutcome).toBe('awaiting_human');
    expect(results[0].sessionRef).toBe('session-1');
  });

  it('passes configVariables as variableOverrides in single dispatch', async () => {
    const runner = makeRunner();
    const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
    dispatcher.setConfigVariables({ repoRoot: '/tmp/my-repo' });
    const action: Action = { type: 'dispatch_worker', params: { role: 'planner' } };
    await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');

    /* eslint-disable @typescript-eslint/unbound-method */
    expect(runner.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ variableOverrides: { repoRoot: '/tmp/my-repo' } }),
      undefined,
    );
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('returns failure for dynamic workers when intermediate path segment is null', async () => {
    const store = makeStore();
    (store.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { type: 'task_breakdown', name: 'task_breakdown', version: 1, checksum: 'abc' },
    ]);
    (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: 'task_breakdown',
      name: 'task_breakdown',
      version: 1,
      checksum: 'abc',
      content: JSON.stringify({ top: null }),
    });
    const dispatcher = new ActionDispatcher(makeRunner(), store, makeJournal());
    const action: Action = {
      type: 'dispatch_dynamic_workers',
      params: {
        role: 'implementer',
        sourceArtifact: 'task_breakdown',
        itemsPath: 'top.nested.items',
      },
    };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'IMPLEMENTATION');
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('did not resolve to a non-empty array');
  });

  it('returns failure when dispatchParallel throws inside dynamic workers', async () => {
    const store = makeStore();
    (store.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { type: 'task_breakdown', name: 'task_breakdown', version: 1, checksum: 'abc' },
    ]);
    (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: 'task_breakdown',
      name: 'task_breakdown',
      version: 1,
      checksum: 'abc',
      content: JSON.stringify({ items: [{ id: 'task-1' }] }),
    });
    const runner = makeRunner({
      dispatchParallel: vi.fn().mockRejectedValue(new Error('dispatch exploded')),
    });
    const dispatcher = new ActionDispatcher(runner, store, makeJournal());
    const action: Action = {
      type: 'dispatch_dynamic_workers',
      params: { role: 'implementer', sourceArtifact: 'task_breakdown', itemsPath: 'items' },
    };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'IMPLEMENTATION');
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('dispatch exploded');
  });

  it('uses full roles when getLatest throws during isDocsOnlyChange', async () => {
    const runner = makeRunner({
      dispatchParallel: vi.fn().mockResolvedValue([
        {
          workerId: 'w1',
          role: 'static_reviewer',
          status: 'success',
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
        },
        {
          workerId: 'w2',
          role: 'docs_reviewer',
          status: 'success',
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
        },
      ]),
    });
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    (store.getLatest as ReturnType<typeof vi.fn>).mockImplementation((type: string) => {
      if (type === 'canonical_specification') {
        return Promise.reject(new Error('store crashed'));
      }
      return Promise.resolve(null);
    });
    const dispatcher = new ActionDispatcher(runner, store, makeJournal());
    const action: Action = {
      type: 'dispatch_parallel_workers',
      params: {
        roles: ['static_reviewer', 'docs_reviewer'],
        docsOnlyRoles: ['docs_reviewer'],
      },
    };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'CODE_REVIEW');
    expect(results[0].success).toBe(true);
    const workerResults = results[0].workerResults ?? [];
    expect(workerResults).toHaveLength(2);
  });

  it('single dispatch returns session outcome and pending request', async () => {
    const runner = makeRunner({
      dispatch: vi.fn().mockResolvedValue({
        workerId: 'w1',
        role: 'planner',
        status: 'success',
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
        sessionOutcome: 'awaiting_human',
        sessionRef: 'session-abc',
        pendingRequest: { type: 'clarification', message: 'Need more info' },
      }),
    });
    const dispatcher = new ActionDispatcher(runner, makeStore(), makeJournal());
    const action: Action = { type: 'dispatch_worker', params: { role: 'planner' } };
    const results = await dispatcher.executeAll([action], createRunId('run-001'), 'PLANNING');
    expect(results[0].sessionOutcome).toBe('awaiting_human');
    expect(results[0].sessionRef).toBe('session-abc');
    expect(results[0].pendingRequest).toEqual({
      type: 'clarification',
      message: 'Need more info',
    });
  });
});
