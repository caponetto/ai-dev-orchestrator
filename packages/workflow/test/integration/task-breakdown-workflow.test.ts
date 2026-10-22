/* eslint-disable @typescript-eslint/unbound-method -- Assertions inspect Vitest mock methods without invoking them. */
import { readFileSync } from 'node:fs';

import { DefaultIterationContractRegistry } from '@ai-dev-orchestrator/governance';
import { createRunId } from '@ai-dev-orchestrator/ports';
import {
  createMockArtifactStore,
  createMockGovernance,
  createMockJournalWriter,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
} from '@ai-dev-orchestrator/test-utils';
import { snakeToCamelDeep } from '@ai-dev-orchestrator/utils';
import { assert, describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';

import { WorkflowParser } from '../../src/infrastructure/workflow-dsl/workflow-parser';
import { LifecycleController } from '../../src/infrastructure/workflow-engine/lifecycle-controller';

describe('built-in task-breakdown workflow', () => {
  it('aborts after three rejected decomposition reviews instead of hitting the global transition limit', async () => {
    const yaml = readFileSync(
      new URL(
        '../../../config-templates/src/static/workflows/task-breakdown.yaml',
        import.meta.url,
      ),
      'utf8',
    );
    const definition = new WorkflowParser().parse(
      stringify(snakeToCamelDeep(parse(yaml) as unknown)),
    );
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({
      artifactStore,
      roleToArtifactType: {
        breakdown_analyst: 'canonical_specification',
        decomposer: 'task_breakdown',
        decomposition_reviewer: 'decomposition_review',
      },
    });
    const readLatest = vi.mocked(artifactStore).getLatest.getMockImplementation();
    assert(readLatest);
    vi.mocked(artifactStore).getLatest.mockImplementation(async (type, name) => {
      const artifact = await readLatest(type, name);
      return artifact && type === 'decomposition_review'
        ? { ...artifact, content: JSON.stringify({ approved: false, findings: [] }) }
        : artifact;
    });
    const statePersistence = createMockStatePersistence();
    const controller = new LifecycleController({
      runner,
      artifactStore,
      statePersistence,
      governanceEngine: createMockGovernance(),
      contractRegistry: new DefaultIterationContractRegistry(),
      journalWriter: createMockJournalWriter(),
      manifestProducer: createMockManifestProducer(),
    });
    const result = await controller.start({
      runId: 'task-breakdown-regression',
      workflowDefinition: definition,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Break down an epic'],
      globalTransitionLimit: 20,
    });
    expect(result.finalState).toBe('ABORTED');
    expect(
      vi
        .mocked(runner)
        .dispatch.mock.calls.filter(([request]) => request.role === 'decomposition_reviewer'),
    ).toHaveLength(3);
    expect(vi.mocked(runner).dispatchParallel).not.toHaveBeenCalled();
    expect(
      statePersistence.load(createRunId('task-breakdown-regression'))?.iterationCounts[
        'decomposition_review_loop'
      ],
    ).toBe(3);
    expect(vi.mocked(statePersistence).releaseLock).toHaveBeenCalledTimes(1);
  });
});
