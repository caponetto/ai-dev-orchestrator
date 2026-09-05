import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkflowDefinition } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';

import type { OutputFormatter } from '../../output/formatter';
import { getAiDir, getDashboardLogPath, getRunDir, getRunsDir } from '../../workspace-paths';

vi.mock('../../workspace-paths', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getAiDir: vi.fn(),
    getRunsDir: vi.fn(),
    getRunDir: vi.fn(),
    getDashboardLogPath: vi.fn(),
  };
});

const serverStartMock = vi.fn().mockResolvedValue(undefined);
const serverStopMock = vi.fn().mockResolvedValue(undefined);
const serverConstructorMock = vi.fn();
const fileBackedBusConstructorMock = vi.fn();

class MockFileBackedAgentStreamBus {
  constructor(...args: unknown[]) {
    fileBackedBusConstructorMock(...args);
  }
  subscribe = vi.fn();
  unsubscribe = vi.fn();
  publish = vi.fn();
  getClientCount = vi.fn().mockReturnValue(0);
  dispose = vi.fn();
}

class MockFileBackedLiveRequestStore {
  getPendingRequests = vi.fn().mockReturnValue([]);
  addRequest = vi.fn();
  removeRequest = vi.fn();
}

vi.mock('@ai-dev-orchestrator/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    probeClaudeCodeCapabilities: vi.fn().mockResolvedValue({
      capabilities: { structuredIO: false, streaming: false, resumption: false },
      rawVersion: '1.0.0-mock',
      notes: [],
    }),
    probeCursorCliCapabilities: vi.fn().mockResolvedValue({
      capabilities: { structuredIO: false, streaming: false, resumption: false },
      rawVersion: '1.0.0-mock',
      authenticated: true,
      notes: [],
    }),
    probeCodexCliCapabilities: vi.fn().mockResolvedValue({
      capabilities: {
        structuredIO: true,
        permissionEvents: false,
        clarificationEvents: false,
        stdinResponses: false,
      },
      rawVersion: '0.146.0-mock',
      authenticated: true,
      notes: [],
    }),
    normalizeProbeResult: vi.fn().mockReturnValue({ mode: 'available', summary: 'mock' }),
    normalizeCursorProbeResult: vi.fn().mockReturnValue({ mode: 'available', summary: 'mock' }),
    normalizeCodexProbeResult: vi.fn().mockReturnValue({ mode: 'streaming', summary: 'mock' }),
  };
});

vi.mock('@ai-dev-orchestrator/runner', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    FileBackedAgentStreamBus: MockFileBackedAgentStreamBus,
    FileBackedLiveRequestStore: MockFileBackedLiveRequestStore,
  };
});

vi.mock('@ai-dev-orchestrator/dashboard-server', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    DashboardHttpServer: vi.fn().mockImplementation(function (...args: unknown[]) {
      serverConstructorMock(...args);
      return { start: serverStartMock, stop: serverStopMock };
    }),
  };
});

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal()),
  existsSync: vi.fn().mockReturnValue(true),
}));

const initCommandMock = vi.fn().mockReturnValue(0);
vi.mock('../init', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  initCommand: (...args: unknown[]) => initCommandMock(...args),
}));

vi.mock('../../project-config', () => ({
  loadDefaultWorkflow: vi.fn(() => ({
    name: 'dev',
    version: '1.0.0',
    initialState: 'INTAKE',
    terminalStates: ['DONE', 'ABORTED'],
    states: {
      INTAKE: { type: 'action', transitions: [] },
      DONE: { type: 'terminal', transitions: [] },
    },
  })),
  loadProjectConfig: vi.fn(() => ({
    workflow: { name: 'dev', version: '1.0', globalTransitionLimit: 200 },
    roles: { assignments: {} },
    governance: {
      iterationLimits: {
        defaults: {
          maxReviewIterations: 2,
          maxJudgeArbitrations: 1,
          maxClarificationRounds: 3,
          maxAcceptanceIterations: 3,
        },
      },
      qualityGates: {
        specificationReadiness: {
          minCompletenessScore: 0.8,
        },
        implementationReview: {
          maxHighSeverityFindings: 0,
          maxMediumSeverityFindings: 3,
        },
      },
    },
    runtime: { logLevel: 'info' },
  })),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn(() => {
    const proc = {
      pid: 9999,
      killed: false,
      stdout: {
        on: vi.fn((_event: string, cb: (data: Buffer) => void) => {
          setTimeout(() => {
            cb(Buffer.from('  Local:   http://localhost:5173\n'));
          }, 10);
        }),
      },
      on: vi.fn(),
      kill: vi.fn(),
    };
    return proc;
  }),
}));

