import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { stringify } from 'yaml';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getRunDir, getRunsDir } from '../../workspace-paths';
import { artifactsCommand } from '../artifacts';

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
    `ai-test-artifacts-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createManifest(runId: string): void {
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
    artifactInventory: [
      {
        ref: { type: 'specification', name: 'spec-1', version: 1, checksum: 'abc123' },
        producedBy: 'analyst',
        createdAt: '2026-01-01T10:01:00Z',
        sizeBytes: 512,
      },
      {
        ref: { type: 'implementation', name: 'impl-1', version: 1, checksum: 'def456' },
        producedBy: 'implementer',
        createdAt: '2026-01-01T10:02:00Z',
        sizeBytes: 2048,
      },
      {
        ref: { type: 'test-suite', name: 'tests-1', version: 1, checksum: 'ghi789' },
        producedBy: 'test-generator',
        createdAt: '2026-01-01T10:03:00Z',
        sizeBytes: 1024,
      },
    ],
    totalArtifacts: 3,
    totalArtifactSizeBytes: 3584,
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
  };
  writeFileSync(join(runDir, 'manifest.yaml'), stringify(manifest));
}

describe('artifactsCommand', () => {
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
    const result = artifactsCommand(
      { runId: null, type: null, json: false, verbose: false },
      formatter,
    );
    expect(result).toBe(ExitCode.GENERAL_ERROR);
    expect(stderr).toContain('No runs directory');
  });

  it('returns error when manifest not found', () => {
    const runsDir = getRunsDir();
    mkdirSync(join(runsDir, 'run-missing'), { recursive: true });

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = artifactsCommand(
      { runId: 'run-missing', type: null, json: false, verbose: false },
      formatter,
    );
    expect(result).toBe(ExitCode.GENERAL_ERROR);
    expect(stderr).toContain('No manifest found');
  });

  it('displays all artifacts in JSON mode', () => {
    createManifest('run-001');

    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    const result = artifactsCommand(
      { runId: 'run-001', type: null, json: true, verbose: false },
      formatter,
    );
    expect(result).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdout) as { artifacts: Array<{ type: string }> };
    expect(parsed.artifacts).toHaveLength(3);
  });

  it('filters artifacts by type', () => {
    createManifest('run-001');

    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    const result = artifactsCommand(
      { runId: 'run-001', type: 'specification', json: true, verbose: false },
      formatter,
    );
    expect(result).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdout) as { artifacts: Array<{ type: string }> };
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.artifacts[0]?.type).toBe('specification');
  });

  it('displays artifacts table in text mode', () => {
    createManifest('run-001');

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = artifactsCommand(
      { runId: 'run-001', type: null, json: false, verbose: false },
      formatter,
    );
    expect(result).toBe(ExitCode.SUCCESS);
    expect(stdout).toContain('specification');
    expect(stdout).toContain('implementation');
    expect(stdout).toContain('test-suite');
  });

  it('shows verbose details including timestamps', () => {
    createManifest('run-001');

    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: true });
    const result = artifactsCommand(
      { runId: 'run-001', type: null, json: false, verbose: true },
      formatter,
    );
    expect(result).toBe(ExitCode.SUCCESS);
    expect(stdout).toContain('Created');
  });

  it('auto-selects latest run when no runId given', () => {
    createManifest('run-001');

    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    const result = artifactsCommand(
      { runId: null, type: null, json: true, verbose: false },
      formatter,
    );
    expect(result).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdout) as { runId: string };
    expect(parsed.runId).toBe('run-001');
  });
});
