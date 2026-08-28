import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { generateAll } from '@ai-orchestrator/config-templates';
import { DefaultStatePersistence } from '@ai-orchestrator/core';
import { AI_CONFIG_DIR_NAME } from '@ai-orchestrator/schemas';
import type { PersistedState, RunId } from '@ai-orchestrator/schemas';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  createOrchestrator,
  createRunConfig,
  loadAllWorkflows,
  loadWorkflowByName,
  loadWorkflowFromConfig,
  resumeOrchestrator,
} from '../composition-root';
import { getConfigSnapshotPath } from '../workspace-paths';

const mockGlobalConfigPath = vi.hoisted(() => ({ value: '' }));
const mockPaths = vi.hoisted(() => ({ aiDir: '', runsDir: '' }));
const mockProbes = vi.hoisted(() => ({
  probeClaudeCode: vi.fn(),
  probeCursor: vi.fn(),
}));

vi.mock('../workspace-paths', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getGlobalConfigPath: () => mockGlobalConfigPath.value || '/nonexistent/global/config.yaml',
    getAiDir: () => mockPaths.aiDir,
    getRunsDir: () => mockPaths.runsDir,
    getRunDir: (runId: string) => join(mockPaths.runsDir, runId),
    getDashboardLogPath: () => join(mockPaths.aiDir, 'dashboard-server.log'),
  };
});

vi.mock('@ai-orchestrator/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    probeClaudeCodeCapabilities: mockProbes.probeClaudeCode,
    probeCursorCliCapabilities: mockProbes.probeCursor,
  };
});

