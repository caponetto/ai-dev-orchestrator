/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

import type {
  AgentSessionSnapshot,
  DashboardEvent,
  PersistedState,
  RunManifest,
  WorkflowDefinition,
} from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks -- vi.mock calls are hoisted automatically by vitest
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue(''),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ mtime: new Date(), size: 0, isDirectory: () => false }),
}));

const mockLoad = vi.fn().mockReturnValue(null);
vi.mock('@ai-dev-orchestrator/core', () => ({
  DefaultStatePersistence: vi.fn().mockImplementation(function (this: {
    load: ReturnType<typeof vi.fn>;
  }) {
    this.load = mockLoad;
  }),
}));

const mockManifestGet = vi.fn().mockReturnValue(null);
const mockManifestList = vi.fn().mockReturnValue([]);
vi.mock('@ai-dev-orchestrator/run-manifest', () => ({
  DefaultManifestQuery: vi.fn().mockImplementation(function (this: {
    get: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  }) {
    this.get = mockManifestGet;
    this.list = mockManifestList;
  }),
}));

const mockReadAll = vi.fn().mockReturnValue([]);
vi.mock('@ai-dev-orchestrator/journal', () => ({
  DefaultJournalReader: vi.fn().mockImplementation(function (this: {
    readAll: ReturnType<typeof vi.fn>;
  }) {
    this.readAll = mockReadAll;
  }),
}));

const mockGetRunsDir = vi.fn<() => string>().mockReturnValue('/fake/runs');
const mockGetJournalPath = vi
  .fn<(dir: string) => string>()
  .mockImplementation((dir) => `${dir}/journal.jsonl`);
const mockGetConfigSnapshotPath = vi
  .fn<(dir: string) => string>()
  .mockImplementation((dir) => `${dir}/config-snapshot.json`);
vi.mock('../../workspace-paths', () => ({
  getRunsDir: (): string => mockGetRunsDir(),
  getJournalPath: (dir: string): string => mockGetJournalPath(dir),
  getConfigSnapshotPath: (dir: string): string => mockGetConfigSnapshotPath(dir),
}));

const mockLoadWorkflowFromConfig = vi.fn<() => WorkflowDefinition | null>().mockReturnValue(null);
vi.mock('../../composition-root', () => ({
  loadWorkflowFromConfig: (): WorkflowDefinition | null => mockLoadWorkflowFromConfig(),
}));

const mockLoadProjectConfig = vi.fn().mockReturnValue({
  workflow: { name: 'test', version: '1.0' },
  roles: { assignments: {} },
  governance: {
    iterationLimits: {
      defaults: {
        maxReviewIterations: 3,
        maxJudgeArbitrations: 2,
        maxClarificationRounds: 2,
        maxAcceptanceIterations: 3,
      },
    },
    qualityGates: {
      specificationReadiness: { minCompletenessScore: 0.8 },
      implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 2 },
    },
  },
  runtime: { logLevel: 'info' },
});
const mockLoadDefaultWorkflow = vi.fn().mockReturnValue({
  name: 'default',
  version: '1.0',
  initialState: 'INIT',
  states: {
    INIT: { type: 'initial', transitions: [] },
    DONE: { type: 'final', transitions: [] },
  },
});
vi.mock('../../project-config', () => ({
  loadProjectConfig: () => mockLoadProjectConfig() as unknown,
  loadDefaultWorkflow: () => mockLoadDefaultWorkflow() as unknown,
}));

const mockDiscoverRunManifest = vi
  .fn<(runId: string) => RunManifest | null>()
  .mockReturnValue(null);
const mockDiscoverRunManifests = vi.fn<() => RunManifest[]>().mockReturnValue([]);
vi.mock('../../run-discovery', () => ({
  discoverRunManifest: (runId: string): RunManifest | null => mockDiscoverRunManifest(runId),
  discoverRunManifests: (): RunManifest[] => mockDiscoverRunManifests(),
}));

const mockBuildContracts = vi.fn().mockReturnValue([
  { id: 'review-loop', maxIterations: 3 },
  { id: 'judge-loop', maxIterations: 2 },
]);
vi.mock('@ai-dev-orchestrator/governance', () => ({
  buildContracts: (limits: unknown) => mockBuildContracts(limits) as unknown,
}));

// ---------------------------------------------------------------------------
// SUT import (must come after vi.mock calls -- vitest hoists them anyway)
// ---------------------------------------------------------------------------

import { buildDataSources, startJournalPoller } from '../data-sources';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalManifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    runId: 'run-1',
    version: '1.0',
    repository: 'test-repo',
    workflow: { name: 'default', version: '1.0' },
    timing: {
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T01:00:00Z',
      totalDurationMs: 3600000,
      stateTimings: [],
    },
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
    tokenUsage: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      byRole: {},
    },
    ...overrides,
  };
}

