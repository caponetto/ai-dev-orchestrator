import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { stringify } from 'yaml';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getRunDir, getRunsDir } from '../../workspace-paths';
import { listCommand } from '../list';

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

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `ai-test-list-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createManifest(runId: string, overrides: Record<string, unknown> = {}): void {
  const runDir = getRunDir(runId);
  mkdirSync(runDir, { recursive: true });
  const manifest = {
    runId,
    version: '1.0.0',
    repository: '/test/repo',
    workflow: { name: 'default', version: '1.0.0' },
    timing: {
      startedAt: '2026-01-01T10:00:00Z',
      completedAt: '2026-01-01T10:05:00Z',
      totalDurationMs: 300000,
      stateTimings: [],
    },
    status: 'completed',
    finalState: 'DONE',
    activeRoles: [],
    artifactInventory: [],
    totalArtifacts: 5,
    totalArtifactSizeBytes: 1024,
    iterations: [],
    governanceDecisions: 2,
    escalations: 0,
    humanInterventions: 0,
    agreements: [],
    tokenUsage: {
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalTokens: 1500,
      byRole: {},
    },
    ...overrides,
  };
  writeFileSync(join(runDir, 'manifest.yaml'), stringify(manifest));
}

function createLiveRun(runId: string): void {
  const runDir = getRunDir(runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'run.lock'),
    stringify({
      runId,
      pid: 12345,
      acquiredAt: '2026-01-01T10:00:00Z',
      lockPath: join(runDir, 'run.lock'),
      hostname: 'test-host',
    }),
  );
  writeFileSync(
    join(runDir, 'journal.md'),
    [
      '# Workflow Journal',
      '',
      '---',
      'timestamp: 2026-01-01T10:00:00Z',
      `runId: ${runId}`,
      'type: run_started',
      'data:',
      '  status: run_started',
      '---',
    ].join('\n'),
  );
}

describe('listCommand', () => {
  let stdout: string;
  let tmpDir: string;

  beforeEach(() => {
    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    tmpDir = createTempDir();
    vi.mocked(getRunsDir).mockReturnValue(join(tmpDir, 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(tmpDir, 'runs', runId));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns SUCCESS with no runs directory', () => {
    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = listCommand({ status: null, limit: 0, json: false, verbose: false }, formatter);
    expect(result).toBe(ExitCode.SUCCESS);
  });

  it('outputs empty array in JSON mode when no runs', () => {
    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    listCommand({ status: null, limit: 0, json: true, verbose: false }, formatter);
    const parsed = JSON.parse(stdout) as { runs: unknown[] };
    expect(parsed.runs).toEqual([]);
  });

  it('lists runs from manifest files', () => {
    createManifest('run-001');
    createManifest('run-002', { status: 'failed', finalState: 'ABORTED' });

    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    listCommand({ status: null, limit: 0, json: true, verbose: false }, formatter);
    const parsed = JSON.parse(stdout) as { runs: Array<{ runId: string }> };
    expect(parsed.runs).toHaveLength(2);
  });

  it('includes in-progress runs without manifest files', () => {
    createLiveRun('run-live-001');

    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    listCommand({ status: null, limit: 0, json: true, verbose: false }, formatter);
    const parsed = JSON.parse(stdout) as { runs: Array<{ runId: string; status: string }> };
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]).toMatchObject({ runId: 'run-live-001', status: 'running' });
  });

  it('filters by status', () => {
    createManifest('run-001', { status: 'completed' });
    createManifest('run-002', { status: 'failed' });

    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    listCommand({ status: 'completed', limit: 0, json: true, verbose: false }, formatter);
    const parsed = JSON.parse(stdout) as { runs: Array<{ status: string }> };
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]?.status).toBe('completed');
  });

  it('respects limit option', () => {
    createManifest('run-001');
    createManifest('run-002');
    createManifest('run-003');

    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    listCommand({ status: null, limit: 2, json: true, verbose: false }, formatter);
    const parsed = JSON.parse(stdout) as { runs: unknown[] };
    expect(parsed.runs).toHaveLength(2);
  });

  it('displays table in text mode', () => {
    createManifest('run-001');

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    listCommand({ status: null, limit: 0, json: false, verbose: false }, formatter);
    expect(stdout).toContain('run-001');
    expect(stdout).toContain('completed');
  });

  it('displays "no runs match" message in text mode when filter excludes all runs', () => {
    createManifest('run-001', { status: 'completed' });

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = listCommand(
      { status: 'failed', limit: 0, json: false, verbose: false },
      formatter,
    );
    expect(result).toBe(ExitCode.SUCCESS);
    expect(stdout).toContain('No runs match the filter criteria');
  });

  it('shows verbose details per run', () => {
    createManifest('run-001');

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: true });
    const result = listCommand({ status: null, limit: 0, json: false, verbose: true }, formatter);
    expect(result).toBe(ExitCode.SUCCESS);
    expect(stdout).toContain('default');
    expect(stdout).toContain('DONE');
    expect(stdout).toContain('1500');
  });

  it('returns empty JSON when filter excludes all runs', () => {
    createManifest('run-001', { status: 'completed' });

    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    const result = listCommand(
      { status: 'failed', limit: 0, json: true, verbose: false },
      formatter,
    );
    expect(result).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdout) as { runs: unknown[] };
    expect(parsed.runs).toEqual([]);
  });
});
