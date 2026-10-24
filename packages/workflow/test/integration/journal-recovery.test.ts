/* eslint-disable @typescript-eslint/unbound-method -- Assertions inspect Vitest mock methods. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import {
  DefaultIterationContractRegistry,
  PLAN_REVIEW_LOOP,
} from '@ai-dev-orchestrator/governance';
import { DefaultJournalReader, DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import type { AgentSessionSupervisor } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import { DefaultRoleRegistry } from '@ai-dev-orchestrator/role-system';
import type { WorkflowDefinition } from '@ai-dev-orchestrator/schemas';
import {
  createMockArtifactStore,
  createMockGovernance,
  createMockManifestProducer,
  createMockRunnerSystem,
  TEST_ROLES,
} from '@ai-dev-orchestrator/test-utils';
import { assert, describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../../src/infrastructure/workflow-engine/lifecycle-controller';

describe('journal-only workflow recovery', () => {
  it('restores round counts and spent tokens before allowing further worker dispatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'journal-recovery-'));
    try {
      const runId = createRunId('recovery');
      const journalPath = join(dir, 'journal.jsonl');
      const journalWriter = new DefaultJournalWriter(journalPath, runId);
      const statePersistence = new DefaultStatePersistence(dir);
      const artifactStore = createMockArtifactStore();
      const runner = createMockRunnerSystem({ artifactStore });
      const dispatch = vi.mocked(runner).dispatch.getMockImplementation();
      assert(dispatch);
      vi.mocked(runner).dispatch.mockImplementation(async (request, stream) => {
        const result = await dispatch(request, stream);
        if (request.role === 'plan_reviewer') {
          await artifactStore.store({
            type: 'plan_review',
            name: 'plan_review',
            producedBy: 'plan_reviewer',
            content: JSON.stringify({ approved: false }),
          });
        }
        journalWriter.append({
          timestamp: new Date().toISOString(),
          runId,
          sequence: 0,
          type: 'worker_completed',
          data: {
            kind: 'worker',
            workerId: result.workerId,
            role: result.role,
            stateId: request.stateId,
            status: result.status,
            inputTokens: result.metrics.inputTokens,
            outputTokens: result.metrics.outputTokens,
          },
        });
        return result;
      });
      const workflow: WorkflowDefinition = {
        name: 'recovery',
        version: '1',
        initialState: 'PLANNING',
        terminalStates: ['DONE'],
        states: {
          PLANNING: {
            type: 'action',
            description: '',
            entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
            transitions: [
              {
                target: 'PLAN_REVIEW',
                trigger: 'completion',
                guards: [],
                governanceRequired: false,
                priority: 0,
              },
            ],
          },
          PLAN_REVIEW: {
            type: 'review',
            description: '',
            entryActions: [{ type: 'dispatch_worker', params: { role: 'plan_reviewer' } }],
            transitions: [
              {
                target: 'PLANNING',
                trigger: 'review_rejected',
                guards: [],
                governanceRequired: false,
                priority: 0,
              },
              {
                target: 'WAITING_FOR_HUMAN',
                trigger: 'iteration_exhausted',
                guards: [],
                governanceRequired: false,
                priority: 1,
              },
            ],
          },
          WAITING_FOR_HUMAN: {
            type: 'wait',
            description: '',
            transitions: [
              {
                target: 'PLANNING',
                trigger: 'human_approved',
                guards: [],
                governanceRequired: false,
                priority: 0,
              },
            ],
          },
          DONE: { type: 'terminal', description: '', transitions: [] },
        },
      };
      const options = {
        runner,
        artifactStore,
        statePersistence,
        journalWriter,
        governanceEngine: createMockGovernance(),
        manifestProducer: createMockManifestProducer(),
      };
      const config = {
        runId,
        workflowDefinition: workflow,
        governancePolicy: {},
        roleAssignments: {},
        sources: [],
      };
      const first = new LifecycleController({
        ...options,
        contractRegistry: new DefaultIterationContractRegistry([
          { ...PLAN_REVIEW_LOOP, maxIterations: 3 },
        ]),
      });
      expect((await first.start(config)).finalState).toBe('WAITING_FOR_HUMAN');
      const saved = statePersistence.load(runId);
      const recovered = statePersistence.reconstructFromJournal(
        runId,
        new DefaultJournalReader(journalPath).readAll(),
      );
      assert(saved);
      assert(recovered);
      expect(recovered.iterationCounts).toEqual(saved.iterationCounts);
      expect(recovered.stateHistory).toEqual(saved.stateHistory);
      expect(recovered.cumulativeInputTokens).toBe(saved.cumulativeInputTokens);
      expect(recovered.cumulativeOutputTokens).toBe(saved.cumulativeOutputTokens);
      expect(recovered.iterationCounts['plan_review_loop']).toBe(3);
      expect(recovered.cumulativeInputTokens).toBe(600);
      const registry = new DefaultIterationContractRegistry();
      const restored = new LifecycleController({ ...options, contractRegistry: registry });
      restored.restore({ ...config, budgetMaxTokens: 500 }, recovered);
      expect((await restored.resume({ type: 'approval', content: 'continue' })).finalState).toBe(
        'WAITING_FOR_HUMAN',
      );
      expect(restored.getState().waitingContext?.reason).toBe('token_budget_exceeded');
      expect(registry.getIterationState('plan_review_loop').currentIteration).toBe(3);
      expect(vi.mocked(runner).dispatch).toHaveBeenCalledTimes(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('durable terminal cleanup recovery', () => {
  it('persists unfinished cleanup on disk, resumes its cursor, and records journal completion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'terminal-recovery-'));
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const runId = createRunId('terminal-recovery');
      const journalPath = join(dir, 'journal.jsonl');
      const statePersistence = new DefaultStatePersistence(dir);
      const journalWriter = new DefaultJournalWriter(journalPath, runId);
      const artifactStore = createMockArtifactStore();
      const runner = createMockRunnerSystem({ artifactStore });
      vi.mocked(runner).dispatch.mockResolvedValue({
        workerId: 'worker',
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
          modelUsed: 'small',
        },
      });
      vi.mocked(artifactStore).store.mockImplementationOnce(() => {
        now += 1000;
        return Promise.resolve({ type: 'plan', name: 'first', version: 1, checksum: 'first' });
      });
      const definition: WorkflowDefinition = {
        name: 'terminal-recovery',
        version: '1',
        initialState: 'WORK',
        terminalStates: ['DONE'],
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
          DONE: {
            type: 'terminal',
            description: '',
            transitions: [],
            entryActions: [
              { type: 'store_artifact', params: { type: 'plan', name: 'first', content: '{}' } },
              { type: 'store_artifact', params: { type: 'plan', name: 'second', content: '{}' } },
            ],
          },
        },
      };
      const config = {
        runId,
        workflowDefinition: definition,
        governancePolicy: {},
        roleAssignments: {},
        sources: [],
      };
      const options = {
        runner,
        artifactStore,
        journalWriter,
        statePersistence,
        governanceEngine: createMockGovernance(),
        manifestProducer: createMockManifestProducer(),
        contractRegistry: new DefaultIterationContractRegistry(),
      };
      await expect(
        new LifecycleController({ ...options, workflowTimeoutMs: 100 }).start(config),
      ).rejects.toThrow('timed out');
      const checkpoint = statePersistence.load(runId);
      assert(checkpoint);
      expect(checkpoint.currentState).toBe('WORK');
      expect(checkpoint.pendingTerminalState).toBe('DONE');
      expect(checkpoint.entryActionContinuation?.nextActionIndex).toBe(1);
      const replay = statePersistence.reconstructFromJournal(
        runId,
        new DefaultJournalReader(journalPath).readAll(),
      );
      expect(replay?.currentState).toBe('WORK');
      expect(replay?.pendingTerminalState).toBe('DONE');
      expect(replay?.entryActionContinuation?.nextActionIndex).toBe(1);
      assert(replay);
      const restored = new LifecycleController(options);
      restored.restore(config, replay);
      expect((await restored.retry()).finalState).toBe('DONE');
      expect(vi.mocked(artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
        'first',
        'second',
      ]);
      expect(runner.dispatch).toHaveBeenCalledTimes(1);
      expect(statePersistence.load(runId)?.pendingTerminalState).toBeUndefined();
      expect(
        statePersistence.reconstructFromJournal(
          runId,
          new DefaultJournalReader(journalPath).readAll(),
        )?.currentState,
      ).toBe('DONE');
    } finally {
      clock.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('durable session completion replay', () => {
  it('replays a serialized exit completion before its next checkpoint without another response or charge', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-recovery-'));
    try {
      const runId = createRunId('session-recovery');
      const journalPath = join(dir, 'journal.jsonl');
      const statePersistence = new DefaultStatePersistence(dir);
      const artifactStore = createMockArtifactStore();
      const runner = createMockRunnerSystem({ artifactStore });
      const ref = {
        sessionId: 'session',
        runId,
        stateId: 'WORK',
        role: 'planner' as const,
        transport: 'remote' as const,
      };
      vi.mocked(runner).dispatch.mockResolvedValue({
        workerId: 'worker',
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
      });
      const sessionSupervisor: AgentSessionSupervisor = {
        createSession: vi.fn(),
        attach: vi.fn().mockResolvedValue({ ref, state: 'awaiting_human', pendingRequests: [] }),
        sendHumanResponse: vi.fn().mockResolvedValue(true),
        waitForAdvance: vi.fn().mockResolvedValue({
          kind: 'completed',
          artifactContent: '{}',
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
      const definition: WorkflowDefinition = {
        name: 'session-recovery',
        version: '1',
        initialState: 'WORK',
        terminalStates: ['DONE'],
        states: {
          WORK: {
            type: 'action',
            description: '',
            entryActions: [],
            exitActions: [
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
            ],
          },
          WAITING_FOR_HUMAN: { type: 'wait', description: '', transitions: [] },
          DONE: { type: 'terminal', description: '', transitions: [] },
        },
      };
      const config = {
        runId,
        workflowDefinition: definition,
        governancePolicy: {},
        roleAssignments: {},
        sources: [],
      };
      const options = {
        runner,
        artifactStore,
        statePersistence,
        sessionSupervisor,
        journalWriter: new DefaultJournalWriter(journalPath, runId),
        roleRegistry: new DefaultRoleRegistry(TEST_ROLES, {
          assignments: {},
          defaultAssignment: { model: 'small' },
        }),
        governanceEngine: createMockGovernance(),
        manifestProducer: createMockManifestProducer(),
        contractRegistry: new DefaultIterationContractRegistry(),
      };
      const controller = new LifecycleController(options);
      expect((await controller.start(config)).finalState).toBe('WAITING_FOR_HUMAN');
      expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
        'DONE',
      );
      const events = new DefaultJournalReader(journalPath).readAll();
      const completedIndex = events.findIndex((event) => event.type === 'worker_completed');
      assert(completedIndex >= 0);
      const replay = statePersistence.reconstructFromJournal(
        runId,
        events.slice(0, completedIndex + 1),
      );
      assert(replay);
      expect(replay.waitingContext).toBeUndefined();
      expect(replay.entryActionContinuation?.completedExitResults?.[0]).toMatchObject({
        success: true,
        artifactRef: { type: 'plan' },
      });
      vi.mocked(artifactStore).store.mockClear();
      const restored = new LifecycleController(options);
      restored.restore(config, replay);
      expect((await restored.retry()).finalState).toBe('DONE');
      expect(vi.mocked(artifactStore).store.mock.calls.map(([request]) => request.name)).toEqual([
        'after',
      ]);
      expect(runner.dispatch).toHaveBeenCalledTimes(1);
      expect(sessionSupervisor.sendHumanResponse).toHaveBeenCalledTimes(1);
      expect(statePersistence.load(runId)?.cumulativeInputTokens).toBe(30);
      expect(statePersistence.load(runId)?.cumulativeOutputTokens).toBe(20);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
