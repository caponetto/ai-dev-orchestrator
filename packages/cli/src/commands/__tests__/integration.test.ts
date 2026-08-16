import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-orchestrator/core';
import { createRunId } from '@ai-orchestrator/ports';
import type { PersistedState, RunId } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getAiDir, getRunDir, getRunsDir } from '../../workspace-paths';
import { abortCommand } from '../abort';
import { configShowCommand } from '../config-show';
import { statusCommand } from '../status';
import { validateCommand } from '../validate';

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

async function createAndSaveState(
  runsDir: string,
  runId: RunId,
  currentState: string,
  overrides: Partial<PersistedState> = {},
): Promise<void> {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });

  const state: PersistedState = {
    runId,
    schemaVersion: 1,
    currentState,
    previousState: 'INTAKE',
    stateEnteredAt: new Date().toISOString(),
    transitionCount: 2,
    stateHistory: ['INTAKE', currentState],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    persistedAt: new Date().toISOString(),
    persistenceVersion: 1,
    checksum: '',
    ...overrides,
  };

  const persistence = new DefaultStatePersistence(runsDir);
  await persistence.save(state);
}

describe('CLI Integration Tests', () => {
  let baseDir: string;
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-integration-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getAiDir).mockReturnValue(join(baseDir, '.ai'));
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, '.ai', 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, '.ai', 'runs', runId));
    stdoutChunks = [];
    stderrChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  describe('abort → status flow', () => {
    it('abort changes state, status reads the new state', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'PLANNING');

      const formatter = new OutputFormatter({ noColor: true });

      const abortCode = await abortCommand(
        { runId, json: false, verbose: false, force: true },
        formatter,
      );
      expect(abortCode).toBe(ExitCode.RUN_ABORTED);

      stdoutChunks = [];
      const statusCode = await statusCommand(
        { runId, json: true, verbose: false, watch: false },
        formatter,
      );
      expect(statusCode).toBe(ExitCode.SUCCESS);

      const statusData = JSON.parse(stdoutChunks[0] ?? '') as {
        currentState: string;
        status: string;
      };
      expect(statusData.currentState).toBe('ABORTED');
      expect(statusData.status).toBe('aborted');
    });
  });

  describe('status with multiple runs', () => {
    it('finds the latest run when no runId specified', async () => {
      const runsDir = getRunsDir();
      const run1 = '20260101-100000-aaaaaa' as RunId;
      const run2 = '20260101-200000-bbbbbb' as RunId;

      await createAndSaveState(runsDir, run1, 'DONE');
      await createAndSaveState(runsDir, run2, 'PLANNING');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await statusCommand(
        { runId: null, json: true, verbose: false, watch: false },
        formatter,
      );
      expect(code).toBe(ExitCode.SUCCESS);

      const data = JSON.parse(stdoutChunks[0] ?? '') as { runId: string };
      expect(data.runId).toBe(run2);
    });
  });

  describe('validate with valid defaults', () => {
    it('returns SUCCESS when no config exists (uses built-in defaults)', () => {
      const formatter = new OutputFormatter({ noColor: true });
      const code = validateCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(stdoutChunks.join('')).toContain('valid');
    });

    it('returns valid JSON output', () => {
      const formatter = new OutputFormatter({ json: true });
      const code = validateCommand({ json: true, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);

      const data = JSON.parse(stdoutChunks[0] ?? '') as { valid: boolean; errors: unknown[] };
      expect(data.valid).toBe(true);
      expect(data.errors).toEqual([]);
    });
  });

  describe('config show with defaults', () => {
    it('returns SUCCESS and displays sections', () => {
      const formatter = new OutputFormatter({ noColor: true });
      const code = configShowCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      const output = stdoutChunks.join('');
      expect(output).toContain('workflow');
      expect(output).toContain('roles');
    });

    it('returns full config as JSON', () => {
      const formatter = new OutputFormatter({ json: true });
      const code = configShowCommand({ json: true, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);

      const data = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
      expect(data).toHaveProperty('workflow');
      expect(data).toHaveProperty('roles');
      expect(data).toHaveProperty('governance');
      expect(data).toHaveProperty('runtime');
    });
  });

  describe('validate with invalid config', () => {
    it('returns CONFIGURATION_ERROR for malformed YAML', () => {
      const aiDir = getAiDir();
      mkdirSync(aiDir, { recursive: true });
      writeFileSync(join(aiDir, 'config.yaml'), '{{invalid yaml: [');

      const formatter = new OutputFormatter({ noColor: true });
      const code = validateCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.CONFIGURATION_ERROR);
    });
  });

  describe('resume command', () => {
    it('reports error when run directory does not exist', async () => {
      const formatter = new OutputFormatter({ noColor: true });
      const { resumeCommand } = await import('../resume');
      const code = await resumeCommand(
        baseDir,
        { runId: 'nonexistent-run-id', verbose: false, json: false },
        formatter,
      );
      expect(code).toBe(ExitCode.GENERAL_ERROR);
      expect(stderrChunks.join('')).toContain('not found');
    });

    it('reports error when no interrupted run exists and no runId given', async () => {
      const formatter = new OutputFormatter({ noColor: true });
      const { resumeCommand } = await import('../resume');
      const code = await resumeCommand(
        baseDir,
        { runId: null, verbose: false, json: false },
        formatter,
      );
      expect(code).toBe(ExitCode.GENERAL_ERROR);
      expect(stderrChunks.join('')).toContain('No interrupted run');
    });
  });
});