function writeFullAiConfig(baseDir: string): void {
  const aiDir = join(baseDir, AI_CONFIG_DIR_NAME);
  for (const [relativePath, content] of generateAll()) {
    const filePath = join(aiDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }
}

describe('composition-root orchestrator creation', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join(tmpdir(), `comp-root-test-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    mockPaths.aiDir = join(baseDir, '.ai');
    mockPaths.runsDir = join(baseDir, '.ai', 'runs');

    mockProbes.probeClaudeCode.mockResolvedValue({
      adapterName: 'claude-code',
      probedAt: '2026-01-01T00:00:00Z',
      capabilities: {
        structuredIO: true,
        permissionEvents: true,
        clarificationEvents: true,
        stdinResponses: true,
      },
      rawVersion: '1.0.0',
      notes: ['mock'],
    });

    mockProbes.probeCursor.mockResolvedValue({
      adapterName: 'cursor',
      probedAt: '2026-01-01T00:00:00Z',
      capabilities: {
        structuredIO: false,
        permissionEvents: false,
        clarificationEvents: false,
        stdinResponses: false,
      },
      rawVersion: '0.1.0',
      authenticated: true,
      notes: ['mock'],
    });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    vi.restoreAllMocks();
    mockGlobalConfigPath.value = '';
  });

  it('succeeds when all roles are agent-dispatched and no provider key is set', async () => {
    writeFullAiConfig(baseDir);
    writeFileSync(
      join(baseDir, AI_CONFIG_DIR_NAME, 'roles.yaml'),
      [
        'roles:',
        '  - id: planner',
        '    name: Planner',
        '    description: Plans work',
        '    owned_artifacts: [plan]',
        '    readable_artifacts: [canonical_specification]',
        '    forbidden_artifacts: []',
        '    reviewed_by: [plan_reviewer]',
        '    reviews: []',
        '    agreement_participation: []',
        '    required_capabilities: [reasoning]',
        '    model: claude-opus-4-8',
        '    dispatch_type: agent',
      ].join('\n'),
      'utf8',
    );

    const ctx = await createOrchestrator(baseDir);
    expect(ctx.runId).toBeTruthy();
  });

  it('falls back silently when no .ai/ directory exists', async () => {
    const ctx = await createOrchestrator(baseDir);
    expect(ctx.runId).toBeTruthy();
  });

  it('createRunConfig passes budget options through to WorkflowRunConfig', () => {
    const config = createRunConfig('run-test', ['source'], undefined, {
      maxTokens: 100000,
      reportOutputPath: '/tmp/report.md',
      runDir: '/tmp/runs/run-test',
    });
    expect(config.budgetMaxTokens).toBe(100000);
    expect(config.reportOutputPath).toBe('/tmp/report.md');
    expect(config.runDir).toBe('/tmp/runs/run-test');
  });

  it('createRunConfig omits budget fields when no options provided', () => {
    const config = createRunConfig('run-test', ['source']);
    expect(config.budgetMaxTokens).toBeUndefined();
    expect(config.reportOutputPath).toBeUndefined();
    expect(config.runDir).toBeUndefined();
  });

  it('createRunConfig passes repoRoot through to WorkflowRunConfig', () => {
    const config = createRunConfig('run-test', ['source'], undefined, {
      repoRoot: '/home/user/my-project',
      runDir: '/tmp/runs/run-test',
    });
    expect(config.repoRoot).toBe('/home/user/my-project');
  });

  it('succeeds when all built-in roles are agent-dispatched', async () => {
    writeFullAiConfig(baseDir);

    const ctx = await createOrchestrator(baseDir);
    expect(ctx.runId).toBeTruthy();
  });

  it('fails startup when agent-dispatched roles have no available runner', async () => {
    mockProbes.probeClaudeCode.mockResolvedValueOnce({
      adapterName: 'claude-code',
      probedAt: '2026-01-01T00:00:00Z',
      capabilities: {
        structuredIO: false,
        permissionEvents: false,
        clarificationEvents: false,
        stdinResponses: false,
      },
      rawVersion: null,
      notes: ['not found'],
    });
    writeFullAiConfig(baseDir);

    await expect(createOrchestrator(baseDir)).rejects.toThrow(/requires runner/u);
  });

  it('registers claude-code runner when Claude Code supports structured I/O with permission events', async () => {
    mockProbes.probeClaudeCode.mockResolvedValueOnce({
      adapterName: 'claude-code',
      probedAt: '2026-01-01T00:00:00Z',
      capabilities: {
        structuredIO: true,
        permissionEvents: true,
        clarificationEvents: false,
        stdinResponses: true,
      },
      rawVersion: '2.1.207',
      notes: ['current Claude Code CLI capabilities'],
    });
    writeFullAiConfig(baseDir);

    const ctx = await createOrchestrator(baseDir);
    expect(ctx.runId).toBeTruthy();
  });

  it('writes effective agent dispatch types into the dashboard config snapshot', async () => {
    writeFullAiConfig(baseDir);

    const ctx = await createOrchestrator(baseDir);
    const snapshot = JSON.parse(readFileSync(getConfigSnapshotPath(ctx.runDir), 'utf8')) as {
      roles?: { assignments?: Record<string, { dispatchType?: string }> };
    };

    expect(snapshot.roles?.assignments?.['planner']?.dispatchType).toBe('agent');
    expect(snapshot.roles?.assignments?.['implementer']?.dispatchType).toBe('agent');
  });

  it('fails in agent-only mode when runner probe fails', async () => {
    mockProbes.probeClaudeCode.mockResolvedValueOnce({
      adapterName: 'claude-code',
      probedAt: '2026-01-01T00:00:00Z',
      capabilities: {
        structuredIO: false,
        permissionEvents: false,
        clarificationEvents: false,
        stdinResponses: false,
      },
      rawVersion: null,
      notes: ['not found'],
    });
    writeFullAiConfig(baseDir);

    await expect(createOrchestrator(baseDir)).rejects.toThrow(/requires runner/u);
  });

  it('enables fixture mode when AI_ORCHESTRATOR_FIXTURE=1', async () => {
    process.env['AI_ORCHESTRATOR_FIXTURE'] = '1';
    try {
      const ctx = await createOrchestrator(baseDir);
      expect(ctx.runId).toBeTruthy();
    } finally {
      delete process.env['AI_ORCHESTRATOR_FIXTURE'];
    }
  });

  it('resumeOrchestrator passes repoRoot through to the restored engine config', async () => {
    process.env['AI_ORCHESTRATOR_FIXTURE'] = '1';
    try {
      const ctx = await createOrchestrator(baseDir);
      const runId = ctx.runId;
      const runDir = ctx.runDir;
      ctx.shutdownCoordinator?.uninstall();

      const statePersistence = new DefaultStatePersistence(mockPaths.runsDir);
      const checkpoint: PersistedState = {
        runId: runId as RunId,
        schemaVersion: 2,
        currentState: 'WAITING_FOR_HUMAN',
        previousState: 'INTAKE',
        stateEnteredAt: new Date().toISOString(),
        transitionCount: 1,
        stateHistory: ['INTAKE', 'WAITING_FOR_HUMAN'],
        iterationCounts: {},
        activeArtifacts: [],
        lastProducedArtifact: null,
        workflowName: 'dev',
        workflowVersion: '1.0.0',
        persistedAt: new Date().toISOString(),
        persistenceVersion: 1,
        checksum: '',
      };
      await statePersistence.save(checkpoint);

      writeFileSync(join(runDir, 'journal.md'), `# Journal — ${runId}\n`, 'utf8');

      const repoRoot = '/home/test-user/my-project';
      const resumed = await resumeOrchestrator(repoRoot, runId);
      resumed.shutdownCoordinator?.uninstall();

      const state = resumed.engine.getState();
      expect(state.currentState).toBe('WAITING_FOR_HUMAN');

      await resumed.engine.resume({ type: 'approval', content: 'test' });

      const loaded = resumed.statePersistence.load(runId as RunId);
      expect(loaded?.repoRoot).toBe(repoRoot);
    } finally {
      delete process.env['AI_ORCHESTRATOR_FIXTURE'];
    }
  });

  it('resumeOrchestrator restores sources from config-snapshot', async () => {
    process.env['AI_ORCHESTRATOR_FIXTURE'] = '1';
    try {
      const ctx = await createOrchestrator(baseDir);
      const runId = ctx.runId;
      const runDir = ctx.runDir;
      ctx.shutdownCoordinator?.uninstall();

      const snapshotPath = getConfigSnapshotPath(runDir);
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as Record<string, unknown>;
      snapshot['sources'] = ['https://github.com/org/repo/pull/42'];
      writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');

      const statePersistence = new DefaultStatePersistence(mockPaths.runsDir);
      const checkpoint: PersistedState = {
        runId: runId as RunId,
        schemaVersion: 2,
        currentState: 'WAITING_FOR_HUMAN',
        previousState: 'INTAKE',
        stateEnteredAt: new Date().toISOString(),
        transitionCount: 1,
        stateHistory: ['INTAKE', 'WAITING_FOR_HUMAN'],
        iterationCounts: {},
        activeArtifacts: [],
        lastProducedArtifact: null,
        workflowName: 'dev',
        workflowVersion: '1.0.0',
        persistedAt: new Date().toISOString(),
        persistenceVersion: 1,
        checksum: '',
      };
      await statePersistence.save(checkpoint);
      writeFileSync(join(runDir, 'journal.md'), `# Journal — ${runId}\n`, 'utf8');

      const resumed = await resumeOrchestrator('/tmp/test', runId);
      resumed.shutdownCoordinator?.uninstall();

      const state = resumed.engine.getState();
      expect(state.currentState).toBe('WAITING_FOR_HUMAN');
    } finally {
      delete process.env['AI_ORCHESTRATOR_FIXTURE'];
    }
  });

  it('createRunConfig passes alertThresholds through to WorkflowRunConfig', () => {
    const config = createRunConfig('run-test', ['source'], undefined, {
      alertThresholds: [0.5, 0.8, 0.95],
    });
    expect(config.budgetAlertThresholds).toEqual([0.5, 0.8, 0.95]);
  });
});

describe('loadWorkflowFromConfig', () => {
  it('returns the dev workflow', () => {
    const workflow = loadWorkflowFromConfig();
    expect(workflow).not.toBeNull();
    expect(workflow?.name).toBe('dev');
  });
});

describe('loadWorkflowByName', () => {
  it('returns a workflow for a known name', () => {
    const workflow = loadWorkflowByName('dev');
    expect(workflow).not.toBeNull();
    expect(workflow?.name).toBe('dev');
  });

  it('returns null for unknown workflow name', () => {
    const workflow = loadWorkflowByName('nonexistent-workflow-xyz');
    expect(workflow).toBeNull();
  });
});

describe('loadAllWorkflows', () => {
  it('returns an array of built-in workflows', () => {
    const workflows = loadAllWorkflows();
    expect(workflows.length).toBeGreaterThan(0);
    expect(workflows[0]).toHaveProperty('name');
    expect(workflows[0]).toHaveProperty('version');
  });
});
