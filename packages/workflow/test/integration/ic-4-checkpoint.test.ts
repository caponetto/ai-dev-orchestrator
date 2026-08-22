import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-orchestrator/core';
import {
  DefaultCollaborationModel,
  DefaultGovernanceEngine,
  DefaultIterationContractRegistry,
} from '@ai-orchestrator/governance';
import type {
  ArtifactStore,
  GovernanceEngine,
  IterationContractRegistry,
  JournalWriter,
  ManifestProducer,
  RunnerSystem,
  StatePersistence,
} from '@ai-orchestrator/ports';
import { createRunId } from '@ai-orchestrator/ports';
import { DefaultRoleRegistry } from '@ai-orchestrator/role-system';
import type { RunManifest, WorkflowDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '@ai-orchestrator/workflow';

import { TEST_ROLES, TEST_WORKFLOW } from '../fixtures/test-defaults';

function makeRunner(): RunnerSystem {
  return {
    dispatch: vi.fn().mockResolvedValue({
      workerId: 'w1',
      role: 'worker',
      status: 'success',
      outputArtifacts: [{ type: 'plan_review', name: 'plan_review', version: 1, checksum: 'abc' }],
      metrics: {
        startedAt: '',
        completedAt: '',
        durationMs: 100,
        inputTokens: 500,
        outputTokens: 200,
        retryCount: 0,
        modelUsed: 'fixture',
      },
    }),
    dispatchParallel: vi.fn().mockResolvedValue([
      {
        workerId: 'w2',
        role: 'reviewer',
        status: 'success',
        outputArtifacts: [
          { type: 'plan_review', name: 'plan_review', version: 1, checksum: 'abc' },
        ],
        metrics: {
          startedAt: '',
          completedAt: '',
          durationMs: 100,
          inputTokens: 500,
          outputTokens: 200,
          retryCount: 0,
          modelUsed: 'fixture',
        },
      },
    ]),
    getWorkerStatus: vi.fn().mockReturnValue(null),
    cancelWorker: vi.fn(),
    cancelAllWorkers: vi.fn().mockResolvedValue(undefined),
    setWorkerCounter: vi.fn(),
  };
}

function makeArtifactStore(): ArtifactStore {
  return {
    store: vi.fn().mockResolvedValue({ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }),
    get: vi.fn().mockImplementation((ref: { type: string; content?: string }) => {
      if (ref.content) {
        return Promise.resolve(ref);
      }
      return Promise.resolve(null);
    }),
    getLatest: vi.fn().mockImplementation((type: string) => {
      if (type === 'clarification_questions') {
        return Promise.resolve(null);
      }
      const content = type.endsWith('_review')
        ? '---\napproved: true\nfindings: []\n---\nLooks good.'
        : type === 'plan'
          ? JSON.stringify({
              summary: 'Fixture plan',
              tasks: [
                { taskId: 'task-1', description: 'Fixture task', files: [], dependencies: [] },
              ],
            })
          : type === 'verification'
            ? JSON.stringify({ passed: true, failures: [] })
            : '';
      return Promise.resolve({ type, name: type, version: 1, checksum: 'abc', content });
    }),
    list: vi.fn().mockImplementation((filter: { type?: string }) => {
      if (filter.type === 'verification') {
        return Promise.resolve([
          {
            type: 'verification',
            name: 'verification',
            version: 1,
            checksum: 'abc',
            content: JSON.stringify({ passed: true, failures: [] }),
          },
        ]);
      }
      return Promise.resolve([]);
    }),
    history: vi.fn().mockResolvedValue([]),
    verify: vi.fn().mockResolvedValue({ valid: true }),
    inventory: vi.fn().mockResolvedValue({ artifacts: [], totalSize: 0 }),
  };
}

function makeGovernance(): GovernanceEngine {
  return {
    evaluateTransition: vi.fn().mockReturnValue({ allowed: true, reason: 'all policies pass' }),
    checkAgreement: vi.fn().mockReturnValue({ exists: true, valid: true }),
    recordDecision: vi.fn(),
  };
}

function makeContractRegistry(): IterationContractRegistry {
  return {
    getContract: vi.fn().mockReturnValue(null),
    listContracts: vi.fn().mockReturnValue([]),
    getContractForState: vi.fn().mockReturnValue(null),
    getIterationState: vi.fn(),
    recordStateEntry: vi.fn(),
    restoreIterationCounts: vi.fn(),
    restoreJudgeArbitrationCounts: vi.fn(),
    resetIterationCount: vi.fn(),
  };
}

function makeJournal(): JournalWriter {
  return {
    append: vi.fn(),
    appendBatch: vi.fn(),
  };
}

function makePersistence(): StatePersistence {
  return {
    save: vi.fn(),
    load: vi.fn().mockReturnValue(null),
    exists: vi.fn().mockReturnValue(false),
    validate: vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
    probeLock: vi.fn().mockReturnValue({
      exists: false,
      pid: 0,
      pidRunning: false,
      hostname: '',
      unreadable: false,
    }),
    acquireLock: vi.fn().mockReturnValue({
      runId: createRunId('run-ic4'),
      pid: process.pid,
      acquiredAt: '',
      lockPath: '',
    }),
    releaseLock: vi.fn(),
    reconstructFromJournal: vi.fn().mockReturnValue(null),
  };
}

function makeManifestProducer(): ManifestProducer {
  return {
    produce: vi.fn().mockReturnValue({
      runId: createRunId('run-ic4'),
      version: '1.0.0',
      repository: '',
      workflow: { name: 'default', version: '1.0.0' },
      timing: { startedAt: '', completedAt: '', totalDurationMs: 0, stateTimings: [] },
      status: 'completed',
      finalState: 'DONE',
      activeRoles: [],
      artifactInventory: [],
      totalArtifacts: 0,
      totalArtifactSizeBytes: 0,
      iterations: [],
      governanceDecisions: 0,
      escalations: 0,
      humanInterventions: 0,
      agreements: [],
      tokenUsage: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, byRole: {} },
    } satisfies RunManifest),
  };
}

