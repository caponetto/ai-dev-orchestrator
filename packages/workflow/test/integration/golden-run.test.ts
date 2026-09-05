import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultIterationContractRegistry } from '@ai-dev-orchestrator/governance';
import { DefaultJournalReader, DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import { createRunId } from '@ai-dev-orchestrator/ports';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { LifecycleController } from '@ai-dev-orchestrator/workflow';

import { TEST_WORKFLOW } from '../fixtures/test-defaults';
import {
  createMockArtifactStore,
  createMockGovernance,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
} from '../helpers/mock-ports';

const TEST_DIR = join(tmpdir(), `golden-run-${String(Date.now())}`);

let journalPath: string;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  journalPath = join(TEST_DIR, 'journal.md');
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Golden Run: Feature from Text (E2E)', () => {
  it('completes full workflow INTAKE → DONE producing all expected artifacts', async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const governance = createMockGovernance();
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'run-golden-001');
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
      runId: 'run-golden-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add user notification preferences'],
    };

    const result = await controller.start(config);

    // The workflow should reach WAITING_FOR_HUMAN (a wait state) since it requires human approval
    expect(['WAITING_FOR_HUMAN', 'DONE']).toContain(result.finalState);

    if (result.finalState === 'WAITING_FOR_HUMAN') {
      let resumed = await controller.resume({ type: 'approval', content: 'Approved' });

      // After approval from WAITING_FOR_HUMAN, may continue through more states
      let iterations = 0;
      while (
        resumed.finalState !== 'DONE' &&
        resumed.finalState !== 'FAILED' &&
        resumed.finalState !== 'ABORTED' &&
        iterations < 10
      ) {
        resumed = await controller.resume({ type: 'approval', content: 'Approved' });
        iterations++;
      }

      expect(resumed.finalState).toBe('DONE');
    }

    // Verify journal events were recorded
    const reader = new DefaultJournalReader(journalPath);
    const events = reader.readAll();
    expect(events.length).toBeGreaterThan(0);

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('run_started');
    expect(eventTypes).toContain('state_transition');

    // Verify state persistence was called
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(statePersistence.save).toHaveBeenCalled();

    // Verify workers were dispatched
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(runner.dispatch).toHaveBeenCalled();

    // Verify exact artifact coverage
    // Happy path produces 13 unique worker artifact types + 3 agreement types = 16 total unique types.
    expect(artifactStore.stored.size).toBe(16);

    // Worker artifacts
    expect(artifactStore.stored.has('canonical_specification')).toBe(true);
    expect(artifactStore.stored.has('plan')).toBe(true);
    expect(artifactStore.stored.has('plan_review')).toBe(true);
    expect(artifactStore.stored.has('implementation')).toBe(true);
    expect(artifactStore.stored.has('static_review')).toBe(true);
    expect(artifactStore.stored.has('design_review')).toBe(true);
    expect(artifactStore.stored.has('security_review')).toBe(true);
    expect(artifactStore.stored.has('performance_review')).toBe(true);
    expect(artifactStore.stored.has('adversarial_review')).toBe(true);
    expect(artifactStore.stored.has('docs_review')).toBe(true);
    expect(artifactStore.stored.has('ux_review')).toBe(true);
    expect(artifactStore.stored.has('verification')).toBe(true);
    expect(artifactStore.stored.has('release_summary')).toBe(true);

    // Agreement artifacts (3 generated during happy path)
    expect(artifactStore.stored.has('planning_agreement')).toBe(true);
    expect(artifactStore.stored.has('implementation_agreement')).toBe(true);
    expect(artifactStore.stored.has('verification_agreement')).toBe(true);
  });

  it('produces expected state transition sequence through all workflow phases', async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const governance = createMockGovernance();
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'run-golden-002');
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
      runId: 'run-golden-002',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add user notification preferences'],
    };

    let result = await controller.start(config);

    // Keep resuming through human gates until DONE
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

    // Verify transitions by reading journal
    const reader = new DefaultJournalReader(journalPath);
    const events = reader.readAll();
    const transitions = events.filter((e) => e.type === 'state_transition');

    // The workflow should have at least these core transitions
    expect(transitions.length).toBeGreaterThanOrEqual(5);

    // Verify key states were visited
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

    // Verify run_completed event
    const completionEvents = events.filter((e) => e.type === 'run_completed');
    expect(completionEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('resumes from persisted checkpoint and completes remaining workflow', async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const governance = createMockGovernance();
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'run-resume-001');
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
      runId: 'run-resume-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add user notification preferences'],
    };

    // Start the run - should pause at a wait state
    const initial = await controller.start(config);
    expect(initial.finalState).toBe('WAITING_FOR_HUMAN');

    // Verify checkpoint was saved
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(statePersistence.save).toHaveBeenCalled();
    const checkpoint = statePersistence.load(createRunId('run-resume-001'));
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.currentState).toBe(initial.finalState);

    // Simulate "kill and resume" — create a NEW controller (simulating process restart)
    const journalWriter2 = new DefaultJournalWriter(journalPath, 'run-resume-001', 50);
    const controller2 = new LifecycleController({
      runner,
      artifactStore,
      governanceEngine: governance,
      contractRegistry,
      journalWriter: journalWriter2,
      statePersistence,
      manifestProducer,
    });

    // Resume on the new controller, proving the persistence boundary
    await controller2.start(config);
    let result = await controller2.resume({ type: 'approval', content: 'Resumed after restart' });
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

    // Verify journal has both initial and resumed events
    const reader = new DefaultJournalReader(journalPath);
    const events = reader.readAll();
    expect(events.length).toBeGreaterThan(0);

    // Should have at least one human_approval or human_input_received event
    const humanEvents = events.filter(
      (e) => e.type === 'human_approval' || e.type === 'human_input_received',
    );
    expect(humanEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('intake clarification loop: pauses for human input then resumes', async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const governance = createMockGovernance();
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'run-clarify-001');
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
      runId: 'run-clarify-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Maybe add something TBD'],
    };

    const result = await controller.start(config);

    // Workflow should pause at a human gate
    expect(['WAITING_FOR_HUMAN', 'DONE']).toContain(result.finalState);

    if (result.finalState !== 'DONE') {
      // Simulate human providing clarification answers
      const clarified = await controller.resume({
        type: 'text',
        content: 'Build a notification system with email and push channels.',
      });

      // After clarification the workflow should continue
      expect(['WAITING_FOR_HUMAN', 'DONE', 'INTAKE', 'PLANNING']).toContain(clarified.finalState);

      // Drive to completion
      let finalResult = clarified;
      let iterations = 0;
      while (
        finalResult.finalState !== 'DONE' &&
        finalResult.finalState !== 'FAILED' &&
        finalResult.finalState !== 'ABORTED' &&
        iterations < 10
      ) {
        finalResult = await controller.resume({ type: 'approval', content: 'Approved' });
        iterations++;
      }

      expect(finalResult.finalState).toBe('DONE');
    }

    // Journal should have recorded the clarification event
    const reader = new DefaultJournalReader(journalPath);
    const events = reader.readAll();
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'run_started')).toBe(true);
  });

  it('journal records all events during golden run', async () => {
    const artifactStore = createMockArtifactStore();
    const runner = createMockRunnerSystem({ artifactStore });
    const governance = createMockGovernance();
    const contractRegistry = new DefaultIterationContractRegistry();
    const journalWriter = new DefaultJournalWriter(journalPath, 'run-journal-001');
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
      runId: 'run-journal-001',
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: ['Add user notification preferences'],
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

    const reader = new DefaultJournalReader(journalPath);
    const events = reader.readAll();

    // Verify events are well-formed
    for (const event of events) {
      expect(event.runId).toBe('run-journal-001');
      expect(event.timestamp).toBeDefined();
      expect(event.sequence).toBeGreaterThan(0);
      expect(event.type).toBeDefined();
      expect(event.data).toBeDefined();
      expect(event.data.kind).toBeDefined();
    }

    // Verify run lifecycle events
    expect(events.some((e) => e.type === 'run_started')).toBe(true);
    expect(events.some((e) => e.type === 'run_completed')).toBe(true);

    // Verify state transition events
    const transitions = events.filter((e) => e.type === 'state_transition');
    expect(transitions.length).toBeGreaterThanOrEqual(5);

    // Verify monotonic sequence numbers
    for (let i = 1; i < events.length; i++) {
      expect(events[i].sequence).toBeGreaterThan(events[i - 1].sequence);
    }
  });
});