function makeMinimalPersistedState(overrides: Record<string, unknown> = {}): PersistedState {
  return {
    runId: 'run-1',
    schemaVersion: 1,
    currentState: 'IMPLEMENTING',
    previousState: 'PLANNING',
    stateEnteredAt: '2026-01-01T00:30:00Z',
    transitionCount: 2,
    stateHistory: ['INIT', 'PLANNING', 'IMPLEMENTING'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0',
    persistedAt: '2026-01-01T00:30:00Z',
    persistenceVersion: 1,
    checksum: 'abc123',
    ...overrides,
  } as unknown as PersistedState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildDataSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults
    mockGetRunsDir.mockReturnValue('/fake/runs');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('');
    vi.mocked(readdirSync).mockReturnValue([]);
    mockLoad.mockReturnValue(null);
    mockManifestGet.mockReturnValue(null);
    mockManifestList.mockReturnValue([]);
    mockReadAll.mockReturnValue([]);
    mockDiscoverRunManifest.mockReturnValue(null);
    mockDiscoverRunManifests.mockReturnValue([]);
    mockLoadWorkflowFromConfig.mockReturnValue(null);
  });

  // -------------------------------------------------------------------------
  // getEngineState
  // -------------------------------------------------------------------------

  describe('getEngineState', () => {
    it('returns null when no persisted state and no manifest', () => {
      mockLoad.mockReturnValue(null);
      mockDiscoverRunManifest.mockReturnValue(null);

      const ds = buildDataSources();
      const result = ds.getEngineState('run-1');

      expect(result).toBeNull();
    });

    it('returns manifest-based state when no persisted state exists', () => {
      mockLoad.mockReturnValue(null);
      const manifest = makeMinimalManifest({
        runId: 'run-1',
        finalState: 'DONE',
        status: 'completed',
      });
      mockDiscoverRunManifest.mockReturnValue(manifest);

      const ds = buildDataSources();
      const result = ds.getEngineState('run-1');

      expect(result).not.toBeNull();
      expect(result!.runId).toBe('run-1');
      expect(result!.currentState).toBe('DONE');
      expect(result!.previousState).toBeNull();
      expect(result!.stateEnteredAt).toBe('2026-01-01T00:00:00Z');
      expect(result!.transitionCount).toBe(0);
      expect(result!.isWaitingForHuman).toBe(false);
    });

    it('uses workflow initialState when manifest has no finalState', () => {
      mockLoad.mockReturnValue(null);
      const manifest = makeMinimalManifest({
        runId: 'run-1',
        finalState: '',
        status: 'running',
      });
      mockDiscoverRunManifest.mockReturnValue(manifest);

      const ds = buildDataSources();
      const result = ds.getEngineState('run-1');

      expect(result).not.toBeNull();
      // Empty string is falsy, so it falls back to workflow.initialState = 'INIT'
      expect(result!.currentState).toBe('INIT');
    });

    it('returns isWaitingForHuman true when manifest status is waiting', () => {
      mockLoad.mockReturnValue(null);
      const manifest = makeMinimalManifest({
        runId: 'run-1',
        status: 'waiting',
      });
      mockDiscoverRunManifest.mockReturnValue(manifest);

      const ds = buildDataSources();
      const result = ds.getEngineState('run-1');

      expect(result).not.toBeNull();
      expect(result!.isWaitingForHuman).toBe(true);
    });

    it('returns persisted state with waiting context', () => {
      const state = makeMinimalPersistedState({
        currentState: 'WAITING_FOR_HUMAN',
        waitingContext: {
          reason: 'need approval',
          requiredInput: 'approval',
          requestingState: 'REVIEW',
          autoResumeSafe: false,
          presentedArtifacts: [],
          waitingSince: '2026-01-01T00:45:00Z',
        },
      });
      mockLoad.mockReturnValue(state);

      const ds = buildDataSources();
      const result = ds.getEngineState('run-1');

      expect(result).not.toBeNull();
      expect(result!.runId).toBe('run-1');
      expect(result!.currentState).toBe('WAITING_FOR_HUMAN');
      expect(result!.isWaitingForHuman).toBe(true);
      expect(result!.waitingContext).toBeDefined();
      expect(result!.waitingContext!.reason).toBe('need approval');
    });

    it('returns persisted state with isWaitingForHuman false for non-wait states', () => {
      const state = makeMinimalPersistedState({ currentState: 'IMPLEMENTING' });
      mockLoad.mockReturnValue(state);

      const ds = buildDataSources();
      const result = ds.getEngineState('run-1');

      expect(result).not.toBeNull();
      expect(result!.isWaitingForHuman).toBe(false);
      expect(result!.previousState).toBe('PLANNING');
      expect(result!.transitionCount).toBe(2);
    });

    it('handles tryLoadState catching exceptions', () => {
      mockLoad.mockImplementation(() => {
        throw new Error('corrupt state file');
      });
      mockDiscoverRunManifest.mockReturnValue(null);

      const ds = buildDataSources();
      const result = ds.getEngineState('run-1');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getStartedAt
  // -------------------------------------------------------------------------

  describe('getStartedAt', () => {
    it('returns from stateTimestamps when available', () => {
      const state = makeMinimalPersistedState({
        stateTimestamps: [
          { stateId: 'INIT', enteredAt: '2026-01-01T00:00:00Z', exitedAt: '2026-01-01T00:10:00Z' },
        ],
      });
      mockLoad.mockReturnValue(state);

      const ds = buildDataSources();
      const result = ds.getStartedAt('run-1');

      expect(result).toBe('2026-01-01T00:00:00Z');
    });

    it('falls back to manifest timing when no stateTimestamps', () => {
      mockLoad.mockReturnValue(null);
      const manifest = makeMinimalManifest({
        timing: {
          startedAt: '2026-02-15T10:00:00Z',
          completedAt: '2026-02-15T11:00:00Z',
          totalDurationMs: 3600000,
          stateTimings: [],
        },
      });
      mockDiscoverRunManifest.mockReturnValue(manifest);

      const ds = buildDataSources();
      const result = ds.getStartedAt('run-1');

      expect(result).toBe('2026-02-15T10:00:00Z');
    });

    it('returns null when no state and no manifest', () => {
      mockLoad.mockReturnValue(null);
      mockDiscoverRunManifest.mockReturnValue(null);

      const ds = buildDataSources();
      const result = ds.getStartedAt('run-1');

      expect(result).toBeNull();
    });

    it('falls back to manifest when state has empty stateTimestamps array', () => {
      const state = makeMinimalPersistedState({ stateTimestamps: [] });
      mockLoad.mockReturnValue(state);
      const manifest = makeMinimalManifest({
        timing: {
          startedAt: '2026-03-01T08:00:00Z',
          completedAt: '2026-03-01T09:00:00Z',
          totalDurationMs: 3600000,
          stateTimings: [],
        },
      });
      mockDiscoverRunManifest.mockReturnValue(manifest);

      const ds = buildDataSources();
      const result = ds.getStartedAt('run-1');

      expect(result).toBe('2026-03-01T08:00:00Z');
    });

    it('falls back to manifest when state has no stateTimestamps property', () => {
      const state = makeMinimalPersistedState();
      // No stateTimestamps field set
      mockLoad.mockReturnValue(state);
      mockDiscoverRunManifest.mockReturnValue(
        makeMinimalManifest({
          timing: {
            startedAt: '2026-04-01T12:00:00Z',
            completedAt: '2026-04-01T13:00:00Z',
            totalDurationMs: 3600000,
            stateTimings: [],
          },
        }),
      );

      const ds = buildDataSources();
      const result = ds.getStartedAt('run-1');

      expect(result).toBe('2026-04-01T12:00:00Z');
    });
  });

  // -------------------------------------------------------------------------
  // getArtifacts
  // -------------------------------------------------------------------------

  describe('getArtifacts', () => {
    it('returns empty when no artifacts anywhere', () => {
      // existsSync returns false for inventory and artifacts dir
      vi.mocked(existsSync).mockReturnValue(false);

      const ds = buildDataSources();
      const result = ds.getArtifacts('run-1');

      expect(result).toEqual([]);
    });

    it('returns from manifest when no live artifacts', () => {
      // existsSync returns true for runsDir (needed at construction) but false
      // for inventory and artifacts sub-paths so readInventoryArtifacts yields [].
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path === '/fake/runs') {
          return true;
        }
        return false;
      });
      mockManifestGet.mockReturnValue(
        makeMinimalManifest({
          artifactInventory: [
            {
              ref: { type: 'plan', name: 'plan', version: 1, checksum: 'sha-1' },
              producedBy: 'planner',
              createdAt: '2026-01-01T00:30:00Z',
              sizeBytes: 500,
            },
          ],
        }),
      );

      const ds = buildDataSources();
      const result = ds.getArtifacts('run-1');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('plan');
      expect(result[0].name).toBe('plan');
      expect(result[0].producedBy).toBe('planner');
    });

    it('returns empty when manifest has no artifacts either', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path === '/fake/runs') {
          return true;
        }
        return false;
      });
      mockManifestGet.mockReturnValue(makeMinimalManifest({ artifactInventory: [] }));

      const ds = buildDataSources();
      const result = ds.getArtifacts('run-1');

      expect(result).toEqual([]);
    });

    it('returns from manifest with proper field mapping', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path === '/fake/runs') {
          return true;
        }
        return false;
      });
      mockManifestGet.mockReturnValue(
        makeMinimalManifest({
          artifactInventory: [
            {
              ref: { type: 'implementation', name: 'impl', version: 2, checksum: 'sha-2' },
              producedBy: 'implementer',
              createdAt: '2026-01-02T00:00:00Z',
              sizeBytes: 1024,
            },
          ],
        }),
      );

      const ds = buildDataSources();
      const result = ds.getArtifacts('run-1');

      expect(result).toHaveLength(1);
      expect(result[0].ref).toEqual({
        type: 'implementation',
        name: 'impl',
        version: 2,
        checksum: 'sha-2',
      });
      expect(result[0].version).toBe(2);
      expect(result[0].sizeBytes).toBe(1024);
    });
  });

  // -------------------------------------------------------------------------
  // getSubsystemHealth
  // -------------------------------------------------------------------------

  describe('getSubsystemHealth', () => {
    it('returns healthy journal-storage when runsDir exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const ds = buildDataSources();
      const health = ds.getSubsystemHealth();

      const journalStorage = health.find((h) => h.subsystem === 'journal-storage');
      expect(journalStorage).toBeDefined();
      expect(journalStorage!.status).toBe('healthy');
      expect(journalStorage!.checks[0].message).toBe('Runs directory accessible');
    });

    it('returns degraded journal-storage when runsDir missing', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const ds = buildDataSources();
      const health = ds.getSubsystemHealth();

      const journalStorage = health.find((h) => h.subsystem === 'journal-storage');
      expect(journalStorage).toBeDefined();
      expect(journalStorage!.status).toBe('degraded');
      expect(journalStorage!.checks[0].message).toContain('not found');
    });

    it('returns degraded artifact-store when runsDir missing', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const ds = buildDataSources();
      const health = ds.getSubsystemHealth();

      const artifactStore = health.find((h) => h.subsystem === 'artifact-store');
      expect(artifactStore).toBeDefined();
      expect(artifactStore!.status).toBe('degraded');
    });

    it('includes runner health entries', () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const ds = buildDataSources([
        {
          id: 'claude-code',
          available: true,
          status: 'healthy',
          summary: 'Claude Code runner is ready',
          version: '1.5.0',
        },
        {
          id: 'cursor',
          available: false,
          status: 'degraded',
          summary: 'Cursor not installed',
        },
      ]);
      const health = ds.getSubsystemHealth();

      const claudeRunner = health.find((h) => h.subsystem === 'runner:claude-code');
      expect(claudeRunner).toBeDefined();
      expect(claudeRunner!.status).toBe('healthy');
      expect(claudeRunner!.checks[0].message).toBe('Claude Code runner is ready');
      expect(claudeRunner!.checks[0].details).toEqual({ version: '1.5.0' });

      const cursorRunner = health.find((h) => h.subsystem === 'runner:cursor');
      expect(cursorRunner).toBeDefined();
      expect(cursorRunner!.status).toBe('degraded');
      expect(cursorRunner!.checks[0].details).toEqual({});
    });

    it('returns healthy workflow-engine when config provides workflow', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockLoadWorkflowFromConfig.mockReturnValue({
        name: 'custom',
        version: '2.0',
        initialState: 'START',
        states: { START: { type: 'action', description: '', transitions: [] } },
      } as never);

      const ds = buildDataSources();
      const health = ds.getSubsystemHealth();

      const workflow = health.find((h) => h.subsystem === 'workflow-engine');
      expect(workflow).toBeDefined();
      expect(workflow!.status).toBe('healthy');
      expect(workflow!.checks[0].message).toBe('Workflow definition loaded');
    });

    it('returns degraded workflow-engine when no custom workflow found', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockLoadWorkflowFromConfig.mockReturnValue(null);

      const ds = buildDataSources();
      const health = ds.getSubsystemHealth();

      const workflow = health.find((h) => h.subsystem === 'workflow-engine');
      expect(workflow).toBeDefined();
      expect(workflow!.status).toBe('degraded');
      expect(workflow!.checks[0].message).toContain('default workflow');
    });

    it('returns healthy manifest-store when runsDir exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const ds = buildDataSources();
      const health = ds.getSubsystemHealth();

      const manifestStore = health.find((h) => h.subsystem === 'manifest-store');
      expect(manifestStore).toBeDefined();
      expect(manifestStore!.status).toBe('healthy');
    });

    it('returns healthy manifest-store when runsDir does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const ds = buildDataSources();
      const health = ds.getSubsystemHealth();

      const manifestStore = health.find((h) => h.subsystem === 'manifest-store');
      expect(manifestStore).toBeDefined();
      expect(manifestStore!.status).toBe('healthy');
    });
  });

  // -------------------------------------------------------------------------
  // getRunConfig
  // -------------------------------------------------------------------------

  describe('getRunConfig', () => {
    it('returns parsed config when file exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          workflow: { name: 'test', version: '1.0' },
          providers: { openai: { apiKey: 'secret' } },
          runtime: { logLevel: 'debug' },
        }),
      );

      const ds = buildDataSources();
      const result = ds.getRunConfig('run-1');

      expect(result).not.toBeNull();
      expect(result!.workflow).toEqual({ name: 'test', version: '1.0' });
      // providers should be removed for security
      expect(result!.providers).toBeUndefined();
      expect(result!.runtime).toEqual({ logLevel: 'debug' });
    });

    it('returns null when config file does not exist', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('config-snapshot')) {
          return false;
        }
        return true;
      });

      const ds = buildDataSources();
      const result = ds.getRunConfig('run-1');

      expect(result).toBeNull();
    });

    it('returns null when config file has invalid JSON', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('not-valid-json{{{');

      const ds = buildDataSources();
      const result = ds.getRunConfig('run-1');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getSessionSnapshots
  // -------------------------------------------------------------------------

  describe('getSessionSnapshots', () => {
    it('returns empty when sessions dir does not exist', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('sessions')) {
          return false;
        }
        return true;
      });

      const ds = buildDataSources();
      const result = ds.getSessionSnapshots!('run-1');

      expect(result).toEqual([]);
    });

    it('parses session files from sessions dir', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'session-1.json',
        'session-2.json',
        'readme.txt',
      ] as never);

      const session1 = {
        ref: {
          sessionId: 'sess-1',
          runId: 'run-1',
          stateId: 'IMPLEMENTATION',
          role: 'implementer',
          transport: 'stdio',
        },
        state: 'completed',
        pendingRequests: [],
        lastProtocolTimestamp: '2026-01-01T01:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T01:00:00Z',
      } as unknown as AgentSessionSnapshot;
      const session2 = {
        ref: {
          sessionId: 'sess-2',
          runId: 'run-1',
          stateId: 'REVIEW',
          role: 'reviewer',
          transport: 'stdio',
        },
        state: 'running',
        pendingRequests: [],
        lastProtocolTimestamp: '2026-01-01T01:30:00Z',
        createdAt: '2026-01-01T01:00:00Z',
        updatedAt: '2026-01-01T01:30:00Z',
      } as unknown as AgentSessionSnapshot;

      vi.mocked(readFileSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('session-1.json')) {
          return JSON.stringify(session1);
        }
        if (path.includes('session-2.json')) {
          return JSON.stringify(session2);
        }
        return '';
      });

      const ds = buildDataSources();
      const result = ds.getSessionSnapshots!('run-1');

      // Only .json files are parsed (readme.txt is filtered out)
      expect(result).toHaveLength(2);
      expect(result[0].ref.sessionId).toBe('sess-1');
      expect(result[1].ref.sessionId).toBe('sess-2');
    });

    it('returns empty on read error', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockImplementation(() => {
        throw new Error('permission denied');
      });

      const ds = buildDataSources();
      const result = ds.getSessionSnapshots!('run-1');

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getContractLimits
  // -------------------------------------------------------------------------

  describe('getContractLimits', () => {
    it('returns iteration limits from contracts', () => {
      const ds = buildDataSources();
      const result = ds.getContractLimits!();

      expect(result).toEqual({
        'review-loop': 3,
        'judge-loop': 2,
      });
      expect(mockBuildContracts).toHaveBeenCalledWith({
        maxReviewIterations: 3,
        maxJudgeArbitrations: 2,
        maxClarificationRounds: 2,
        maxAcceptanceIterations: 3,
      });
    });
  });

  // -------------------------------------------------------------------------
  // getManifest / getManifests
  // -------------------------------------------------------------------------

  describe('getManifest', () => {
    it('delegates to discoverRunManifest', () => {
      const manifest = makeMinimalManifest({ runId: 'run-42' });
      mockDiscoverRunManifest.mockReturnValue(manifest);

      const ds = buildDataSources();
      const result = ds.getManifest('run-42');

      expect(result).toBe(manifest);
      expect(mockDiscoverRunManifest).toHaveBeenCalledWith('run-42');
    });

    it('returns null when no manifest found', () => {
      mockDiscoverRunManifest.mockReturnValue(null);

      const ds = buildDataSources();
      const result = ds.getManifest('run-99');

      expect(result).toBeNull();
    });
  });

  describe('getManifests', () => {
    it('delegates to discoverRunManifests', () => {
      const manifests = [makeMinimalManifest({ runId: 'run-1' })];
      mockDiscoverRunManifests.mockReturnValue(manifests);

      const ds = buildDataSources();
      const result = ds.getManifests();

      expect(result).toBe(manifests);
    });
  });

  // -------------------------------------------------------------------------
  // getPersistedState
  // -------------------------------------------------------------------------

  describe('getPersistedState', () => {
    it('returns persisted state when available', () => {
      const state = makeMinimalPersistedState({ runId: 'run-5' });
      mockLoad.mockReturnValue(state);

      const ds = buildDataSources();
      const result = ds.getPersistedState('run-5');

      expect(result).not.toBeNull();
      expect(result!.runId).toBe('run-5');
    });

    it('returns null when no persisted state and load throws', () => {
      mockLoad.mockImplementation(() => {
        throw new Error('file not found');
      });

      const ds = buildDataSources();
      const result = ds.getPersistedState('run-nonexistent');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getTransitionRecords
  // -------------------------------------------------------------------------

  describe('getTransitionRecords', () => {
    it('returns empty when journal does not exist', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('journal')) {
          return false;
        }
        return true;
      });

      const ds = buildDataSources();
      const result = ds.getTransitionRecords('run-1');

      expect(result).toEqual([]);
    });

    it('returns transition records from journal events', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockReadAll.mockReturnValue([
        {
          type: 'state_transition',
          timestamp: '2026-01-01T00:10:00Z',
          runId: 'run-1',
          sequence: 1,
          data: {
            from: 'INIT',
            to: 'PLANNING',
            trigger: 'start',
            governanceOutcome: 'approved',
            durationMs: 100,
          },
        },
        {
          type: 'artifact_stored',
          timestamp: '2026-01-01T00:15:00Z',
          runId: 'run-1',
          sequence: 2,
          data: { type: 'plan', name: 'plan', version: 1 },
        },
        {
          type: 'state_transition',
          timestamp: '2026-01-01T00:20:00Z',
          runId: 'run-1',
          sequence: 3,
          data: {
            from: 'PLANNING',
            to: 'IMPLEMENTING',
            trigger: 'plan_approved',
            governanceOutcome: 'approved',
            durationMs: 600000,
          },
        },
      ]);

      const ds = buildDataSources();
      const result = ds.getTransitionRecords('run-1');

      expect(result).toHaveLength(2);
      expect(result[0].from).toBe('INIT');
      expect(result[0].to).toBe('PLANNING');
      expect(result[0].trigger).toBe('start');
      expect(result[1].from).toBe('PLANNING');
      expect(result[1].to).toBe('IMPLEMENTING');
    });
  });

  // -------------------------------------------------------------------------
  // getFindings
  // -------------------------------------------------------------------------

  describe('getFindings', () => {
    it('returns empty when journal does not exist', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('journal')) {
          return false;
        }
        return true;
      });

      const ds = buildDataSources();
      const result = ds.getFindings('run-1');

      expect(result).toEqual([]);
    });

    it('collects and deduplicates findings from journal', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockReadAll.mockReturnValue([
        {
          type: 'finding_raised',
          timestamp: '2026-01-01T00:10:00Z',
          runId: 'run-1',
          sequence: 1,
          data: {
            findingId: 'f-1',
            severity: 'high',
            status: 'open',
            category: 'security',
            title: 'SQL injection risk',
            blocking: 'true',
          },
        },
        {
          type: 'finding_resolved',
          timestamp: '2026-01-01T00:20:00Z',
          runId: 'run-1',
          sequence: 2,
          data: {
            findingId: 'f-1',
            severity: 'high',
            status: 'resolved',
          },
        },
        {
          type: 'finding_raised',
          timestamp: '2026-01-01T00:15:00Z',
          runId: 'run-1',
          sequence: 3,
          data: {
            findingId: 'f-2',
            severity: 'medium',
            status: 'open',
            title: 'Missing tests',
          },
        },
      ]);

      const ds = buildDataSources();
      const result = ds.getFindings('run-1');

      expect(result).toHaveLength(2);
      // f-1 should be resolved (updated by the second event)
      const f1 = result.find((f) => f.id === 'f-1');
      expect(f1).toBeDefined();
      expect(f1!.status).toBe('resolved');
      expect(f1!.source).toBe('blocking');
      // f-2 should remain open
      const f2 = result.find((f) => f.id === 'f-2');
      expect(f2).toBeDefined();
      expect(f2!.status).toBe('open');
      expect(f2!.category).toBe('review'); // default when not specified
    });

    it('skips events with missing required finding fields', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockReadAll.mockReturnValue([
        {
          type: 'finding_raised',
          timestamp: '2026-01-01T00:10:00Z',
          runId: 'run-1',
          sequence: 1,
          data: {
            // missing findingId
            severity: 'high',
            status: 'open',
          },
        },
        {
          type: 'finding_raised',
          timestamp: '2026-01-01T00:10:00Z',
          runId: 'run-1',
          sequence: 2,
          data: {
            findingId: 'f-valid',
            severity: 'low',
            status: 'open',
            title: 'Minor issue',
          },
        },
      ]);

      const ds = buildDataSources();
      const result = ds.getFindings('run-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('f-valid');
    });
  });

  // -------------------------------------------------------------------------
  // getStateNames / getStateTypes / getStateLabels / getDefinitionTransitions
  // -------------------------------------------------------------------------

  describe('workflow-derived closures', () => {
    it('getStateNames returns state names from workflow', () => {
      const ds = buildDataSources();
      const result = ds.getStateNames('run-1');

      // Uses loadDefaultWorkflow since loadWorkflowFromConfig returns null
      // and existsSync for the defPath will use the mock
      expect(Array.isArray(result)).toBe(true);
    });

    it('getStateTypes returns state types from workflow', () => {
      const ds = buildDataSources();
      const result = ds.getStateTypes('run-1');

      expect(typeof result).toBe('object');
    });

    it('getStateLabels returns state labels from workflow', () => {
      const ds = buildDataSources();
      const result = ds.getStateLabels('run-1');

      expect(typeof result).toBe('object');
    });

    it('getDefinitionTransitions returns transitions from workflow', () => {
      const ds = buildDataSources();
      const result = ds.getDefinitionTransitions('run-1');

      expect(Array.isArray(result)).toBe(true);
    });

    it('getParallelStates returns parallel states from workflow', () => {
      const ds = buildDataSources();
      const result = ds.getParallelStates('run-1');

      expect(result).toBeInstanceOf(Map);
    });

    it('getStateRoles returns state roles from workflow', () => {
      const ds = buildDataSources();
      const result = ds.getStateRoles!('run-1');

      expect(result).toBeInstanceOf(Map);
    });
  });

  // -------------------------------------------------------------------------
  // getArtifactVersionHistory
  // -------------------------------------------------------------------------

  describe('getArtifactVersionHistory', () => {
    it('returns versions from manifests when matching artifacts exist', () => {
      mockManifestList.mockReturnValue([
        makeMinimalManifest({
          artifactInventory: [
            {
              ref: { type: 'plan', name: 'plan', version: 1, checksum: 'sha-1' },
              producedBy: 'planner',
              createdAt: '2026-01-01T00:00:00Z',
              sizeBytes: 100,
            },
            {
              ref: { type: 'plan', name: 'plan', version: 2, checksum: 'sha-2' },
              producedBy: 'planner',
              createdAt: '2026-01-02T00:00:00Z',
              sizeBytes: 200,
            },
          ],
        }),
      ]);

      const ds = buildDataSources();
      const ref = { type: 'plan' as const, name: 'plan', version: 1, checksum: 'sha-1' };
      const result = ds.getArtifactVersionHistory(ref);

      expect(result).toHaveLength(2);
      expect(result[0].version).toBe(1);
      expect(result[1].version).toBe(2);
    });

    it('returns the input ref as fallback when no manifests match', () => {
      mockManifestList.mockReturnValue([]);

      const ds = buildDataSources();
      const ref = { type: 'plan' as const, name: 'plan', version: 1, checksum: 'sha-1' };
      const result = ds.getArtifactVersionHistory(ref);

      expect(result).toEqual([ref]);
    });

    it('returns the input ref when manifests have no matching artifact', () => {
      mockManifestList.mockReturnValue([
        makeMinimalManifest({
          artifactInventory: [
            {
              ref: {
                type: 'implementation',
                name: 'impl',
                version: 1,
                checksum: 'sha-other',
              },
              producedBy: 'implementer',
              createdAt: '2026-01-01T00:00:00Z',
              sizeBytes: 100,
            },
          ],
        }),
      ]);

      const ds = buildDataSources();
      const ref = { type: 'plan' as const, name: 'plan', version: 1, checksum: 'sha-1' };
      const result = ds.getArtifactVersionHistory(ref);

      expect(result).toEqual([ref]);
    });
  });

  // -------------------------------------------------------------------------
  // getArtifactContentText
  // -------------------------------------------------------------------------

  describe('getArtifactContentText', () => {
    it('returns content from legacy path when file exists', () => {
      vi.mocked(readFileSync).mockReturnValue('# Plan Content\nThis is the plan.');

      const ds = buildDataSources();
      const result = ds.getArtifactContentText('run-1', 'plan', 'plan', 1);

      expect(result).toBe('# Plan Content\nThis is the plan.');
    });

    it('returns null when legacy path throws and no fallback entry found', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      // No artifacts dir
      vi.mocked(existsSync).mockReturnValue(false);

      const ds = buildDataSources();
      const result = ds.getArtifactContentText('run-1', 'plan', 'plan', 1);

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getRunEvents
  // -------------------------------------------------------------------------

  describe('getRunEvents', () => {
    it('returns empty when journal does not exist', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes('journal')) {
          return false;
        }
        return true;
      });

      const ds = buildDataSources();
      const result = ds.getRunEvents('run-1');

      expect(result).toEqual([]);
    });

    it('maps journal events to dashboard events sorted by timestamp descending', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockReadAll.mockReturnValue([
        {
          type: 'run_started',
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-1',
          sequence: 0,
          data: {},
        },
        {
          type: 'state_transition',
          timestamp: '2026-01-01T00:10:00Z',
          runId: 'run-1',
          sequence: 1,
          data: { from: 'INIT', to: 'PLANNING', trigger: 'start' },
        },
        {
          type: 'run_completed',
          timestamp: '2026-01-01T01:00:00Z',
          runId: 'run-1',
          sequence: 2,
          data: {},
        },
      ]);

      const ds = buildDataSources();
      const result = ds.getRunEvents('run-1');

      expect(result.length).toBeGreaterThan(0);
      // Sorted descending by timestamp
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].timestamp >= result[i].timestamp).toBe(true);
      }
    });

    it('skips journal events with unmapped types', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockReadAll.mockReturnValue([
        {
          type: 'some_unknown_event_type',
          timestamp: '2026-01-01T00:05:00Z',
          runId: 'run-1',
          sequence: 0,
          data: {},
        },
        {
          type: 'run_started',
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-1',
          sequence: 1,
          data: {},
        },
      ]);

      const ds = buildDataSources();
      const result = ds.getRunEvents('run-1');

      // Only run_started should be mapped
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('run_started');
    });
  });

  // -------------------------------------------------------------------------
  // clock
  // -------------------------------------------------------------------------

  describe('clock', () => {
    it('returns an ISO timestamp string', () => {
      const ds = buildDataSources();
      const result = ds.clock();

      expect(typeof result).toBe('string');
      // Should be parseable as a date
      expect(Number.isNaN(Date.parse(result))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // resolveWorkflowForRun (tested indirectly through the closures)
  // -------------------------------------------------------------------------

  describe('resolveWorkflowForRun (indirectly)', () => {
    it('uses workflow from run directory when file exists and parses correctly', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      const workflowDef = {
        name: 'run-specific',
        version: '3.0',
        initialState: 'START',
        terminalStates: ['END'],
        states: {
          START: {
            type: 'action',
            transitions: [{ target: 'END', trigger: 'completion', guards: [] }],
          },
          END: { type: 'terminal', transitions: [] },
        },
      };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(workflowDef));

      const ds = buildDataSources();
      const names = ds.getStateNames('run-1');

      expect(names).toContain('START');
      expect(names).toContain('END');
    });

    it('falls back to config workflow when run file parsing fails', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('invalid json {{{');
      mockLoadWorkflowFromConfig.mockReturnValue({
        name: 'from-config',
        version: '2.0',
        initialState: 'CONFIG_START',
        states: {
          CONFIG_START: { type: 'initial', transitions: [] },
          CONFIG_END: { type: 'final', transitions: [] },
        },
      } as unknown as WorkflowDefinition);

      const ds = buildDataSources();
      const names = ds.getStateNames('run-1');

      expect(names).toContain('CONFIG_START');
    });

    it('falls back to default workflow when no config workflow', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      mockLoadWorkflowFromConfig.mockReturnValue(null);

      const ds = buildDataSources();
      const names = ds.getStateNames('run-1');

      // Uses loadDefaultWorkflow which returns INIT and DONE states
      expect(names).toContain('INIT');
      expect(names).toContain('DONE');
    });
  });

  // -------------------------------------------------------------------------
  // ManifestQuery null branch (existsSync(runsDir) = false at construction)
  // -------------------------------------------------------------------------

  describe('manifestQuery null branch', () => {
    it('getArtifacts returns empty when manifestQuery is null and no live artifacts', () => {
      // Make existsSync return false for runsDir during construction
      vi.mocked(existsSync).mockReturnValue(false);

      const ds = buildDataSources();
      const result = ds.getArtifacts('run-1');

      expect(result).toEqual([]);
    });

    it('getArtifactVersionHistory returns ref fallback when manifestQuery is null', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const ds = buildDataSources();
      const ref = { type: 'plan' as const, name: 'plan', version: 1, checksum: 'sha-1' };
      const result = ds.getArtifactVersionHistory(ref);

      expect(result).toEqual([ref]);
    });
  });
});