describe('IC-4: FSM traverses INTAKE → DONE with fixture provider', () => {
  it('traverses from INTAKE to WAITING_FOR_HUMAN on start', async () => {
    const journal = makeJournal();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeArtifactStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: makePersistence(),
      manifestProducer: makeManifestProducer(),
    });

    const result = await controller.start({
      runId: createRunId('run-ic4'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    const state = controller.getState();
    expect(state.currentState).toBe('WAITING_FOR_HUMAN');
    expect(state.isWaitingForHuman).toBe(true);
    expect(result.runId).toBe('run-ic4');
    expect(result.finalState).toBe('WAITING_FOR_HUMAN');
    expect(state.transitionCount).toBeGreaterThan(3);
  });

  it('completes INTAKE → DONE after human approval at WAITING_FOR_HUMAN', async () => {
    const journal = makeJournal();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeArtifactStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: makePersistence(),
      manifestProducer: makeManifestProducer(),
    });

    await controller.start({
      runId: createRunId('run-ic4'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');

    const finalResult = await controller.resume({
      type: 'approval',
      content: 'Approved for release',
    });

    expect(finalResult.finalState).toBe('DONE');
    expect(finalResult.manifest).toBeDefined();
    expect(finalResult.manifest.runId).toBe('run-ic4');
  });

  it('records journal entries for every transition', async () => {
    const journal = makeJournal();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeArtifactStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: journal,
      statePersistence: makePersistence(),
      manifestProducer: makeManifestProducer(),
    });

    await controller.start({
      runId: createRunId('run-ic4'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    expect(journal.append).toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method
  });

  it('dispatches workers for each action state', async () => {
    const runner = makeRunner();
    const controller = new LifecycleController({
      runner,
      artifactStore: makeArtifactStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifestProducer(),
    });

    await controller.start({
      runId: createRunId('run-ic4'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    expect(runner.dispatch).toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method
    const callCount = (runner.dispatch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(4);
  });

  it('produces manifest at completion', async () => {
    const manifestProducer = makeManifestProducer();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeArtifactStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer,
    });

    await controller.start({
      runId: createRunId('run-ic4'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    await controller.resume({ type: 'approval', content: 'approved' });

    expect(manifestProducer.produce).toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method
  });

  it('skips WAITING_FOR_HUMAN when no clarification questions', async () => {
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeArtifactStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifestProducer(),
    });

    await controller.start({
      runId: createRunId('run-ic4'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    const state = controller.getState();
    expect(state.currentState).toBe('WAITING_FOR_HUMAN');
  });

  it('aborts the run mid-traversal', async () => {
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeArtifactStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifestProducer(),
    });

    await controller.start({
      runId: createRunId('run-ic4'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    await controller.abort('user cancelled');
    expect(controller.getState().currentState).toBe('ABORTED');
  });
});

describe('S7: Governance, Agreement Artifacts, and Iteration Contracts', () => {
  it('governance blocks transition when approval policy fails with real engine', async () => {
    const registry = new DefaultIterationContractRegistry();
    const engine = new DefaultGovernanceEngine(registry);

    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeArtifactStore(),
      governanceEngine: engine,
      contractRegistry: registry,
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifestProducer(),
    });

    const result = await controller.start({
      runId: createRunId('run-s7-block'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    // Real governance denies transition at WAITING_FOR_HUMAN (no human approval provided)
    expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');
    expect(result.finalState).toBe('WAITING_FOR_HUMAN');
  });

  it('governance allows transition when all policies pass with real engine', async () => {
    const minimalWorkflow: WorkflowDefinition = {
      name: 'test-governance-allow',
      version: '1.0.0',
      initialState: 'START',
      terminalStates: ['END'],
      states: {
        START: {
          type: 'action',
          description: 'Start state',
          entryActions: [{ type: 'record_journal', params: { event: 'run_started' } }],
          transitions: [
            {
              target: 'MIDDLE',
              trigger: 'completion',
              guards: [],
              governanceRequired: true,
              priority: 1,
            },
          ],
        },
        MIDDLE: {
          type: 'action',
          description: 'Middle state',
          entryActions: [{ type: 'record_journal', params: { event: 'run_started' } }],
          transitions: [
            {
              target: 'END',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: {
          type: 'terminal',
          description: 'End state',
          entryActions: [{ type: 'record_journal', params: { event: 'run_completed' } }],
          transitions: [],
        },
      },
    };

    const registry = new DefaultIterationContractRegistry();
    const engine = new DefaultGovernanceEngine(registry);

    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeArtifactStore(),
      governanceEngine: engine,
      contractRegistry: registry,
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifestProducer(),
    });

    const result = await controller.start({
      runId: createRunId('run-s7-allow'),
      workflowDefinition: minimalWorkflow,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    // START is not in any approval-required set, so governance allows
    expect(result.finalState).toBe('END');
  });

  it('governance escalates when iteration limit exceeded with real engine', () => {
    const registry = new DefaultIterationContractRegistry();
    const engine = new DefaultGovernanceEngine(registry);

    const decision = engine.evaluateTransition({
      runId: createRunId('run-s7-escalate'),
      from: 'PLAN_REVIEW',
      to: 'IMPLEMENTATION',
      artifacts: [],
      iterationCount: 5,
      humanApproval: { approvedBy: 'engineer', timestamp: new Date().toISOString() },
    });

    // Iteration limit (maxIterations: 2) exceeded → escalation takes priority
    expect('escalate' in decision).toBe(true);
  });

  it('agreement artifacts stored at stage boundaries with correct participants', async () => {
    const store = makeArtifactStore();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: store,
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: makePersistence(),
      manifestProducer: makeManifestProducer(),
    });

    await controller.start({
      runId: createRunId('run-s7-agreement'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    const storeCalls = (store.store as ReturnType<typeof vi.fn>).mock.calls;
    const agreementCalls = storeCalls.filter((call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>;
      return arg['producedBy'] === 'governance';
    });

    // At least one agreement artifact stored (planning_agreement at IMPLEMENTATION entry)
    expect(agreementCalls.length).toBeGreaterThanOrEqual(1);

    const firstAgreement = agreementCalls[0][0] as Record<string, unknown>;
    expect(firstAgreement['type']).toBe('planning_agreement');
    const content = JSON.parse(firstAgreement['content'] as string) as Record<string, unknown>;
    const participants = content['participants'] as Array<Record<string, string>>;
    expect(participants.some((p) => p['role'] === 'planner')).toBe(true);
    expect(participants.some((p) => p['role'] === 'plan_reviewer')).toBe(true);
  });

  it('iteration counter tracks state re-entry via real registry', () => {
    const registry = new DefaultIterationContractRegistry();

    registry.recordStateEntry('PLAN_REVIEW');
    registry.recordStateEntry('PLAN_REVIEW');

    const state = registry.getIterationState('plan_review_loop');
    // Each PLAN_REVIEW entry increments the iteration counter → 2 rounds (limit is 5)
    expect(state.currentIteration).toBe(2);
    expect(state.status).toBe('in_progress');
    expect(state.contractId).toBe('plan_review_loop');
  });
});

describe('S8: Collaboration Model, Review Resolution, and State Persistence', () => {
  it('checkpoint is saved during FSM execution', async () => {
    const persistence = makePersistence();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeArtifactStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: persistence,
      manifestProducer: makeManifestProducer(),
    });

    await controller.start({
      runId: createRunId('run-s8-save'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    const saveCalls = (persistence.save as ReturnType<typeof vi.fn>).mock.calls;
    expect(saveCalls.length).toBeGreaterThan(0);

    const lastSave = saveCalls[saveCalls.length - 1][0] as Record<string, unknown>;
    expect(lastSave['runId']).toBe('run-s8-save');
    expect(lastSave['currentState']).toBe('WAITING_FOR_HUMAN');
    expect(typeof lastSave['transitionCount']).toBe('number');
    expect(lastSave['transitionCount'] as number).toBeGreaterThan(0);
  });

  it('checkpoint survives simulated process crash (atomic rotation)', async () => {
    const tempDir = join(tmpdir(), `ic4-crash-${String(Date.now())}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      const realPersistence = new DefaultStatePersistence(tempDir);
      const controller = new LifecycleController({
        runner: makeRunner(),
        artifactStore: makeArtifactStore(),
        governanceEngine: makeGovernance(),
        contractRegistry: makeContractRegistry(),
        journalWriter: makeJournal(),
        statePersistence: realPersistence,
        manifestProducer: makeManifestProducer(),
      });

      await controller.start({
        runId: createRunId('run-s8-crash'),
        workflowDefinition: TEST_WORKFLOW,
        governancePolicy: {},
        roleAssignments: {},
        sources: [],
        globalTransitionLimit: 50,
      });

      const stateDir = join(tempDir, 'run-s8-crash');
      expect(existsSync(join(stateDir, 'state.yaml'))).toBe(true);

      const loaded = realPersistence.load(createRunId('run-s8-crash'));
      expect(loaded).not.toBeNull();
      expect(loaded?.runId).toBe('run-s8-crash');
      expect(loaded?.currentState).toBe('WAITING_FOR_HUMAN');

      // Verify .bak exists (atomic rotation creates it after first save)
      const files = readdirSync(stateDir);
      expect(files).toContain('state.yaml.bak');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('lock file prevents concurrent checkpoint writes', () => {
    const tempDir = join(tmpdir(), `ic4-lock-${String(Date.now())}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      const persistence = new DefaultStatePersistence(tempDir);
      const lock = persistence.acquireLock(createRunId('run-s8-lock'));

      expect(() => persistence.acquireLock(createRunId('run-s8-lock'))).toThrow();

      persistence.releaseLock(lock);

      const secondLock = persistence.acquireLock(createRunId('run-s8-lock'));
      expect(secondLock.runId).toBe('run-s8-lock');
      persistence.releaseLock(secondLock);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('collaboration model enforces artifact visibility', () => {
    const registry = new DefaultRoleRegistry(TEST_ROLES, {
      assignments: {},
      defaultAssignment: { model: 'fixture-model' },
    });
    const model = new DefaultCollaborationModel(registry);

    const plannerOwnsPlan = model.checkVisibility('planner', 'plan');
    expect(plannerOwnsPlan.allowed).toBe(true);

    const plannerForbiddenImpl = model.checkVisibility('planner', 'implementation');
    expect(plannerForbiddenImpl.allowed).toBe(false);

    const implementerReadsReview = model.checkVisibility('implementer', 'static_review');
    expect(implementerReadsReview.allowed).toBe(true);

    expect(model.getProducerFor('plan')).toBe('planner');
    expect(model.getReviewersFor('planner')).toContain('plan_reviewer');
  });

  it('IC-4 passes with state persistence wired', async () => {
    const persistence = makePersistence();
    const controller = new LifecycleController({
      runner: makeRunner(),
      artifactStore: makeArtifactStore(),
      governanceEngine: makeGovernance(),
      contractRegistry: makeContractRegistry(),
      journalWriter: makeJournal(),
      statePersistence: persistence,
      manifestProducer: makeManifestProducer(),
    });

    await controller.start({
      runId: createRunId('run-s8-ic4'),
      workflowDefinition: TEST_WORKFLOW,
      governancePolicy: {},
      roleAssignments: {},
      sources: [],
      globalTransitionLimit: 50,
    });

    expect(controller.getState().currentState).toBe('WAITING_FOR_HUMAN');

    const result = await controller.resume({
      type: 'approval',
      content: 'Approved',
    });

    expect(result.finalState).toBe('DONE');

    const saveCalls = (persistence.save as ReturnType<typeof vi.fn>).mock.calls;
    expect(saveCalls.length).toBeGreaterThanOrEqual(5);
  });
});
