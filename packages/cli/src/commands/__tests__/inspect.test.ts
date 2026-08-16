import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { stringify } from 'yaml';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getRunDir, getRunsDir } from '../../workspace-paths';
import { inspectCommand } from '../inspect';

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
    `ai-test-show-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
      stateTimings: [
        {
          stateId: 'INTAKE',
          enteredAt: '2026-01-01T10:00:00Z',
          exitedAt: '2026-01-01T10:01:00Z',
          durationMs: 60000,
          visits: 1,
        },
      ],
    },
    status: 'completed',
    finalState: 'DONE',
    activeRoles: [
      {
        role: 'implementer',
        dispatches: 2,
        inputTokens: 500,
        outputTokens: 300,
        totalDurationMs: 120000,
        artifactsProduced: 2,
      },
    ],
    artifactInventory: [
      {
        ref: { type: 'specification', name: 'spec-1', version: 1, checksum: 'abc' },
        producedBy: 'analyst',
        createdAt: '2026-01-01T10:01:00Z',
        sizeBytes: 512,
      },
    ],
    totalArtifacts: 1,
    totalArtifactSizeBytes: 512,
    iterations: [
      {
        contractId: 'impl-review',
        totalIterations: 2,
        judgeArbitrations: 0,
        finalStatus: 'accepted',
        findingsTotal: 3,
        findingsResolved: 3,
      },
    ],
    governanceDecisions: 4,
    escalations: 0,
    humanInterventions: 1,
    agreements: [{ type: 'review-agreement', name: 'review-1', version: 1, checksum: 'def' }],
    tokenUsage: {
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalTokens: 1500,
      byRole: { implementer: { input: 500, output: 300 } },
    },
    ...overrides,
  };
  writeFileSync(join(runDir, 'manifest.yaml'), stringify(manifest));
}

describe('inspectCommand', () => {
  let stdout: string;
  let stderr: string;
  let tmpDir: string;

  beforeEach(() => {
    stdout = '';
    stderr = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    tmpDir = createTempDir();
    vi.mocked(getRunsDir).mockReturnValue(join(tmpDir, 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(tmpDir, 'runs', runId));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error when no runs directory exists', () => {
    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = inspectCommand({ runId: null, json: false, verbose: false }, formatter);
    expect(result).toBe(ExitCode.GENERAL_ERROR);
    expect(stderr).toContain('No runs directory');
  });

  it('returns error when run has no manifest', () => {
    const runsDir = getRunsDir();
    mkdirSync(join(runsDir, 'run-missing'), { recursive: true });

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = inspectCommand({ runId: 'run-missing', json: false, verbose: false }, formatter);
    expect(result).toBe(ExitCode.GENERAL_ERROR);
    expect(stderr).toContain('No manifest found');
  });

  it('displays run details in text mode', () => {
    createManifest('run-001');

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = inspectCommand({ runId: 'run-001', json: false, verbose: false }, formatter);
    expect(result).toBe(ExitCode.SUCCESS);
    expect(stdout).toContain('run-001');
    expect(stdout).toContain('completed');
    expect(stdout).toContain('DONE');
  });

  it('outputs full manifest as JSON', () => {
    createManifest('run-001');

    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    const result = inspectCommand({ runId: 'run-001', json: true, verbose: false }, formatter);
    expect(result).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['runId']).toBe('run-001');
    expect(parsed['status']).toBe('completed');
  });

  it('shows verbose details including state timings and role usage', () => {
    createManifest('run-001');

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: true });
    const result = inspectCommand({ runId: 'run-001', json: false, verbose: true }, formatter);
    expect(result).toBe(ExitCode.SUCCESS);
    expect(stdout).toContain('INTAKE');
    expect(stdout).toContain('implementer');
    expect(stdout).toContain('impl-review');
  });

  it('auto-selects latest run when no runId given', () => {
    createManifest('run-001');
    createManifest('run-002');

    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    const result = inspectCommand({ runId: null, json: true, verbose: false }, formatter);
    expect(result).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['runId']).toBe('run-002');
  });

  it('shows budget summary when budgetSummary is present', () => {
    createManifest('run-budget', {
      budgetSummary: {
        configuredMaxTokens: 50000,
        budgetExceeded: false,
      },
    });

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = inspectCommand({ runId: 'run-budget', json: false, verbose: false }, formatter);
    expect(result).toBe(ExitCode.SUCCESS);
    expect(stdout).toContain('Budget');
    expect(stdout).toContain('50000');
    expect(stdout).toContain('No');
  });

  it('shows report path when present', () => {
    createManifest('run-report', {
      reportPath: '/path/to/report.html',
    });

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = inspectCommand({ runId: 'run-report', json: false, verbose: false }, formatter);
    expect(result).toBe(ExitCode.SUCCESS);
    expect(stdout).toContain('Report');
    expect(stdout).toContain('/path/to/report.html');
  });

  it('shows abort reason when present', () => {
    createManifest('run-aborted', {
      status: 'aborted',
      finalState: 'ABORTED',
      abortReason: 'Budget limit exceeded',
    });

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = inspectCommand({ runId: 'run-aborted', json: false, verbose: false }, formatter);
    expect(result).toBe(ExitCode.SUCCESS);
    expect(stdout).toContain('Abort Reason');
    expect(stdout).toContain('Budget limit exceeded');
  });
});