// ---------------------------------------------------------------------------
// startJournalPoller
// ---------------------------------------------------------------------------

describe('startJournalPoller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetRunsDir.mockReturnValue('/fake/runs');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([]);
    mockReadAll.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes new journal events as dashboard events', () => {
    vi.mocked(readdirSync).mockReturnValue(['run-1'] as never);
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadAll.mockReturnValue([
      {
        type: 'run_started',
        timestamp: '2026-01-01T00:00:00Z',
        runId: 'run-1',
        sequence: 0,
        data: {},
      },
    ]);

    const published: DashboardEvent[] = [];
    const eventStream = { publish: (event: DashboardEvent) => published.push(event) };

    const poller = startJournalPoller(eventStream);

    // Initial poll happens immediately
    expect(published.length).toBeGreaterThan(0);
    // run_started should also produce a health_changed event
    const runStarted = published.find((e) => e.type === 'run_started');
    expect(runStarted).toBeDefined();
    const healthChanged = published.find((e) => e.type === 'health_changed');
    expect(healthChanged).toBeDefined();

    poller.stop();
  });

  it('does not republish already-seen events on subsequent polls', () => {
    vi.mocked(readdirSync).mockReturnValue(['run-1'] as never);
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadAll.mockReturnValue([
      {
        type: 'run_started',
        timestamp: '2026-01-01T00:00:00Z',
        runId: 'run-1',
        sequence: 0,
        data: {},
      },
    ]);

    const published: DashboardEvent[] = [];
    const eventStream = { publish: (event: DashboardEvent) => published.push(event) };

    const poller = startJournalPoller(eventStream);
    const countAfterFirstPoll = published.length;

    // Advance timer to trigger another poll
    vi.advanceTimersByTime(2000);

    // No new events, so count should remain the same
    expect(published.length).toBe(countAfterFirstPoll);

    poller.stop();
  });

  it('publishes new events that appear between polls', () => {
    vi.mocked(readdirSync).mockReturnValue(['run-1'] as never);
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadAll.mockReturnValue([
      {
        type: 'run_started',
        timestamp: '2026-01-01T00:00:00Z',
        runId: 'run-1',
        sequence: 0,
        data: {},
      },
    ]);

    const published: DashboardEvent[] = [];
    const eventStream = { publish: (event: DashboardEvent) => published.push(event) };

    const poller = startJournalPoller(eventStream);
    const countAfterFirstPoll = published.length;

    // Now add a new event
    mockReadAll.mockReturnValue([
      {
        type: 'run_started',
        timestamp: '2026-01-01T00:00:00Z',
        runId: 'run-1',
        sequence: 0,
        data: {},
      },
      {
        type: 'run_completed',
        timestamp: '2026-01-01T01:00:00Z',
        runId: 'run-1',
        sequence: 1,
        data: {},
      },
    ]);

    vi.advanceTimersByTime(2000);

    // Should have published the new run_completed event + health_changed
    expect(published.length).toBeGreaterThan(countAfterFirstPoll);
    const newEvents = published.slice(countAfterFirstPoll);
    expect(newEvents.some((e) => e.type === 'run_completed')).toBe(true);

    poller.stop();
  });

  it('does nothing when runsDir does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const published: DashboardEvent[] = [];
    const eventStream = { publish: (event: DashboardEvent) => published.push(event) };

    const poller = startJournalPoller(eventStream);

    expect(published).toHaveLength(0);

    vi.advanceTimersByTime(2000);
    expect(published).toHaveLength(0);

    poller.stop();
  });

  it('handles readdirSync throwing gracefully', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error('permission denied');
    });

    const published: DashboardEvent[] = [];
    const eventStream = { publish: (event: DashboardEvent) => published.push(event) };

    const poller = startJournalPoller(eventStream);

    expect(published).toHaveLength(0);

    poller.stop();
  });

  it('skips runs with no journal file', () => {
    vi.mocked(readdirSync).mockReturnValue(['run-no-journal'] as never);
    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path.includes('journal')) {
        return false;
      }
      return true;
    });

    const published: DashboardEvent[] = [];
    const eventStream = { publish: (event: DashboardEvent) => published.push(event) };

    const poller = startJournalPoller(eventStream);

    expect(published).toHaveLength(0);

    poller.stop();
  });

  it('skips unmapped journal event types', () => {
    vi.mocked(readdirSync).mockReturnValue(['run-1'] as never);
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadAll.mockReturnValue([
      {
        type: 'custom_internal_event',
        timestamp: '2026-01-01T00:00:00Z',
        runId: 'run-1',
        sequence: 0,
        data: {},
      },
    ]);

    const published: DashboardEvent[] = [];
    const eventStream = { publish: (event: DashboardEvent) => published.push(event) };

    const poller = startJournalPoller(eventStream);

    expect(published).toHaveLength(0);

    poller.stop();
  });

  it('emits health_changed for run_completed and run_aborted events', () => {
    vi.mocked(readdirSync).mockReturnValue(['run-1'] as never);
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadAll.mockReturnValue([
      {
        type: 'run_aborted',
        timestamp: '2026-01-01T00:30:00Z',
        runId: 'run-1',
        sequence: 0,
        data: { reason: 'budget exceeded' },
      },
    ]);

    const published: DashboardEvent[] = [];
    const eventStream = { publish: (event: DashboardEvent) => published.push(event) };

    const poller = startJournalPoller(eventStream);

    const aborted = published.find((e) => e.type === 'run_aborted');
    expect(aborted).toBeDefined();
    const healthChanged = published.find((e) => e.type === 'health_changed');
    expect(healthChanged).toBeDefined();
    expect(healthChanged!.runId).toBe('run-1');

    poller.stop();
  });

  it('does not emit health_changed for non-lifecycle events', () => {
    vi.mocked(readdirSync).mockReturnValue(['run-1'] as never);
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadAll.mockReturnValue([
      {
        type: 'artifact_stored',
        timestamp: '2026-01-01T00:15:00Z',
        runId: 'run-1',
        sequence: 0,
        data: { type: 'plan', name: 'plan', version: 1 },
      },
    ]);

    const published: DashboardEvent[] = [];
    const eventStream = { publish: (event: DashboardEvent) => published.push(event) };

    const poller = startJournalPoller(eventStream);

    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('artifact_produced');
    // No health_changed emitted
    expect(published.find((e) => e.type === 'health_changed')).toBeUndefined();

    poller.stop();
  });

  it('stop() clears the interval', () => {
    const published: DashboardEvent[] = [];
    const eventStream = { publish: (event: DashboardEvent) => published.push(event) };

    const poller = startJournalPoller(eventStream);
    poller.stop();

    // After stopping, advancing time should not trigger polls
    vi.mocked(readdirSync).mockReturnValue(['run-1'] as never);
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadAll.mockReturnValue([
      {
        type: 'run_started',
        timestamp: '2026-01-01T00:00:00Z',
        runId: 'run-1',
        sequence: 0,
        data: {},
      },
    ]);

    vi.advanceTimersByTime(10000);
    expect(published).toHaveLength(0);
  });
});
