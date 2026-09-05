import type {
  ArtifactSummary,
  ArtifactType,
  EngineState,
  PersistedState,
  RunManifest,
  TransitionRecord,
} from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import type { DashboardDataSources } from '../default-dashboard-data-provider';
import { DefaultDashboardDataProvider } from '../default-dashboard-data-provider';

const NOW = '2025-01-15T10:05:00Z';

const engine: EngineState = {
  runId: 'run-1',
  currentState: 'PLANNING',
  previousState: 'INTAKE',
  stateEnteredAt: '2025-01-15T10:01:00Z',
  transitionCount: 1,
  isWaitingForHuman: false,
};

const manifest: RunManifest = {
  runId: 'run-1',
  version: '1.0.0',
  repository: '/repo',
  workflow: { name: 'default', version: '1.0.0' },
  timing: {
    startedAt: '2025-01-15T10:00:00Z',
    completedAt: '2025-01-15T10:10:00Z',
    totalDurationMs: 600_000,
    stateTimings: [
      {
        stateId: 'INTAKE',
        enteredAt: '2025-01-15T10:00:00Z',
        exitedAt: '2025-01-15T10:01:00Z',
        durationMs: 60_000,
        visits: 1,
      },
    ],
  },
  status: 'completed',
  finalState: 'DONE',
  activeRoles: [
    {
      role: 'planner',
      dispatches: 1,
      inputTokens: 500,
      outputTokens: 200,
      totalDurationMs: 3000,
      artifactsProduced: 1,
    },
  ],
  artifactInventory: [],
  totalArtifacts: 3,
  totalArtifactSizeBytes: 500,
  iterations: [
    {
      contractId: 'c1',
      totalIterations: 2,
      judgeArbitrations: 0,
      finalStatus: 'resolved',
      findingsTotal: 3,
      findingsResolved: 3,
    },
  ],
  governanceDecisions: 1,
  escalations: 0,
  humanInterventions: 0,
  agreements: [],
  tokenUsage: { totalInputTokens: 500, totalOutputTokens: 200, totalTokens: 700, byRole: {} },
};

function makeSources(overrides: Partial<DashboardDataSources> = {}): DashboardDataSources {
  return {
    getEngineState: () => engine,
    getStartedAt: () => '2025-01-15T10:00:00Z',
    getStateNames: () => ['INTAKE', 'PLANNING', 'DONE'],
    getStateTypes: () => ({ INTAKE: 'action', PLANNING: 'action', DONE: 'terminal' }),
    getStateLabels: () => ({ INTAKE: 'Intake', PLANNING: 'Planning', DONE: 'Done' }),
    getTransitionRecords: () => [],
    getDefinitionTransitions: () => [],
    getParallelStates: () => new Map(),
    getArtifacts: () => [],
    getManifest: () => manifest,
    getManifests: () => [manifest],
    getPersistedState: () => null,
    getFindings: () => [],
    getArtifactVersionHistory: () => [],
    getSubsystemHealth: () => [],
    getArtifactContentText: () => null,
    getRunConfig: () => null,
    clock: () => NOW,
    ...overrides,
  };
}

function makeArtifact(type: ArtifactType, name: string, version: number): ArtifactSummary {
  return {
    ref: { type, name, version, checksum: 'abc' },
    type,
    name,
    version,
    producedBy: 'test-role',
    createdAt: NOW,
    sizeBytes: 50,
  };
}

function providerWithContent(
  artifacts: ArtifactSummary[],
  contentByKey: Record<string, string>,
): DefaultDashboardDataProvider {
  return new DefaultDashboardDataProvider(
    makeSources({
      getArtifacts: () => artifacts,
      getArtifactContentText: (_runId, type, name, version) => {
        const key = `${type}/${name}@${String(version)}`;
        return contentByKey[key] ?? null;
      },
    }),
  );
}

