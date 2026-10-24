import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DefaultArtifactTypeValidator,
  DefaultOwnershipRegistry,
  FilesystemArtifactStore,
} from '@ai-dev-orchestrator/artifacts';
import { DefaultStatePersistence, InMemoryEventBus } from '@ai-dev-orchestrator/core';
import {
  DefaultGovernanceEngine,
  DefaultIterationContractRegistry,
} from '@ai-dev-orchestrator/governance';
import { DefaultJournalReader, DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import type { AgentRunner } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import {
  DefaultPromptEngine,
  DefaultTemplateRegistry,
  DefaultTokenEstimator,
} from '@ai-dev-orchestrator/prompt-engine';
import { DefaultRoleRegistry } from '@ai-dev-orchestrator/role-system';
import { DefaultManifestProducer } from '@ai-dev-orchestrator/run-manifest';
import { DefaultRunnerSystem } from '@ai-dev-orchestrator/runner';
import type { AgentTask, WorkflowDefinition } from '@ai-dev-orchestrator/schemas';
import { TEST_ROLES } from '@ai-dev-orchestrator/test-utils';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../../src/infrastructure/workflow-engine/lifecycle-controller';

const runId = createRunId('production-recovery');
const plan = JSON.stringify({
  version: 1,
  specificationRef: { type: 'canonical_specification', name: 'input', version: 1 },
  createdAt: '2026-10-23T00:00:00.000Z',
  summary: 'Deterministic plan',
  tasks: [{ taskId: 'task-1', description: 'Verify recovery', files: [], dependencies: [] }],
});
const definition: WorkflowDefinition = {
  name: 'production-recovery',
  version: '1',
  initialState: 'WORK',
  terminalStates: ['DONE'],
  states: {
    WORK: {
      type: 'action',
      description: 'Produce a plan',
      entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
      transitions: [
        {
          target: 'DONE',
          trigger: 'completion',
          guards: [],
          governanceRequired: true,
          priority: 0,
        },
      ],
    },
    DONE: {
      type: 'terminal',
      description: 'Required cleanup',
      transitions: [],
      entryActions: ['first', 'second'].map((name) => ({
        type: 'store_artifact',
        params: { type: 'plan', name, content: plan },
      })),
    },
  },
};

function createHarness(baseDir: string) {
  const runDir = join(baseDir, runId);
  const journalPath = join(runDir, 'journal.jsonl');
  const events = new DefaultJournalReader(journalPath).readAll();
  const journalWriter = new DefaultJournalWriter(
    journalPath,
    runId,
    Math.max(0, ...events.map((event) => event.sequence)),
  );
  const persistence = new DefaultStatePersistence(baseDir);
  const artifactStore = new FilesystemArtifactStore(
    runDir,
    runId,
    new DefaultOwnershipRegistry(),
    new DefaultArtifactTypeValidator(),
  );
  const planner = TEST_ROLES.find((role) => role.id === 'planner');
  assert(planner);
  const roles = new DefaultRoleRegistry(
    [{ ...planner, runner: 'fixture', readableArtifacts: [] }],
    { assignments: {}, defaultAssignment: { model: 'fixture', maxTokens: 4096 } },
  );
  const templates = new DefaultTemplateRegistry();
  templates.register({
    frontmatter: {
      role: 'planner',
      version: '1',
      description: 'Deterministic test planner',
      variables: [],
      outputContract: {
        role: 'planner',
        artifactType: 'plan',
        schema: {},
        format: 'json',
        required: true,
        repairEnabled: false,
        maxRepairAttempts: 0,
      },
    },
    body: 'Produce the test plan.',
    source: 'fixture.md',
  });
  const dispatch = vi.fn((task: AgentTask) =>
    Promise.resolve({
      taskId: task.taskId,
      status: 'success' as const,
      artifactContent: plan,
      durationMs: 1,
      tokenUsage: { inputTokens: 30, outputTokens: 20 },
    }),
  );
  const agent: AgentRunner = { dispatch };
  const runner = new DefaultRunnerSystem(
    artifactStore,
    roles,
    new DefaultPromptEngine(templates, new DefaultTokenEstimator()),
    new InMemoryEventBus({ runId }),
    { journalWriter, repoRoot: baseDir, runDir, runnerRegistry: new Map([['fixture', agent]]) },
  );
  const contracts = new DefaultIterationContractRegistry();
  const controller = new LifecycleController({
    runner,
    artifactStore,
    roleRegistry: roles,
    journalWriter,
    statePersistence: persistence,
    contractRegistry: contracts,
    governanceEngine: new DefaultGovernanceEngine(contracts),
    manifestProducer: new DefaultManifestProducer(),
  });
  return {
    controller,
    persistence,
    artifactStore,
    dispatch,
    journalPath,
    config: {
      runId,
      runDir,
      repoRoot: baseDir,
      workflowDefinition: definition,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Verify durable execution'],
    },
  };
}

const directories: string[] = [];
function temporaryDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'production-recovery-'));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('production components across a checkpoint failure', () => {
  it.each([0, 1, 2])(
    'recovers terminal cursor %i from the journal with the same artifacts and usage as uninterrupted execution',
    async (cursor) => {
      const baseline = createHarness(temporaryDirectory());
      expect((await baseline.controller.start(baseline.config)).finalState).toBe('DONE');
      const baselineState = baseline.persistence.load(runId);
      assert(baselineState);

      const dir = temporaryDirectory();
      const interrupted = createHarness(dir);
      const save = interrupted.persistence.save.bind(interrupted.persistence);
      vi.spyOn(interrupted.persistence, 'save').mockImplementation(async (state) => {
        if (
          state.pendingTerminalState &&
          state.entryActionContinuation?.nextActionIndex === cursor
        ) {
          throw new Error(`Injected checkpoint failure at cleanup cursor ${String(cursor)}`);
        }
        await save(state);
      });
      await expect(interrupted.controller.start(interrupted.config)).rejects.toThrow(
        'Injected checkpoint failure',
      );
      expect(interrupted.persistence.probeLock(runId).exists).toBe(false);
      expect(
        interrupted.persistence.load(runId)?.entryActionContinuation?.nextActionIndex,
      ).not.toBe(cursor);

      // Recreate all production components so no in-memory cursor or inventory can help recovery.
      const restored = createHarness(dir);
      const replay = restored.persistence.reconstructFromJournal(
        runId,
        new DefaultJournalReader(restored.journalPath).readAll(),
      );
      assert(replay);
      expect(replay.pendingTerminalState).toBe('DONE');
      expect(replay.entryActionContinuation?.nextActionIndex).toBe(cursor);
      restored.controller.restore(restored.config, replay);
      expect((await restored.controller.retry()).finalState).toBe('DONE');

      const recovered = restored.persistence.load(runId);
      expect(recovered).toMatchObject({
        currentState: baselineState.currentState,
        cumulativeInputTokens: 30,
        cumulativeOutputTokens: 20,
        workerMetricsByRole: replay.workerMetricsByRole,
      });
      for (const state of [baselineState, recovered]) {
        expect(state?.workerMetricsByRole?.planner).toMatchObject({
          dispatches: 1,
          inputTokens: 30,
          outputTokens: 20,
        });
      }
      expect(recovered?.pendingTerminalState).toBeUndefined();
      expect(recovered?.waitingContext).toBeUndefined();
      expect(interrupted.dispatch).toHaveBeenCalledTimes(1);
      expect(restored.dispatch).not.toHaveBeenCalled();
      const baselineRefs = await baseline.artifactStore.list({});
      expect(await restored.artifactStore.list({})).toEqual(baselineRefs);
      expect(baselineRefs.map((ref) => [ref.name, ref.version])).toEqual([
        ['planner-output', 1],
        ['first', 1],
        ['second', 1],
      ]);
      for (const ref of baselineRefs) {
        expect(await restored.artifactStore.verify(ref)).toMatchObject({ valid: true });
      }
      expect(restored.persistence.probeLock(runId).exists).toBe(false);
    },
  );
});
