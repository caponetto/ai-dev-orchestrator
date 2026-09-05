import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { PersistedState, RunId } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getRunDir, getRunsDir } from '../../workspace-paths';
import { abortCommand } from '../abort';

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
  };

  const persistence = new DefaultStatePersistence(runsDir);
  await persistence.save(state);
}

describe('abortCommand', () => {
  let baseDir: string;
  let stdoutChunks: string[];

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-abort-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, 'runs', runId));
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('returns GENERAL_ERROR when no run found', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await abortCommand(
      { runId: null, json: false, verbose: false, force: true },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('returns SUCCESS when run already in terminal state', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'DONE');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await abortCommand({ runId, json: false, verbose: false, force: true }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(stdoutChunks.join('')).toContain('terminal state');
  });

  it('aborts a paused run and updates state to ABORTED', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'WAITING_FOR_HUMAN');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await abortCommand({ runId, json: false, verbose: false, force: true }, formatter);
    expect(code).toBe(ExitCode.RUN_ABORTED);

    const updatedYaml = readFileSync(join(getRunDir(runId), 'state.yaml'), 'utf8');
    expect(updatedYaml).toContain('ABORTED');
  });

  it('returns RUN_ABORTED exit code on successful abort', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await abortCommand({ runId, json: false, verbose: false, force: true }, formatter);
    expect(code).toBe(ExitCode.RUN_ABORTED);
  });

  it('writes journal entry on abort', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const formatter = new OutputFormatter({ noColor: true });
    await abortCommand({ runId, json: false, verbose: false, force: true }, formatter);

    const journalPath = join(getRunDir(runId), 'journal.md');
    expect(existsSync(journalPath)).toBe(true);
    const journal = readFileSync(journalPath, 'utf8');
    expect(journal).toContain('run_aborted');
  });

  it('produces valid JSON output', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const formatter = new OutputFormatter({ json: true });
    const code = await abortCommand({ runId, json: true, verbose: false, force: true }, formatter);
    expect(code).toBe(ExitCode.RUN_ABORTED);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as {
      runId: string;
      status: string;
      previousState: string;
    };
    expect(parsed.runId).toBe(runId);
    expect(parsed.status).toBe('aborted');
    expect(parsed.previousState).toBe('PLANNING');
  });

  it('returns JSON when run already in terminal state', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'DONE');

    const formatter = new OutputFormatter({ json: true });
    const code = await abortCommand({ runId, json: true, verbose: false, force: true }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as {
      runId: string;
      status: string;
      state: string;
    };
    expect(parsed.status).toBe('already_terminal');
    expect(parsed.state).toBe('DONE');
  });

  it('returns GENERAL_ERROR when lock-only run without force', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    writeFileSync(
      join(runDir, 'run.lock'),
      [
        `runId: ${runId}`,
        'pid: 424242',
        'acquiredAt: 2026-01-01T00:00:00Z',
        `lockPath: ${join(runDir, 'run.lock')}`,
        `hostname: ${hostname()}`,
      ].join('\n'),
      'utf8',
    );

    const formatter = new OutputFormatter({ noColor: true });
    const code = await abortCommand(
      { runId, json: false, verbose: false, force: false },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('returns GENERAL_ERROR for non-existent run directory', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await abortCommand(
      { runId: 'nonexistent-run', json: false, verbose: false, force: true },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('force aborts a lock-only run before the first checkpoint exists', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    const lockPath = join(runDir, 'run.lock');
    mkdirSync(runDir, { recursive: true });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    writeFileSync(
      lockPath,
      [
        `runId: ${runId}`,
        'pid: 424242',
        'acquiredAt: 2026-01-01T00:00:00Z',
        `lockPath: ${lockPath}`,
        `hostname: ${hostname()}`,
      ].join('\n'),
      'utf8',
    );

    const formatter = new OutputFormatter({ noColor: true });
    const code = await abortCommand({ runId, json: false, verbose: false, force: true }, formatter);

    expect(code).toBe(ExitCode.RUN_ABORTED);
    expect(killSpy).toHaveBeenCalledWith(-424242, 'SIGTERM');

    const updatedYaml = readFileSync(join(getRunDir(runId), 'state.yaml'), 'utf8');
    expect(updatedYaml).toContain('ABORTED');
  });
});