describe('DefaultDashboardDataProvider', () => {
  it('returns run state view', () => {
    const provider = new DefaultDashboardDataProvider(makeSources());
    const result = provider.getRunState('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.currentState).toBe('PLANNING');
      expect(result.value.elapsedMs).toBe(300_000);
    }
  });

  it('returns error for missing engine state', () => {
    const provider = new DefaultDashboardDataProvider(makeSources({ getEngineState: () => null }));
    const result = provider.getRunState('run-x');
    expect(result.ok).toBe(false);
  });

  it('returns workflow view', () => {
    const transitions: TransitionRecord[] = [
      {
        timestamp: '2025-01-15T10:00:30Z',
        runId: 'run-1',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        guardsEvaluated: [],
        durationMs: 500,
      },
    ];
    const provider = new DefaultDashboardDataProvider(
      makeSources({ getTransitionRecords: () => transitions }),
    );
    const result = provider.getWorkflowView('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.states).toHaveLength(3);
      expect(result.value.transitions).toHaveLength(1);
    }
  });

  it('returns artifact view', () => {
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getArtifacts: () => [
          {
            ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
            type: 'plan',
            name: 'plan',
            version: 1,
            producedBy: 'planner',
            createdAt: NOW,
            sizeBytes: 100,
          },
        ],
      }),
    );
    const result = provider.getArtifactView('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalCount).toBe(1);
      expect(result.value.totalSizeBytes).toBe(100);
    }
  });

  it('returns iteration view from manifest', () => {
    const provider = new DefaultDashboardDataProvider(makeSources());
    const result = provider.getIterationView('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalIterations).toBe(2);
      expect(result.value.totalFindings).toBe(3);
    }
  });

  it('returns iteration view from persisted state when no manifest', () => {
    const liveState: PersistedState = {
      runId: 'run-active' as PersistedState['runId'],
      schemaVersion: 1,
      currentState: 'CODE_REVIEW',
      previousState: 'IMPLEMENTATION',
      stateEnteredAt: '2025-01-15T10:03:00Z',
      transitionCount: 4,
      stateHistory: ['INTAKE', 'PLANNING', 'IMPLEMENTATION', 'CODE_REVIEW'],
      iterationCounts: { implementation_review_loop: 2, plan_review_loop: 1 },
      judgeArbitrationCounts: { implementation_review_loop: 1 },
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: '2025-01-15T10:03:00Z',
      persistenceVersion: 1,
      checksum: '',
    };
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getManifest: () => null,
        getPersistedState: () => liveState,
        getContractLimits: () => ({ plan_review_loop: 5, implementation_review_loop: 5 }),
      }),
    );
    const result = provider.getIterationView('run-active');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contracts).toHaveLength(2);
      const impl = result.value.contracts.find(
        (c) => c.contractId === 'implementation_review_loop',
      );
      expect(impl?.currentIteration).toBe(2);
      expect(impl?.maxIterations).toBe(5);
      expect(impl?.judgeArbitrations).toBe(1);
    }
  });

  it('returns empty iteration view when neither manifest nor state available', () => {
    const provider = new DefaultDashboardDataProvider(
      makeSources({ getManifest: () => null, getPersistedState: () => null }),
    );
    const result = provider.getIterationView('run-missing');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contracts).toHaveLength(0);
      expect(result.value.totalIterations).toBe(0);
    }
  });

  it('enriches manifest iterations with journal findings when manifest counts are zero', () => {
    const manifestWithZeroFindings: RunManifest = {
      ...manifest,
      iterations: [
        {
          contractId: 'implementation_review_loop',
          totalIterations: 3,
          judgeArbitrations: 0,
          finalStatus: 'resolved',
          findingsTotal: 0,
          findingsResolved: 0,
        },
      ],
    };
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getManifest: () => manifestWithZeroFindings,
        getFindings: () => [
          {
            id: 'f1',
            severity: 'high',
            status: 'open',
            category: 'bug',
            description: 'NPE',
            source: 'review',
            iteration: 0,
          },
          {
            id: 'f2',
            severity: 'low',
            status: 'resolved',
            category: 'style',
            description: 'naming',
            source: 'review',
            iteration: 1,
          },
          {
            id: 'f3',
            severity: 'medium',
            status: 'resolved',
            category: 'bug',
            description: 'leak',
            source: 'review',
            iteration: 2,
          },
        ],
      }),
    );
    const result = provider.getIterationView('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contracts).toHaveLength(1);
      expect(result.value.contracts[0].findingsTotal).toBe(3);
      expect(result.value.contracts[0].findingsResolved).toBe(2);
    }
  });

  it('preserves manifest finding counts when already populated', () => {
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getFindings: () => [
          {
            id: 'f1',
            severity: 'high',
            status: 'open',
            category: 'bug',
            description: 'NPE',
            source: 'review',
            iteration: 0,
          },
        ],
      }),
    );
    const result = provider.getIterationView('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contracts[0].findingsTotal).toBe(3);
      expect(result.value.contracts[0].findingsResolved).toBe(3);
    }
  });

  it('deduplicates findings by id when enriching iterations', () => {
    const manifestWithZeroFindings: RunManifest = {
      ...manifest,
      iterations: [
        {
          contractId: 'c1',
          totalIterations: 2,
          judgeArbitrations: 0,
          finalStatus: 'resolved',
          findingsTotal: 0,
          findingsResolved: 0,
        },
      ],
    };
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getManifest: () => manifestWithZeroFindings,
        getFindings: () => [
          {
            id: 'f1',
            severity: 'high',
            status: 'open',
            category: 'bug',
            description: 'NPE',
            source: 'review',
            iteration: 0,
          },
          {
            id: 'f1',
            severity: 'high',
            status: 'resolved',
            category: 'bug',
            description: 'NPE',
            source: 'review',
            iteration: 1,
          },
        ],
      }),
    );
    const result = provider.getIterationView('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contracts[0].findingsTotal).toBe(1);
      expect(result.value.contracts[0].findingsResolved).toBe(1);
    }
  });

  it('passes contract limits through to iteration view for live runs', () => {
    const liveState: PersistedState = {
      runId: 'run-active' as PersistedState['runId'],
      schemaVersion: 1,
      currentState: 'CODE_REVIEW',
      previousState: 'IMPLEMENTATION',
      stateEnteredAt: '2025-01-15T10:03:00Z',
      transitionCount: 4,
      stateHistory: ['INTAKE', 'PLANNING', 'IMPLEMENTATION', 'CODE_REVIEW'],
      iterationCounts: { implementation_review_loop: 3 },
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: '2025-01-15T10:03:00Z',
      persistenceVersion: 1,
      checksum: '',
    };
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getManifest: () => null,
        getPersistedState: () => liveState,
        getContractLimits: () => ({ implementation_review_loop: 5 }),
        getFindings: () => [
          {
            id: 'f1',
            severity: 'high',
            status: 'open',
            category: 'bug',
            description: 'NPE',
            source: 'review',
            iteration: 0,
          },
        ],
      }),
    );
    const result = provider.getIterationView('run-active');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const c = result.value.contracts[0];
      expect(c.currentIteration).toBe(3);
      expect(c.maxIterations).toBe(5);
      expect(c.status).toBe('in_progress');
      expect(result.value.totalFindings).toBe(1);
      expect(result.value.resolvedFindings).toBe(0);
    }
  });

  it('returns findings view', () => {
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getFindings: () => [
          {
            id: 'f1',
            severity: 'high',
            status: 'open',
            category: 'bug',
            description: 'NPE',
            source: 'review',
            iteration: 1,
          },
        ],
      }),
    );
    const result = provider.getFindingsView('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalCount).toBe(1);
    }
  });

  it('returns usage view', () => {
    const provider = new DefaultDashboardDataProvider(makeSources());
    const result = provider.getUsageView('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalTokens).toBe(700);
    }
  });

  it('returns usage view from persisted state when manifest unavailable', () => {
    const liveState: PersistedState = {
      runId: 'run-active' as PersistedState['runId'],
      schemaVersion: 1,
      currentState: 'IMPLEMENTATION',
      previousState: 'PLANNING',
      stateEnteredAt: '2025-01-15T10:03:00Z',
      transitionCount: 2,
      stateHistory: ['INTAKE', 'PLANNING', 'IMPLEMENTATION'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: '2025-01-15T10:03:00Z',
      persistenceVersion: 1,
      checksum: '',
      cumulativeInputTokens: 800,
      cumulativeOutputTokens: 400,
      workerMetricsByRole: {
        planner: {
          inputTokens: 300,
          outputTokens: 150,
          dispatches: 1,
          durationMs: 2000,
          artifactsProduced: 1,
        },
        coder: {
          inputTokens: 500,
          outputTokens: 250,
          dispatches: 2,
          durationMs: 4000,
          artifactsProduced: 0,
        },
      },
    };
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getManifest: () => null,
        getPersistedState: () => liveState,
      }),
    );
    const result = provider.getUsageView('run-active');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalInputTokens).toBe(800);
      expect(result.value.totalOutputTokens).toBe(400);
      expect(result.value.totalTokens).toBe(1200);
      expect(result.value.byRole).toHaveLength(2);
    }
  });

  it('returns error when neither manifest nor persisted state available', () => {
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getManifest: () => null,
        getPersistedState: () => null,
      }),
    );
    const result = provider.getUsageView('run-missing');
    expect(result.ok).toBe(false);
  });

  it('returns run history', () => {
    const provider = new DefaultDashboardDataProvider(makeSources());
    const result = provider.getRunHistory();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].runId).toBe('run-1');
    }
  });

  it('enriches run history with sources from config snapshot', () => {
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getRunConfig: () => ({ sources: ['Add dark mode support'] }),
      }),
    );
    const result = provider.getRunHistory();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].sources).toEqual(['Add dark mode support']);
    }
  });

  it('returns run history without sources when config has none', () => {
    const provider = new DefaultDashboardDataProvider(makeSources({ getRunConfig: () => ({}) }));
    const result = provider.getRunHistory();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].sources).toBeUndefined();
    }
  });

  it('falls back to config-snapshot repoRoot when manifest has none', () => {
    const manifestWithoutRepo: RunManifest = { ...manifest, repoRoot: undefined };
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getManifests: () => [manifestWithoutRepo],
        getRunConfig: () => ({ repoRoot: '/home/user/my-project' }),
      }),
    );
    const result = provider.getRunHistory();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].repoRoot).toBe('/home/user/my-project');
    }
  });

  it('does not override manifest repoRoot with config-snapshot value', () => {
    const manifestWithRepo: RunManifest = {
      ...manifest,
      repoRoot: '/from/manifest',
    };
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getManifests: () => [manifestWithRepo],
        getRunConfig: () => ({ repoRoot: '/from/config' }),
      }),
    );
    const result = provider.getRunHistory();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].repoRoot).toBe('/from/manifest');
    }
  });

  it('returns run history entries for synthetic running manifests', () => {
    const runningManifest: RunManifest = {
      ...manifest,
      runId: 'run-live',
      status: 'running',
      finalState: 'PLANNING',
      timing: {
        ...manifest.timing,
        completedAt: '',
        totalDurationMs: 0,
      },
    };
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getManifests: () => [runningManifest],
      }),
    );
    const result = provider.getRunHistory();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({
        runId: 'run-live',
        status: 'running',
        finalState: 'PLANNING',
      });
    }
  });

  it('returns system health', () => {
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getSubsystemHealth: () => [
          {
            subsystem: 'event-system',
            status: 'healthy',
            lastCheckedAt: NOW,
            consecutiveFailures: 0,
            checks: [
              {
                subsystem: 'event-system',
                status: 'healthy',
                message: 'OK',
                checkedAt: NOW,
                durationMs: 1,
                details: {},
              },
            ],
          },
        ],
      }),
    );
    const result = provider.getSystemHealth();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.overallStatus).toBe('healthy');
      expect(result.value.subsystems).toHaveLength(1);
    }
  });

  it('returns healthy status when no subsystems', () => {
    const provider = new DefaultDashboardDataProvider(makeSources());
    const result = provider.getSystemHealth();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.overallStatus).toBe('healthy');
    }
  });

  it('extracts version from subsystem health check details', () => {
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getSubsystemHealth: () => [
          {
            subsystem: 'runner:claude-code',
            status: 'healthy',
            lastCheckedAt: NOW,
            consecutiveFailures: 0,
            checks: [
              {
                subsystem: 'runner:claude-code',
                status: 'healthy',
                message: 'Native bidirectional protocol',
                checkedAt: NOW,
                durationMs: 1,
                details: { version: 'claude 1.2.3' },
              },
            ],
          },
        ],
      }),
    );
    const result = provider.getSystemHealth();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subsystems).toHaveLength(1);
      expect(result.value.subsystems[0].version).toBe('claude 1.2.3');
    }
  });

  it('returns undefined version when details has no version field', () => {
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getSubsystemHealth: () => [
          {
            subsystem: 'runner:cursor',
            status: 'healthy',
            lastCheckedAt: NOW,
            consecutiveFailures: 0,
            checks: [
              {
                subsystem: 'runner:cursor',
                status: 'healthy',
                message: 'Cursor CLI detected',
                checkedAt: NOW,
                durationMs: 1,
                details: {},
              },
            ],
          },
        ],
      }),
    );
    const result = provider.getSystemHealth();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subsystems[0].version).toBeUndefined();
    }
  });

  it('returns undefined version when subsystem has no checks', () => {
    const provider = new DefaultDashboardDataProvider(
      makeSources({
        getSubsystemHealth: () => [
          {
            subsystem: 'workflow-engine',
            status: 'healthy',
            lastCheckedAt: NOW,
            consecutiveFailures: 0,
            checks: [],
          },
        ],
      }),
    );
    const result = provider.getSystemHealth();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subsystems[0].version).toBeUndefined();
      expect(result.value.subsystems[0].message).toBe('No checks yet');
    }
  });

  describe('buildBudgetSummary via getUsageView', () => {
    it('returns no budgetSummary when no run config exists', () => {
      const provider = new DefaultDashboardDataProvider(makeSources({ getRunConfig: () => null }));
      const result = provider.getUsageView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.budgetSummary).toBeUndefined();
      }
    });

    it('returns no budgetSummary when maxTokensPerRun is null', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getRunConfig: () => ({
            governance: { budget: { maxTokensPerRun: null } },
          }),
        }),
      );
      const result = provider.getUsageView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.budgetSummary).toBeUndefined();
      }
    });

    it('returns budgetSummary with configuredMaxTokens and budgetExceeded=false', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getRunConfig: () => ({
            governance: { budget: { maxTokensPerRun: 10_000 } },
          }),
        }),
      );
      const result = provider.getUsageView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const bs = result.value.budgetSummary;
        expect(bs).toBeDefined();
        expect(bs?.configuredMaxTokens).toBe(10_000);
        expect(bs?.budgetExceeded).toBe(false);
      }
    });

    it('returns budgetExceeded=true when usage exceeds budget', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getRunConfig: () => ({
            governance: { budget: { maxTokensPerRun: 500 } },
          }),
        }),
      );
      const result = provider.getUsageView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.budgetSummary?.budgetExceeded).toBe(true);
      }
    });

    it('populates alertThresholds sorted from run config', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getRunConfig: () => ({
            governance: {
              budget: {
                maxTokensPerRun: 10_000,
                alertThresholds: [0.9, 0.5, 0.75],
              },
            },
          }),
        }),
      );
      const result = provider.getUsageView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.budgetSummary?.alertThresholds).toEqual([0.5, 0.75, 0.9]);
      }
    });

    it('computes crossedThresholds based on usage ratio', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getRunConfig: () => ({
            governance: {
              budget: {
                maxTokensPerRun: 1000,
                alertThresholds: [0.25, 0.5, 0.75, 0.9],
              },
            },
          }),
        }),
      );
      const result = provider.getUsageView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        // totalTokens is 700, maxTokens is 1000, ratio = 0.7
        expect(result.value.budgetSummary?.crossedThresholds).toEqual([0.25, 0.5]);
      }
    });

    it('returns no crossedThresholds when usage is below all thresholds', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getRunConfig: () => ({
            governance: {
              budget: {
                maxTokensPerRun: 100_000,
                alertThresholds: [0.5, 0.75, 0.9],
              },
            },
          }),
        }),
      );
      const result = provider.getUsageView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        // totalTokens is 700, maxTokens is 100_000, ratio = 0.007
        expect(result.value.budgetSummary?.crossedThresholds).toEqual([]);
      }
    });

    it('returns undefined alertThresholds when none configured', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getRunConfig: () => ({
            governance: { budget: { maxTokensPerRun: 10_000 } },
          }),
        }),
      );
      const result = provider.getUsageView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.budgetSummary?.alertThresholds).toBeUndefined();
        expect(result.value.budgetSummary?.crossedThresholds).toBeUndefined();
      }
    });

    it('prefers manifest budgetSummary values over raw config', () => {
      const manifestWithBudget: RunManifest = {
        ...manifest,
        budgetSummary: {
          configuredMaxTokens: 5000,
          budgetExceeded: true,
        },
      };
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getManifest: () => manifestWithBudget,
          getRunConfig: () => ({
            governance: { budget: { maxTokensPerRun: 99_999 } },
          }),
        }),
      );
      const result = provider.getUsageView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.budgetSummary?.configuredMaxTokens).toBe(5000);
        expect(result.value.budgetSummary?.budgetExceeded).toBe(true);
      }
    });

    it('filters out non-number values from alertThresholds', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getRunConfig: () => ({
            governance: {
              budget: {
                maxTokensPerRun: 10_000,
                alertThresholds: [0.5, 'bad' as unknown as number, 0.9],
              },
            },
          }),
        }),
      );
      const result = provider.getUsageView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.budgetSummary?.alertThresholds).toEqual([0.5, 0.9]);
      }
    });
  });

  describe('verdict extraction', () => {
    it('extracts approved from boolean approved field', () => {
      const a = makeArtifact('plan_review', 'review-1', 1);
      const provider = providerWithContent([a], {
        'plan_review/review-1@1': JSON.stringify({ approved: true }),
      });
      const result = provider.getArtifactView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts[0].verdict).toBe('approved');
      }
    });

    it('extracts rejected from boolean approved=false field', () => {
      const a = makeArtifact('static_review', 'review-1', 1);
      const provider = providerWithContent([a], {
        'static_review/review-1@1': JSON.stringify({ approved: false }),
      });
      const result = provider.getArtifactView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts[0].verdict).toBe('rejected');
      }
    });

    it('extracts approved from boolean passed field', () => {
      const a = makeArtifact('acceptance_validation', 'av-1', 1);
      const provider = providerWithContent([a], {
        'acceptance_validation/av-1@1': JSON.stringify({ passed: true }),
      });
      const result = provider.getArtifactView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts[0].verdict).toBe('approved');
      }
    });

    it('extracts rejected from boolean passed=false field', () => {
      const a = makeArtifact('verification', 'v-1', 2);
      const provider = providerWithContent([a], {
        'verification/v-1@2': JSON.stringify({ passed: false }),
      });
      const result = provider.getArtifactView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts[0].verdict).toBe('rejected');
      }
    });

    it('extracts approvalStatus string values', () => {
      const approved = makeArtifact('planning_agreement', 'ag-1', 1);
      const conditional = makeArtifact('implementation_agreement', 'ag-2', 1);
      const rejected = makeArtifact('verification_agreement', 'ag-3', 1);
      const provider = providerWithContent([approved, conditional, rejected], {
        'planning_agreement/ag-1@1': JSON.stringify({ approvalStatus: 'approved' }),
        'implementation_agreement/ag-2@1': JSON.stringify({
          approvalStatus: 'conditionally_approved',
        }),
        'verification_agreement/ag-3@1': JSON.stringify({ approvalStatus: 'rejected' }),
      });
      const result = provider.getArtifactView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts[0].verdict).toBe('approved');
        expect(result.value.artifacts[1].verdict).toBe('conditionally_approved');
        expect(result.value.artifacts[2].verdict).toBe('rejected');
      }
    });

    it('extracts verdict approve/request_changes fields', () => {
      const approve = makeArtifact('judge_decision', 'jd-1', 1);
      const reject = makeArtifact('judge_decision', 'jd-2', 1);
      const provider = providerWithContent([approve, reject], {
        'judge_decision/jd-1@1': JSON.stringify({ verdict: 'approve' }),
        'judge_decision/jd-2@1': JSON.stringify({ verdict: 'request_changes' }),
      });
      const result = provider.getArtifactView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts[0].verdict).toBe('approved');
        expect(result.value.artifacts[1].verdict).toBe('rejected');
      }
    });

    it('returns undefined verdict for non-JSON content', () => {
      const a = makeArtifact('review_report', 'rr-1', 1);
      const provider = providerWithContent([a], {
        'review_report/rr-1@1': 'not valid json',
      });
      const result = provider.getArtifactView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts[0].verdict).toBeUndefined();
      }
    });

    it('returns undefined verdict when JSON has no verdict fields', () => {
      const a = makeArtifact('plan_review', 'pr-1', 1);
      const provider = providerWithContent([a], {
        'plan_review/pr-1@1': JSON.stringify({ summary: 'looks good' }),
      });
      const result = provider.getArtifactView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts[0].verdict).toBeUndefined();
      }
    });

    it('skips non-verdict artifact types', () => {
      const a = makeArtifact('plan', 'plan-1', 1);
      const provider = providerWithContent([a], {
        'plan/plan-1@1': JSON.stringify({ approved: true }),
      });
      const result = provider.getArtifactView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts[0].verdict).toBeUndefined();
      }
    });

    it('returns undefined verdict when content is unavailable', () => {
      const a = makeArtifact('security_review', 'sr-1', 1);
      const provider = providerWithContent([a], {});
      const result = provider.getArtifactView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts[0].verdict).toBeUndefined();
      }
    });
  });

  describe('getArtifactContent content type detection', () => {
    it('detects JSON content from object string', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifactContentText: () => JSON.stringify({ key: 'value' }),
        }),
      );
      const result = provider.getArtifactContent('run-1', 'plan', 'plan-1', 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contentType).toBe('json');
      }
    });

    it('detects JSON content from array string', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifactContentText: () => JSON.stringify([1, 2, 3]),
        }),
      );
      const result = provider.getArtifactContent('run-1', 'plan', 'plan-1', 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contentType).toBe('json');
      }
    });

    it('detects diff content starting with ---', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifactContentText: () => '--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@',
        }),
      );
      const result = provider.getArtifactContent('run-1', 'implementation', 'diff-1', 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contentType).toBe('diff');
      }
    });

    it('detects diff content starting with @@', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifactContentText: () => '@@ -1,3 +1,3 @@\n-old line\n+new line',
        }),
      );
      const result = provider.getArtifactContent('run-1', 'implementation', 'diff-2', 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contentType).toBe('diff');
      }
    });

    it('detects diff content starting with "diff "', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifactContentText: () => 'diff --git a/file.ts b/file.ts',
        }),
      );
      const result = provider.getArtifactContent('run-1', 'implementation', 'diff-3', 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contentType).toBe('diff');
      }
    });

    it('detects markdown content containing #', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifactContentText: () => '# Heading\nSome paragraph text',
        }),
      );
      const result = provider.getArtifactContent('run-1', 'plan', 'md-1', 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contentType).toBe('markdown');
      }
    });

    it('detects markdown content containing **', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifactContentText: () => 'Some text with **bold** words',
        }),
      );
      const result = provider.getArtifactContent('run-1', 'plan', 'md-2', 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contentType).toBe('markdown');
      }
    });

    it('detects plain text when no special markers', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifactContentText: () => 'just some plain text without markers',
        }),
      );
      const result = provider.getArtifactContent('run-1', 'plan', 'txt-1', 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contentType).toBe('text');
      }
    });

    it('returns error when no content found', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifactContentText: () => null,
        }),
      );
      const result = provider.getArtifactContent('run-1', 'plan', 'missing', 1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('No content for artifact');
      }
    });
  });

  describe('getRunState manifest status override', () => {
    it('overrides running status with completed from manifest', () => {
      const completedManifest: RunManifest = { ...manifest, status: 'completed' };
      const runningEngine: EngineState = { ...engine, currentState: 'PLANNING' };
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getEngineState: () => runningEngine,
          getManifest: () => completedManifest,
          getStateTypes: () => ({ INTAKE: 'action', PLANNING: 'action', DONE: 'terminal' }),
        }),
      );
      const result = provider.getRunState('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
      }
    });

    it('overrides running status with failed from manifest', () => {
      const failedManifest: RunManifest = { ...manifest, status: 'failed' };
      const runningEngine: EngineState = { ...engine, currentState: 'PLANNING' };
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getEngineState: () => runningEngine,
          getManifest: () => failedManifest,
          getStateTypes: () => ({ INTAKE: 'action', PLANNING: 'action', DONE: 'terminal' }),
        }),
      );
      const result = provider.getRunState('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
      }
    });

    it('does not override running status when manifest says running', () => {
      const runningManifest: RunManifest = { ...manifest, status: 'running' };
      const runningEngine: EngineState = { ...engine, currentState: 'PLANNING' };
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getEngineState: () => runningEngine,
          getManifest: () => runningManifest,
          getStateTypes: () => ({ INTAKE: 'action', PLANNING: 'action', DONE: 'terminal' }),
        }),
      );
      const result = provider.getRunState('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('running');
      }
    });

    it('does not override running status when manifest says interrupted', () => {
      const interruptedManifest: RunManifest = { ...manifest, status: 'interrupted' };
      const runningEngine: EngineState = { ...engine, currentState: 'PLANNING' };
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getEngineState: () => runningEngine,
          getManifest: () => interruptedManifest,
          getStateTypes: () => ({ INTAKE: 'action', PLANNING: 'action', DONE: 'terminal' }),
        }),
      );
      const result = provider.getRunState('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('running');
      }
    });

    it('uses terminal stateEnteredAt as endTime for terminal states', () => {
      const terminalEngine: EngineState = {
        ...engine,
        currentState: 'DONE',
        stateEnteredAt: '2025-01-15T10:10:00Z',
      };
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getEngineState: () => terminalEngine,
          getStateTypes: () => ({ INTAKE: 'action', PLANNING: 'action', DONE: 'terminal' }),
        }),
      );
      const result = provider.getRunState('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.elapsedMs).toBe(600_000);
      }
    });
  });

  describe('getRunState repoRoot', () => {
    it('includes repoRoot from manifest', () => {
      const manifestWithRepo: RunManifest = { ...manifest, repoRoot: '/my/repo' };
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getManifest: () => manifestWithRepo,
        }),
      );
      const result = provider.getRunState('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.repoRoot).toBe('/my/repo');
      }
    });
  });

  describe('getRunState processAlive', () => {
    it('includes processAlive true when process is alive', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          isProcessAlive: () => true,
        }),
      );
      const result = provider.getRunState('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.processAlive).toBe(true);
      }
    });

    it('includes processAlive false when process is dead', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          isProcessAlive: () => false,
        }),
      );
      const result = provider.getRunState('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.processAlive).toBe(false);
      }
    });

    it('omits processAlive when isProcessAlive is not provided', () => {
      const provider = new DefaultDashboardDataProvider(makeSources());
      const result = provider.getRunState('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.processAlive).toBeUndefined();
      }
    });

    it('omits processAlive for terminal states', () => {
      const terminalEngine = {
        ...engine,
        currentState: 'DONE',
      };
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getEngineState: () => terminalEngine,
          isProcessAlive: () => false,
        }),
      );
      const result = provider.getRunState('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.processAlive).toBeUndefined();
      }
    });
  });

  describe('getArtifactDetail', () => {
    it('returns error when artifact not found', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifacts: () => [],
        }),
      );
      const result = provider.getArtifactDetail('run-1', {
        type: 'plan',
        name: 'missing',
        version: 1,
        checksum: 'abc',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('No artifact');
      }
    });

    it('returns detail when artifact found with version history', () => {
      const artifact = makeArtifact('plan', 'my-plan', 2);
      const v1Ref = { type: 'plan' as const, name: 'my-plan', version: 1, checksum: 'aaa' };
      const v2Ref = { type: 'plan' as const, name: 'my-plan', version: 2, checksum: 'bbb' };
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getArtifacts: () => [artifact],
          getArtifactVersionHistory: () => [v1Ref, v2Ref],
        }),
      );
      const result = provider.getArtifactDetail('run-1', {
        type: 'plan',
        name: 'my-plan',
        version: 2,
        checksum: 'abc',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe('plan');
        expect(result.value.name).toBe('my-plan');
        expect(result.value.currentVersion).toBe(2);
        expect(result.value.versions).toHaveLength(2);
      }
    });
  });

  describe('getRunEvents', () => {
    it('returns events from sources', () => {
      const events = [
        { type: 'state_changed' as const, timestamp: NOW, runId: 'run-1', data: {} },
        { type: 'artifact_produced' as const, timestamp: NOW, runId: 'run-1', data: {} },
      ];
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getRunEvents: () => events,
        }),
      );
      const result = provider.getRunEvents('run-1');
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('state_changed');
    });

    it('returns empty array when getRunEvents is not defined', () => {
      const sources = makeSources();
      delete (sources as Record<string, unknown>)['getRunEvents'];
      const provider = new DefaultDashboardDataProvider(sources);
      const result = provider.getRunEvents('run-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('getSessionsView', () => {
    it('returns empty array when getSessionSnapshots is not defined', () => {
      const sources = makeSources();
      delete (sources as Record<string, unknown>)['getSessionSnapshots'];
      const provider = new DefaultDashboardDataProvider(sources);
      const result = provider.getSessionsView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns mapped session views from snapshots', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getSessionSnapshots: () => [
            {
              ref: {
                sessionId: 'sess-1',
                runId: 'run-1',
                role: 'planner',
                stateId: 'PLANNING',
                transport: 'stdio',
              },
              state: 'running',
              pendingRequests: [
                {
                  requestId: 'req-1',
                  kind: 'permission' as const,
                  createdAt: NOW,
                  payload: { action: 'write', resource: 'file.ts' },
                },
              ],
              lastProtocolTimestamp: NOW,
              createdAt: NOW,
              updatedAt: NOW,
              expiresAt: '2025-01-15T11:00:00Z',
              error: undefined,
            },
          ],
        }),
      );
      const result = provider.getSessionsView('run-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        const view = result.value[0];
        expect(view.sessionId).toBe('sess-1');
        expect(view.role).toBe('planner');
        expect(view.state).toBe('running');
        expect(view.pendingRequestKind).toBe('permission');
        expect(view.pendingRequestId).toBe('req-1');
        expect(view.transport).toBe('stdio');
      }
    });

    it('returns error when getSessionSnapshots throws', () => {
      const provider = new DefaultDashboardDataProvider(
        makeSources({
          getSessionSnapshots: () => {
            throw new Error('snapshot failure');
          },
        }),
      );
      const result = provider.getSessionsView('run-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to load sessions');
        expect(result.error.message).toContain('snapshot failure');
      }
    });
  });
});