function makeFormatter(): OutputFormatter {
  return {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    summary: vi.fn(),
    startSpinner: vi.fn(),
    clearSpinner: vi.fn(),
    table: vi.fn(),
    json: vi.fn(),
  } as unknown as OutputFormatter;
}

function configurePaths(baseDir: string): void {
  vi.mocked(getAiDir).mockReturnValue(join(baseDir, '.ai'));
  vi.mocked(getRunsDir).mockReturnValue(join(baseDir, '.ai', 'runs'));
  vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, '.ai', 'runs', runId));
  vi.mocked(getDashboardLogPath).mockReturnValue(join(baseDir, '.ai', 'dashboard-server.log'));
}

function createLiveRun(runId: string): void {
  const runDir = getRunDir(runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'run.lock'),
    [
      `runId: ${runId}`,
      'pid: 12345',
      'acquiredAt: 2026-01-01T10:00:00Z',
      `lockPath: ${join(runDir, 'run.lock')}`,
      'hostname: test-host',
    ].join('\n'),
  );
  writeFileSync(join(runDir, 'journal.md'), '# Workflow Journal\n');
}

function createLiveRunWithInventory(runId: string): void {
  createLiveRun(runId);
  writeFileSync(
    join(getRunDir(runId), 'inventory.yaml'),
    [
      `runId: ${runId}`,
      'updatedAt: 2026-01-01T10:05:00Z',
      'totalCount: 1',
      'totalSizeBytes: 256',
      'artifacts:',
      '  - type: canonical_specification',
      '    name: requirements-output',
      '    version: 1',
      '    checksum: sha256:test',
      '    producedBy: requirements_analyst',
      '    createdAt: 2026-01-01T10:04:00Z',
      '    sizeBytes: 256',
    ].join('\n'),
  );
}

