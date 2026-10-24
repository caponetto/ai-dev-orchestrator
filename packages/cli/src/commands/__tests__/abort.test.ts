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

  it.each([true, false])('reports a success that wins the abort race (JSON: %s)', async (json) => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'DONE');
    const statePath = join(getRunDir(runId), 'state.yaml');
    const completed = readFileSync(statePath, 'utf8');
    await createAndSaveState(runsDir, runId, 'WAITING_FOR_HUMAN');
    const store = new DefaultStatePersistence(runsDir);
    const acquire = store.acquireLock.bind(store);
    vi.spyOn(DefaultStatePersistence.prototype, 'acquireLock').mockImplementation((id) => {
      writeFileSync(statePath, completed);
      return acquire(id);
    });
    const formatter = new OutputFormatter({ json, noColor: true });
    const code = await abortCommand({ runId, json, verbose: false, force: true }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    if (json) {
      expect(JSON.parse(stdoutChunks[0] ?? '')).toMatchObject({
        status: 'already_terminal',
        state: 'DONE',
      });
    } else {
      expect(stdoutChunks.join('')).toContain('terminal state: DONE');
    }
    expect(readFileSync(statePath, 'utf8')).toBe(completed);
  });

  it('returns GENERAL_ERROR when no run found', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await abortCommand(
      { runId: null, json: false, verbose: false, force: true },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('reports a failed abort save without claiming an abort or leaving its lock', async () => {
    const runId = createRunId();
    await createAndSaveState(getRunsDir(), runId, 'PLANNING');
    const statePath = join(getRunDir(runId), 'state.yaml');
    const before = readFileSync(statePath, 'utf8');
    vi.spyOn(DefaultStatePersistence.prototype, 'save').mockRejectedValueOnce(
      new Error('disk full'),
    );
    const formatter = new OutputFormatter({ json: true });
    const reportError = vi.spyOn(formatter, 'error');
    const code = await abortCommand({ runId, json: true, verbose: false, force: true }, formatter);
    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(reportError).toHaveBeenCalledOnce();
    expect(stdoutChunks.join('')).not.toContain('"status":"aborted"');
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(existsSync(join(getRunDir(runId), 'run.lock'))).toBe(false);
    expect(existsSync(join(getRunDir(runId), 'journal.md'))).toBe(false);
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

  it('does not report an already-terminal success while cleanup is pending', async () => {
    const runId = createRunId();
    await createAndSaveState(getRunsDir(), runId, 'DONE');
    const store = new DefaultStatePersistence(getRunsDir());
    const state = store.load(runId);
    expect(state).not.toBeNull();
    if (!state) {
      throw new Error('missing state');
    }
    await store.save({ ...state, pendingTerminalState: 'DONE', terminalRecoveryState: 'WORK' });
    const code = await abortCommand(
      { runId, json: true, verbose: false, force: true },
      new OutputFormatter({ json: true }),
    );
    expect(code).toBe(ExitCode.RUN_ABORTED);
    expect(JSON.parse(stdoutChunks[0] ?? '')).toMatchObject({
      status: 'aborted',
      finalState: 'ABORTED',
    });
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
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) {
        throw Object.assign(new Error('terminated'), { code: 'ESRCH' });
      }
      return true;
    });

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
