import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultIterationContractRegistry } from '@ai-dev-orchestrator/governance';
import { DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import type { GovernanceEngine, StatePersistence } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { TransitionDecision, WorkflowRunConfig } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { LifecycleController } from '@ai-dev-orchestrator/workflow';

import { TEST_WORKFLOW } from '../fixtures/test-defaults';
import {
  createMockArtifactStore,
  createMockGovernance,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
  type TrackingArtifactStore,
} from '../helpers/mock-ports';

const TEST_DIR = join(tmpdir(), `resume-semantics-${String(Date.now())}`);

let journalPath: string;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  journalPath = join(TEST_DIR, 'journal.md');
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function createController(
  artifactStore: TrackingArtifactStore,
  governance: GovernanceEngine,
  statePersistence: StatePersistence,
  runId: string,
) {
  const contractRegistry = new DefaultIterationContractRegistry();
  const journalWriter = new DefaultJournalWriter(journalPath, runId);
  const manifestProducer = createMockManifestProducer();
  const runner = createMockRunnerSystem({ artifactStore });

  return new LifecycleController({
    runner,
    artifactStore,
    governanceEngine: governance,
    contractRegistry,
    journalWriter,
    statePersistence,
    manifestProducer,
  });
}

describe('Resume Semantics', () => {
  it('PLAN_REVIEW → WAITING_FOR_HUMAN → resume with approval → DONE', async () => {
    const artifactStore = createMockArtifactStore();
    const governance = createMockGovernance();
    const statePersistence = createMockStatePersistence();

    const controller = createController(
      artifactStore,
      governance,
      statePersistence,
      'resume-verify-001',
    );

    const config = {
      runId: 'resume-verify-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add a feature'],
    };

    const initial = await controller.start(config);
    expect(initial.finalState).toBe('WAITING_FOR_HUMAN');

    const state = controller.getState();
    expect(state.waitingContext?.requestingState).toBe('PLAN_REVIEW');
    expect(state.waitingContext?.requiredInput).toBe('approval');

    const result = await controller.resume({ type: 'approval', content: 'Approved' });
    expect(result.finalState).toBe('DONE');
  });

  it('PLAN_REVIEW → WAITING_FOR_HUMAN → resume with rejection → back to WAITING_FOR_HUMAN', async () => {
    const artifactStore = createMockArtifactStore();
    const governance = createMockGovernance();
    const statePersistence = createMockStatePersistence();

    const controller = createController(
      artifactStore,
      governance,
      statePersistence,
      'resume-reject-001',
    );

    const config = {
      runId: 'resume-reject-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add a feature'],
    };

    const initial = await controller.start(config);
    expect(initial.finalState).toBe('WAITING_FOR_HUMAN');

    const result = await controller.resume({ type: 'rejection', content: 'Rejected' });
    expect(result.finalState).toBe('WAITING_FOR_HUMAN');
    expect(controller.getState().waitingContext?.requestingState).toBe('PLAN_REVIEW');
  });

  it('waitingContext persists through checkpoint and restore', async () => {
    const artifactStore = createMockArtifactStore();
    const governance = createMockGovernance();
    const statePersistence = createMockStatePersistence();

    const controller1 = createController(
      artifactStore,
      governance,
      statePersistence,
      'resume-persist-001',
    );

    const config = {
      runId: 'resume-persist-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add a feature'],
    };

    const initial = await controller1.start(config);
    expect(initial.finalState).toBe('WAITING_FOR_HUMAN');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(statePersistence.save).toHaveBeenCalled();
    const checkpoint = statePersistence.load(createRunId('resume-persist-001'));
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.currentState).toBe('WAITING_FOR_HUMAN');
    expect(checkpoint?.waitingContext).toBeDefined();
    expect(checkpoint?.waitingContext?.requestingState).toBe('PLAN_REVIEW');
    expect(checkpoint?.waitingContext?.requiredInput).toBe('approval');

    const controller2 = createController(
      artifactStore,
      governance,
      statePersistence,
      'resume-persist-001',
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    controller2.restore(config, checkpoint!);

    const state2 = controller2.getState();
    expect(state2.waitingContext?.requestingState).toBe('PLAN_REVIEW');
    expect(state2.waitingContext?.requiredInput).toBe('approval');

    const result = await controller2.resume({
      type: 'approval',
      content: 'Approved after restart',
    });
    expect(result.finalState).toBe('DONE');
  });

  it('escalation pause preserves requestingState through checkpoint', async () => {
    const artifactStore = createMockArtifactStore();
    const statePersistence = createMockStatePersistence();
    let escalationTriggered = false;

    const governance: GovernanceEngine = {
      evaluateTransition: vi.fn((req: { from: string; to: string }): TransitionDecision => {
        if (req.from === req.to) {
          return { allowed: true, reason: 'pre-dispatch pass' };
        }
        if (!escalationTriggered) {
          escalationTriggered = true;
          return {
            escalate: true,
            reason: 'Iteration limit exceeded',
            context: {
              runId: createRunId('resume-escalate-001'),
              stageId: 'CODE_REVIEW',
              reason: 'iteration_limit_exceeded' as const,
              iterationHistory: [],
              unresolvedFindings: [],
              artifactRefs: [],
              suggestedActions: [],
            },
          };
        }
        return { allowed: true, reason: 'approved' };
      }),
      checkAgreement: vi.fn(() => ({ exists: true, valid: true })),
      recordDecision: vi.fn(),
    };

    const controller = createController(
      artifactStore,
      governance,
      statePersistence,
      'resume-escalate-001',
    );

    const config = {
      runId: 'resume-escalate-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add a feature'],
    };

    const initial = await controller.start(config);
    expect(initial.finalState).toBe('WAITING_FOR_HUMAN');

    const state = controller.getState();
    expect(state.waitingContext?.reason).toBe('governance_escalation');
    expect(state.waitingContext?.requiredInput).toBe('approval');

    const checkpoint = statePersistence.load(createRunId('resume-escalate-001'));
    expect(checkpoint?.waitingContext?.reason).toBe('governance_escalation');
    expect(checkpoint?.waitingContext?.requiredInput).toBe('approval');
  });

  it('sources survive checkpoint → restore → resume cycle', async () => {
    const artifactStore = createMockArtifactStore();
    const governance = createMockGovernance();
    const statePersistence = createMockStatePersistence();
    const sources = ['https://github.com/org/repo/pull/99'];

    const controller1 = createController(
      artifactStore,
      governance,
      statePersistence,
      'resume-sources-001',
    );

    const config: WorkflowRunConfig = {
      runId: 'resume-sources-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources,
    };

    const initial = await controller1.start(config);
    expect(initial.finalState).toBe('WAITING_FOR_HUMAN');

    const checkpoint = statePersistence.load(createRunId('resume-sources-001'));
    expect(checkpoint).not.toBeNull();

    const controller2 = createController(
      artifactStore,
      governance,
      statePersistence,
      'resume-sources-001',
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    controller2.restore(config, checkpoint!);

    const result = await controller2.resume({ type: 'approval', content: 'Approved' });
    expect(result.finalState).toBe('DONE');
  });
});