function createLiveRunWithInventoryAndOrphan(runId: string): void {
  createLiveRunWithInventory(runId);
  const artifactsDir = join(getRunDir(runId), 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(
    join(artifactsDir, 'intake-requirements.json'),
    JSON.stringify([{ title: 'Need AGENTS.md' }], null, 2),
  );
}

function createLiveRunWithArtifactFile(runId: string): void {
  createLiveRun(runId);
  const artifactsDir = join(getRunDir(runId), 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(
    join(artifactsDir, 'intake-requirements.json'),
    JSON.stringify([{ title: 'Need AGENTS.md' }], null, 2),
  );
}

async function waitForDashboardReady(formatter: OutputFormatter, timeoutMs = 5_000): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const infoMock = formatter.info as ReturnType<typeof vi.fn>;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const calls = infoMock.mock.calls as unknown[][];
    if (calls.some((c) => typeof c[0] === 'string' && c[0].includes('Dashboard running on'))) {
      return;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Dashboard did not become ready within timeout');
}

describe('dashboardCommand', { timeout: 30_000 }, () => {
  let sigintCount = 0;
  let pendingPromise: Promise<unknown> | null = null;
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- dynamic import needed for vi.mock isolation
  let dashboardCommand: Awaited<typeof import('../dashboard')>['dashboardCommand'];

  beforeAll(async () => {
    ({ dashboardCommand } = await import('../dashboard'));
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    sigintCount = process.listenerCount('SIGINT');
    pendingPromise = null;
  });

  afterEach(async () => {
    if (pendingPromise) {
      process.emit('SIGINT', 'SIGINT');
      await Promise.race([
        pendingPromise.catch(() => {}),
        new Promise((r) => setTimeout(r, 3_000)),
      ]);
      pendingPromise = null;
    }
    while (process.listenerCount('SIGINT') > sigintCount) {
      const listeners = process.listeners('SIGINT');
      process.removeListener('SIGINT', listeners[listeners.length - 1]);
    }
  });

  it('creates a FileBackedAgentStreamBus pointed at the runs directory', async () => {
    const baseDir = '/tmp/test-project';
    configurePaths(baseDir);
    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');

    await promise;
    pendingPromise = null;

    expect(fileBackedBusConstructorMock).toHaveBeenCalledTimes(1);
    expect(fileBackedBusConstructorMock).toHaveBeenCalledWith(getRunsDir());
  });

  it('passes the file-backed bus to DashboardHttpServer', async () => {
    const baseDir = join(tmpdir(), `dashboard-bus-${String(Date.now())}-a`);
    configurePaths(baseDir);
    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');

    await promise;
    pendingPromise = null;

    expect(serverConstructorMock).toHaveBeenCalledTimes(1);
    const constructorArgs = serverConstructorMock.mock.calls[0] as unknown[];
    const opts = constructorArgs[0] as { agentStreamBus: unknown };
    expect(opts.agentStreamBus).toBeInstanceOf(MockFileBackedAgentStreamBus);
  });

  it('disposes the bus on shutdown', async () => {
    const baseDir = join(tmpdir(), `dashboard-bus-${String(Date.now())}-b`);
    configurePaths(baseDir);
    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');

    await promise;
    pendingPromise = null;

    const constructorArgs = serverConstructorMock.mock.calls[0] as unknown[];
    const opts = constructorArgs[0] as { agentStreamBus: MockFileBackedAgentStreamBus };
    expect(opts.agentStreamBus.dispose).toHaveBeenCalled();
  });

  it('includes active runs without manifest files in dashboard history', async () => {
    const baseDir = join(tmpdir(), `dashboard-live-${String(Date.now())}`);
    configurePaths(baseDir);
    createLiveRun('run-live-001');

    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');
    await promise;
    pendingPromise = null;

    const constructorArgs = serverConstructorMock.mock.calls[0] as unknown[];
    const opts = constructorArgs[0] as { dataProvider: unknown };
    const provider = opts.dataProvider as {
      getRunHistory: () => { ok: boolean; value?: Array<{ runId: string; status: string }> };
    };
    const result = provider.getRunHistory();
    expect(result.ok).toBe(true);
    expect(result.value?.[0]).toMatchObject({ runId: 'run-live-001', status: 'running' });
  });

  it('provides run state and workflow for an early live run without checkpoint or manifest', async () => {
    const baseDir = join(tmpdir(), `dashboard-live-detail-${String(Date.now())}`);
    configurePaths(baseDir);
    createLiveRun('run-live-002');

    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');
    await promise;
    pendingPromise = null;

    const constructorArgs = serverConstructorMock.mock.calls[0] as unknown[];
    const opts = constructorArgs[0] as { dataProvider: unknown };
    const provider = opts.dataProvider as {
      getRunState: (runId: string) => {
        ok: boolean;
        value?: { runId: string; status: string; currentState: string };
      };
      getWorkflowView: (runId: string) => {
        ok: boolean;
        value?: { currentState: string };
      };
    };

    const stateResult = provider.getRunState('run-live-002');
    expect(stateResult.ok).toBe(true);
    expect(stateResult.value).toMatchObject({
      runId: 'run-live-002',
      status: 'running',
      currentState: 'INTAKE',
    });

    const workflowResult = provider.getWorkflowView('run-live-002');
    expect(workflowResult.ok).toBe(true);
    expect(workflowResult.value?.currentState).toBe('INTAKE');
  });

  it('returns live artifact inventory from inventory.yaml before a manifest exists', async () => {
    const baseDir = join(tmpdir(), `dashboard-live-artifacts-${String(Date.now())}`);
    configurePaths(baseDir);
    createLiveRunWithInventory('run-live-003');

    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');
    await promise;
    pendingPromise = null;

    const constructorArgs = serverConstructorMock.mock.calls[0] as unknown[];
    const opts = constructorArgs[0] as { dataProvider: unknown };
    const provider = opts.dataProvider as {
      getArtifactView: (runId: string) => {
        ok: boolean;
        value?: { totalCount: number; artifacts: Array<{ name: string; producedBy: string }> };
      };
    };

    const artifactResult = provider.getArtifactView('run-live-003');
    expect(artifactResult.ok).toBe(true);
    expect(artifactResult.value).toMatchObject({
      totalCount: 1,
      artifacts: [{ name: 'requirements-output', producedBy: 'requirements_analyst' }],
    });
  });

  it('merges inventory artifacts with filesystem orphans', async () => {
    const baseDir = join(tmpdir(), `dashboard-orphan-merge-${String(Date.now())}`);
    configurePaths(baseDir);
    createLiveRunWithInventoryAndOrphan('run-live-orphan');

    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');
    await promise;
    pendingPromise = null;

    const constructorArgs = serverConstructorMock.mock.calls[0] as unknown[];
    const opts = constructorArgs[0] as { dataProvider: unknown };
    const provider = opts.dataProvider as {
      getArtifactView: (runId: string) => {
        ok: boolean;
        value?: {
          totalCount: number;
          artifacts: Array<{ name: string; type: string; producedBy: string }>;
        };
      };
    };

    const artifactResult = provider.getArtifactView('run-live-orphan');
    expect(artifactResult.ok).toBe(true);
    expect(artifactResult.value?.totalCount).toBe(2);
    const names = artifactResult.value?.artifacts.map((a) => a.name) ?? [];
    expect(names).toContain('requirements-output');
    expect(names).toContain('intake-requirements');
    const intakeArtifact = artifactResult.value?.artifacts.find(
      (a) => a.name === 'intake-requirements',
    );
    expect(intakeArtifact?.type).toBe('intake_requirements');
    expect(intakeArtifact?.producedBy).toBe('human');
  });

  it('returns live artifact inventory from artifacts directory before inventory exists', async () => {
    const baseDir = join(tmpdir(), `dashboard-live-artifact-files-${String(Date.now())}`);
    configurePaths(baseDir);
    createLiveRunWithArtifactFile('run-live-004');

    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');
    await promise;
    pendingPromise = null;

    const constructorArgs = serverConstructorMock.mock.calls[0] as unknown[];
    const opts = constructorArgs[0] as { dataProvider: unknown };
    const provider = opts.dataProvider as {
      getArtifactView: (runId: string) => {
        ok: boolean;
        value?: { totalCount: number; totalSizeBytes: number; artifacts: Array<{ name: string }> };
      };
    };

    const artifactResult = provider.getArtifactView('run-live-004');
    expect(artifactResult.ok).toBe(true);
    expect(artifactResult.value?.totalCount).toBe(1);
    expect(artifactResult.value?.totalSizeBytes).toBeGreaterThan(0);
    expect(artifactResult.value?.artifacts[0]).toMatchObject({
      name: 'intake-requirements',
      type: 'intake_requirements',
      producedBy: 'human',
    });
  });

  it('outputs JSON with apiUrl, dashboardUrl, and pid when --json is set', async () => {
    const baseDir = join(tmpdir(), `dashboard-json-${String(Date.now())}`);
    configurePaths(baseDir);
    const formatter = makeFormatter();
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });

    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: true, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');

    await promise;
    pendingPromise = null;
    vi.restoreAllMocks();

    const jsonLine = stdoutChunks.find((c) => c.includes('apiUrl'));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine ?? '') as {
      apiUrl: string;
      dashboardUrl: string;
      pid: number;
    };
    expect(parsed.apiUrl).toContain('127.0.0.1');
    expect(parsed.dashboardUrl).toContain('http');
    expect(parsed.pid).toBe(process.pid);
  });

  it('returns GENERAL_ERROR when server fails to start', async () => {
    const baseDir = join(tmpdir(), `dashboard-fail-${String(Date.now())}`);
    configurePaths(baseDir);
    serverStartMock.mockRejectedValueOnce(new Error('EADDRINUSE'));

    const formatter = makeFormatter();
    const code = await dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );

    expect(code).toBe(1); // ExitCode.GENERAL_ERROR
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.error).toHaveBeenCalled();
  });

  it('returns live artifact content from artifacts directory before inventory exists', async () => {
    const baseDir = join(tmpdir(), `dashboard-live-artifact-content-${String(Date.now())}`);
    configurePaths(baseDir);
    createLiveRunWithArtifactFile('run-live-005');

    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');
    await promise;
    pendingPromise = null;

    const constructorArgs = serverConstructorMock.mock.calls[0] as unknown[];
    const opts = constructorArgs[0] as { dataProvider: unknown };
    const provider = opts.dataProvider as {
      getArtifactContent: (
        runId: string,
        type: string,
        name: string,
        version: number,
      ) => { ok: boolean; value?: { content: string; contentType: string } };
    };

    const contentResult = provider.getArtifactContent(
      'run-live-005',
      'intake_requirements',
      'intake-requirements',
      1,
    );
    expect(contentResult.ok).toBe(true);
    expect(contentResult.value).toMatchObject({
      contentType: 'json',
    });
    expect(contentResult.value?.content).toContain('Need AGENTS.md');
  });

  it('runs init automatically when ~/.ai does not exist', async () => {
    const baseDir = join(tmpdir(), `dashboard-auto-init-${String(Date.now())}`);
    configurePaths(baseDir);
    const aiDir = getAiDir();

    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p) === aiDir) {
        return false;
      }
      return true;
    });

    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');
    await promise;
    pendingPromise = null;

    expect(initCommandMock).toHaveBeenCalledWith(
      { force: false, json: false, verbose: false },
      formatter,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.info).toHaveBeenCalledWith('No configuration found — running init...');
  });

  it('does not run init when ~/.ai already exists', async () => {
    const baseDir = join(tmpdir(), `dashboard-no-init-${String(Date.now())}`);
    configurePaths(baseDir);

    vi.mocked(existsSync).mockReturnValue(true);

    const formatter = makeFormatter();
    const promise = dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );
    pendingPromise = promise;

    await waitForDashboardReady(formatter);
    process.emit('SIGINT', 'SIGINT');
    await promise;
    pendingPromise = null;

    expect(initCommandMock).not.toHaveBeenCalled();
  });

  it('returns init error code when init fails', async () => {
    const baseDir = join(tmpdir(), `dashboard-init-fail-${String(Date.now())}`);
    configurePaths(baseDir);
    const aiDir = getAiDir();

    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p) === aiDir) {
        return false;
      }
      return true;
    });
    initCommandMock.mockReturnValueOnce(2); // ExitCode.CONFIGURATION_ERROR

    const formatter = makeFormatter();
    const code = await dashboardCommand(
      { port: 0, host: '127.0.0.1', open: false, json: false, verbose: false },
      formatter,
    );

    expect(code).toBe(2);
    expect(initCommandMock).toHaveBeenCalled();
  });
});

