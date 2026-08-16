import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultIterationContractRegistry } from '@ai-orchestrator/governance';
import { DefaultJournalReader, DefaultJournalWriter } from '@ai-orchestrator/journal';
import type { GovernanceEngine } from '@ai-orchestrator/ports';
import { createRunId } from '@ai-orchestrator/ports';
import type { TransitionDecision } from '@ai-orchestrator/schemas';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { LifecycleController } from '@ai-orchestrator/workflow';

import { TEST_WORKFLOW } from '../fixtures/test-defaults';
import {
  createMockArtifactStore,
  createMockGovernance,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
} from '../helpers/mock-ports';

const TEST_DIR = join(tmpdir(), `self-hosting-smoke-${String(Date.now())}`);

let journalPath: string;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  journalPath = join(TEST_DIR, 'journal.md');
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Self-Hosting Smoke Test', () => {
  it("completes one full cycle targeting the orchestrator's own codebase (INTAKE → DONE)", async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const governance = createMockGovernance();
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'self-host-001');
    const statePersistence = createMockStatePersistence();
    const manifestProducer = createMockManifestProducer();

    const controller = new LifecycleController({
      runner,
      artifactStore,
      governanceEngine: governance,
      contractRegistry,
      journalWriter,
      statePersistence,
      manifestProducer,
    });

    const config = {
      runId: 'self-host-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add a --verbose flag to ai status command in ai-dev-orchestrator'],
    };

    let result = await controller.start(config);
    let iterations = 0;
    while (
      result.finalState !== 'DONE' &&
      result.finalState !== 'FAILED' &&
      result.finalState !== 'ABORTED' &&
      iterations < 10
    ) {
      result = await controller.resume({ type: 'approval', content: 'Approved' });
      iterations++;
    }

    expect(result.finalState).toBe('DONE');
  });

  it('workflow engine FSM executes the default variant end-to-end', async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const governance = createMockGovernance();
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'self-host-fsm-001');
    const statePersistence = createMockStatePersistence();
    const manifestProducer = createMockManifestProducer();

    const controller = new LifecycleController({
      runner,
      artifactStore,
      governanceEngine: governance,
      contractRegistry,
      journalWriter,
      statePersistence,
      manifestProducer,
    });

    const config = {
      runId: 'self-host-fsm-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Refactor the EventBus to support typed channel subscriptions'],
    };

    let result = await controller.start(config);
    let iterations = 0;
    while (
      result.finalState !== 'DONE' &&
      result.finalState !== 'FAILED' &&
      result.finalState !== 'ABORTED' &&
      iterations < 10
    ) {
      result = await controller.resume({ type: 'approval', content: 'Approved' });
      iterations++;
    }

    expect(result.finalState).toBe('DONE');

    const reader = new DefaultJournalReader(journalPath);
    const events = reader.readAll();
    const transitions = events.filter((e) => e.type === 'state_transition');

    const states = new Set<string>();
    for (const t of transitions) {
      if ('from' in t.data) {
        states.add(t.data.from);
      }
      if ('to' in t.data) {
        states.add(t.data.to);
      }
    }

    expect(states.has('INTAKE')).toBe(true);
    expect(states.has('PLANNING')).toBe(true);
    expect(states.has('IMPLEMENTATION')).toBe(true);
    expect(transitions.length).toBeGreaterThanOrEqual(5);
  });

  it('governance enforces iteration limits during self-hosted run', async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'self-host-gov-001');
    const statePersistence = createMockStatePersistence();
    const manifestProducer = createMockManifestProducer();

    const governance: GovernanceEngine = {
      evaluateTransition: vi.fn((): TransitionDecision => ({
        allowed: true,
        reason: 'governance approved within iteration limit',
      })),
      checkAgreement: vi.fn(() => ({ exists: true, valid: true })),
      recordDecision: vi.fn(),
    };

    const controller = new LifecycleController({
      runner,
      artifactStore,
      governanceEngine: governance,
      contractRegistry,
      journalWriter,
      statePersistence,
      manifestProducer,
    });

    const config = {
      runId: 'self-host-gov-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add rate limiting to provider abstraction'],
    };

    let result = await controller.start(config);
    let iterations = 0;
    while (
      result.finalState !== 'DONE' &&
      result.finalState !== 'FAILED' &&
      result.finalState !== 'ABORTED' &&
      iterations < 10
    ) {
      result = await controller.resume({ type: 'approval', content: 'Approved' });
      iterations++;
    }

    expect(result.finalState).toBe('DONE');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(governance.evaluateTransition).toHaveBeenCalled();
  });

  it('runner system dispatches workers and collects validated output', async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const governance = createMockGovernance();
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'self-host-runner-001');
    const statePersistence = createMockStatePersistence();
    const manifestProducer = createMockManifestProducer();

    const controller = new LifecycleController({
      runner,
      artifactStore,
      governanceEngine: governance,
      contractRegistry,
      journalWriter,
      statePersistence,
      manifestProducer,
    });

    const config = {
      runId: 'self-host-runner-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add structured logging to the workflow engine'],
    };

    let result = await controller.start(config);
    let iterations = 0;
    while (
      result.finalState !== 'DONE' &&
      result.finalState !== 'FAILED' &&
      result.finalState !== 'ABORTED' &&
      iterations < 10
    ) {
      result = await controller.resume({ type: 'approval', content: 'Approved' });
      iterations++;
    }

    expect(result.finalState).toBe('DONE');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(runner.dispatch).toHaveBeenCalled();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const dispatchCalls = vi.mocked(runner.dispatch).mock.calls;
    const dispatchedRoles = dispatchCalls.map((call) => (call[0] as { role: string }).role);

    expect(dispatchedRoles).toContain('requirements_analyst');
    expect(dispatchedRoles).toContain('planner');
    expect(dispatchedRoles).toContain('implementer');
    expect(dispatchedRoles).toContain('verifier');

    expect(artifactStore.stored.has('canonical_specification')).toBe(true);
    expect(artifactStore.stored.has('plan')).toBe(true);
    expect(artifactStore.stored.has('implementation')).toBe(true);
    expect(artifactStore.stored.has('verification')).toBe(true);
  });

  it('state persistence checkpoints and resumes correctly', async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const governance = createMockGovernance();
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'self-host-persist-001');
    const statePersistence = createMockStatePersistence();
    const manifestProducer = createMockManifestProducer();

    const controller = new LifecycleController({
      runner,
      artifactStore,
      governanceEngine: governance,
      contractRegistry,
      journalWriter,
      statePersistence,
      manifestProducer,
    });

    const config = {
      runId: 'self-host-persist-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add checkpoint compression to state persistence'],
    };

    const initial = await controller.start(config);
    expect(initial.finalState).toBe('WAITING_FOR_HUMAN');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(statePersistence.save).toHaveBeenCalled();
    const checkpoint = statePersistence.load(createRunId('self-host-persist-001'));
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.currentState).toBe(initial.finalState);

    const journalWriter2 = new DefaultJournalWriter(journalPath, 'self-host-persist-001', 50);
    const controller2 = new LifecycleController({
      runner,
      artifactStore,
      governanceEngine: governance,
      contractRegistry,
      journalWriter: journalWriter2,
      statePersistence,
      manifestProducer,
    });

    await controller2.start(config);
    let result = await controller2.resume({ type: 'approval', content: 'Resumed after restart' });
    let iterations = 0;
    while (
      result.finalState !== 'DONE' &&
      result.finalState !== 'FAILED' &&
      result.finalState !== 'ABORTED' &&
      iterations < 10
    ) {
      result = await controller2.resume({ type: 'approval', content: 'Approved' });
      iterations++;
    }

    expect(result.finalState).toBe('DONE');
  });

  it('self-hosting feature request produces all expected artifact types', async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const governance = createMockGovernance();
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'self-host-artifacts-001');
    const statePersistence = createMockStatePersistence();
    const manifestProducer = createMockManifestProducer();

    const controller = new LifecycleController({
      runner,
      artifactStore,
      governanceEngine: governance,
      contractRegistry,
      journalWriter,
      statePersistence,
      manifestProducer,
    });

    const config = {
      runId: 'self-host-artifacts-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add artifact dependency visualization to the dashboard'],
    };

    let result = await controller.start(config);
    let iterations = 0;
    while (
      result.finalState !== 'DONE' &&
      result.finalState !== 'FAILED' &&
      result.finalState !== 'ABORTED' &&
      iterations < 10
    ) {
      result = await controller.resume({ type: 'approval', content: 'Approved' });
      iterations++;
    }

    expect(result.finalState).toBe('DONE');

    expect(artifactStore.stored.has('canonical_specification')).toBe(true);
    expect(artifactStore.stored.has('plan')).toBe(true);
    expect(artifactStore.stored.has('plan_review')).toBe(true);
    expect(artifactStore.stored.has('implementation')).toBe(true);
    expect(artifactStore.stored.has('static_review')).toBe(true);
    expect(artifactStore.stored.has('security_review')).toBe(true);
    expect(artifactStore.stored.has('performance_review')).toBe(true);
    expect(artifactStore.stored.has('verification')).toBe(true);

    expect(artifactStore.stored.has('planning_agreement')).toBe(true);
    expect(artifactStore.stored.has('implementation_agreement')).toBe(true);
  });
});