describe('stateRolesFromDefinition', { timeout: 30_000 }, () => {
  let stateRolesFromDefinition: (def: WorkflowDefinition) => ReadonlyMap<string, readonly string[]>;

  beforeAll(async () => {
    const mod = await import('../../dashboard/data-sources');
    stateRolesFromDefinition = mod.stateRolesFromDefinition;
  }, 30_000);

  const baseDef: WorkflowDefinition = {
    name: 'test',
    version: '1.0.0',
    initialState: 'INTAKE',
    terminalStates: ['DONE'],
    states: {},
  };

  it('extracts single dispatch_worker roles', () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      states: {
        INTAKE: {
          type: 'action',
          description: 'Intake',
          transitions: [],
          entryActions: [{ type: 'dispatch_worker', params: { role: 'requirements_analyst' } }],
        },
        PLANNING: {
          type: 'action',
          description: 'Planning',
          transitions: [],
          entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
        },
        DONE: { type: 'terminal', description: 'Done', transitions: [] },
      },
    };

    const result = stateRolesFromDefinition(def);
    expect(result.get('INTAKE')).toEqual(['requirements_analyst']);
    expect(result.get('PLANNING')).toEqual(['planner']);
    expect(result.has('DONE')).toBe(false);
  });

  it('extracts parallel dispatch roles', () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      states: {
        CODE_REVIEW: {
          type: 'review',
          description: 'Code Review',
          transitions: [],
          entryActions: [
            {
              type: 'dispatch_parallel_workers',
              params: { roles: ['static_reviewer', 'design_reviewer', 'security_reviewer'] },
            },
          ],
        },
        DONE: { type: 'terminal', description: 'Done', transitions: [] },
      },
    };

    const result = stateRolesFromDefinition(def);
    expect(result.get('CODE_REVIEW')).toEqual([
      'static_reviewer',
      'design_reviewer',
      'security_reviewer',
    ]);
  });

  it('merges single and parallel roles for the same state', () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      states: {
        REVIEW: {
          type: 'review',
          description: 'Review',
          transitions: [],
          entryActions: [
            { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
            {
              type: 'dispatch_parallel_workers',
              params: { roles: ['static_reviewer', 'security_reviewer'] },
            },
          ],
        },
        DONE: { type: 'terminal', description: 'Done', transitions: [] },
      },
    };

    const result = stateRolesFromDefinition(def);
    expect(result.get('REVIEW')).toEqual(['plan_reviewer', 'static_reviewer', 'security_reviewer']);
  });

  it('returns empty map for states without entry actions', () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      states: {
        INTAKE: { type: 'action', description: 'Intake', transitions: [] },
        DONE: { type: 'terminal', description: 'Done', transitions: [] },
      },
    };

    const result = stateRolesFromDefinition(def);
    expect(result.size).toBe(0);
  });

  it('ignores non-dispatch entry actions', () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      states: {
        INTAKE: {
          type: 'action',
          description: 'Intake',
          transitions: [],
          entryActions: [
            { type: 'record_journal', params: { event: 'run_started' } },
            { type: 'dispatch_worker', params: { role: 'requirements_analyst' } },
          ],
        },
        DONE: { type: 'terminal', description: 'Done', transitions: [] },
      },
    };

    const result = stateRolesFromDefinition(def);
    expect(result.get('INTAKE')).toEqual(['requirements_analyst']);
  });
});
