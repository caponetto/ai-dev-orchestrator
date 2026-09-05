import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { PersistedState, RunId } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getRunDir, getRunsDir } from '../../workspace-paths';
import { killCommand } from '../kill';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    execFileSync: vi.fn(),
  };
});

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

function writeLock(
  lockPath: string,
  runId: string,
  pid: number,
  acquiredAt = new Date().toISOString(),
): void {
  const dir = join(lockPath, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    lockPath,
    [
      `runId: ${runId}`,
      `pid: ${String(pid)}`,
      `acquiredAt: ${acquiredAt}`,
      `lockPath: ${lockPath}`,
      `hostname: ${hostname()}`,
    ].join('\n'),
    'utf8',
  );
}

/**
 * Configure execFileSync mock to simulate `ps` responses for process verification.
 * - comm query returns the process command name
 * - etime query returns the elapsed time since process start
 */
function mockPsResponses(commResult: string = 'node', etimeResult: string = '00:30'): void {
  vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
    const argsArr = args as string[];
    if (argsArr.includes('comm=')) {
      return commResult;
    }
    if (argsArr.includes('etime=')) {
      return etimeResult;
    }
    return '';
  });
}

describe('killCommand', () => {
  let baseDir: string;
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-kill-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, 'runs', runId));
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

  it('returns SUCCESS with no active runs', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await killCommand({ json: false, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(stdoutChunks.join('')).toContain('No active run processes found');
  });

  it('returns SUCCESS with no runs directory', async () => {
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, 'nonexistent'));
    const formatter = new OutputFormatter({ noColor: true });
    const code = await killCommand({ json: false, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it('returns JSON when no active runs', async () => {
    const formatter = new OutputFormatter({ json: true });
    const code = await killCommand({ json: true, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as { killed: unknown[]; count: number };
    expect(parsed.killed).toEqual([]);
    expect(parsed.count).toBe(0);
  });

  it('skips runs without lock files', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await killCommand({ json: false, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(stdoutChunks.join('')).toContain('No active run processes found');
  });

  it('skips runs with dead PIDs', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    const lockPath = join(runsDir, runId, 'run.lock');
    writeLock(lockPath, runId, 999999);

    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) {
        throw new Error('ESRCH');
      }
      return true;
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await killCommand({ json: false, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(stdoutChunks.join('')).toContain('No active run processes found');
  });

  it('kills active processes and marks runs as ABORTED', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const lockPath = join(runsDir, runId, 'run.lock');
    writeLock(lockPath, runId, 424242);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockPsResponses('node', '00:30');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await killCommand({ json: false, verbose: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    expect(killSpy).toHaveBeenCalledWith(-424242, 'SIGTERM');
    expect(stdoutChunks.join('')).toContain('Killed 1 active run');

    const updatedYaml = readFileSync(join(runsDir, runId, 'state.yaml'), 'utf8');
    expect(updatedYaml).toContain('ABORTED');
  });

  it('kills multiple active processes', async () => {
    const runId1 = createRunId();
    const runId2 = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId1, 'PLANNING');
    await createAndSaveState(runsDir, runId2, 'IMPLEMENTING');

    writeLock(join(runsDir, runId1, 'run.lock'), runId1, 111111);
    writeLock(join(runsDir, runId2, 'run.lock'), runId2, 222222);

    vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockPsResponses('node', '00:30');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await killCommand({ json: false, verbose: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    expect(stdoutChunks.join('')).toContain('Killed 2 active runs');
  });

  it('returns JSON output with kill results', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const lockPath = join(runsDir, runId, 'run.lock');
    writeLock(lockPath, runId, 424242);

    vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockPsResponses('node', '00:30');

    const formatter = new OutputFormatter({ json: true });
    const code = await killCommand({ json: true, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);

    const parsed = JSON.parse(stdoutChunks[0] ?? '') as {
      killed: { runId: string; pid: number; terminated: boolean }[];
      count: number;
      failed: number;
    };
    expect(parsed.count).toBe(1);
    expect(parsed.failed).toBe(0);
    expect(parsed.killed[0]?.runId).toBe(runId);
    expect(parsed.killed[0]?.pid).toBe(424242);
    expect(parsed.killed[0]?.terminated).toBe(true);
  });

  it('writes journal entry on kill', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const lockPath = join(runsDir, runId, 'run.lock');
    writeLock(lockPath, runId, 424242);

    vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockPsResponses('node', '00:30');

    const formatter = new OutputFormatter({ noColor: true });
    await killCommand({ json: false, verbose: false }, formatter);

    const journalPath = join(runsDir, runId, 'journal.md');
    expect(existsSync(journalPath)).toBe(true);
    const journal = readFileSync(journalPath, 'utf8');
    expect(journal).toContain('run_aborted');
    expect(journal).toContain('ai kill');
  });

  it('reports verbose output per process', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const lockPath = join(runsDir, runId, 'run.lock');
    writeLock(lockPath, runId, 424242);

    vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockPsResponses('node', '00:30');

    const formatter = new OutputFormatter({ noColor: true });
    await killCommand({ json: false, verbose: true }, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('PID 424242');
    expect(output).toContain('killed');
  });

  it('skips lock files from other hosts', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });

    writeFileSync(
      join(runDir, 'run.lock'),
      [`runId: ${runId}`, 'pid: 424242', 'hostname: other-machine'].join('\n'),
      'utf8',
    );

    const formatter = new OutputFormatter({ noColor: true });
    const code = await killCommand({ json: false, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(stdoutChunks.join('')).toContain('No active run processes found');
  });

  describe('PID recycling protection', () => {
    it('skips runs in terminal state DONE (stale lock)', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'DONE');

      const lockPath = join(runsDir, runId, 'run.lock');
      writeLock(lockPath, runId, 424242);

      vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockPsResponses('node', '00:30');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await killCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(stdoutChunks.join('')).toContain('No active run processes found');
    });

    it('skips runs in terminal state ABORTED (stale lock)', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'ABORTED');

      const lockPath = join(runsDir, runId, 'run.lock');
      writeLock(lockPath, runId, 424242);

      vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockPsResponses('node', '00:30');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await killCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(stdoutChunks.join('')).toContain('No active run processes found');
    });

    it('skips PIDs that are not Node.js processes (recycled PID)', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'PLANNING');

      const lockPath = join(runsDir, runId, 'run.lock');
      writeLock(lockPath, runId, 424242);

      vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockPsResponses('firefox', '00:30');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await killCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(stdoutChunks.join('')).toContain('No active run processes found');
    });

    it('skips PIDs when process started after lock was acquired (recycled PID)', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'PLANNING');

      const oldTimestamp = '2026-01-01T00:00:00Z';
      const lockPath = join(runsDir, runId, 'run.lock');
      writeLock(lockPath, runId, 424242, oldTimestamp);

      vi.spyOn(process, 'kill').mockImplementation(() => true);
      // Process has only been running 30 seconds, but lock is from months ago
      mockPsResponses('node', '00:30');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await killCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(stdoutChunks.join('')).toContain('No active run processes found');
    });

    it('kills when all guards pass: non-terminal, node process, consistent time', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'IMPLEMENTING');

      const lockPath = join(runsDir, runId, 'run.lock');
      writeLock(lockPath, runId, 424242);

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockPsResponses('node', '00:30');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await killCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(killSpy).toHaveBeenCalledWith(-424242, 'SIGTERM');
      expect(stdoutChunks.join('')).toContain('Killed 1 active run');
    });

    it('accepts Node variant names like /usr/local/bin/node', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'PLANNING');

      const lockPath = join(runsDir, runId, 'run.lock');
      writeLock(lockPath, runId, 424242);

      vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockPsResponses('/usr/local/bin/node', '00:30');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await killCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(stdoutChunks.join('')).toContain('Killed 1 active run');
    });

    it('handles hh:mm:ss etime format (3-part)', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'IMPLEMENTING');

      const lockPath = join(runsDir, runId, 'run.lock');
      writeLock(lockPath, runId, 424242);

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockPsResponses('node', '01:30:45');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await killCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(killSpy).toHaveBeenCalledWith(-424242, 'SIGTERM');
      expect(stdoutChunks.join('')).toContain('Killed 1 active run');
    });

    it('handles dd-hh:mm:ss etime format (4-part)', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'IMPLEMENTING');

      const lockPath = join(runsDir, runId, 'run.lock');
      writeLock(lockPath, runId, 424242);

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockPsResponses('node', '2-01:30:45');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await killCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(killSpy).toHaveBeenCalledWith(-424242, 'SIGTERM');
      expect(stdoutChunks.join('')).toContain('Killed 1 active run');
    });

    it('skips process when etime is not parseable (single segment)', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'PLANNING');

      const lockPath = join(runsDir, runId, 'run.lock');
      writeLock(lockPath, runId, 424242);

      vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockPsResponses('node', 'invalid');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await killCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(stdoutChunks.join('')).toContain('No active run processes found');
    });

    it('skips process when etime contains non-numeric parts', async () => {
      const runId = createRunId();
      const runsDir = getRunsDir();
      await createAndSaveState(runsDir, runId, 'PLANNING');

      const lockPath = join(runsDir, runId, 'run.lock');
      writeLock(lockPath, runId, 424242);

      vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockPsResponses('node', 'ab:cd');

      const formatter = new OutputFormatter({ noColor: true });
      const code = await killCommand({ json: false, verbose: false }, formatter);
      expect(code).toBe(ExitCode.SUCCESS);
      expect(stdoutChunks.join('')).toContain('No active run processes found');
    });
  });

  it('falls back to direct kill when process group kill fails', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const lockPath = join(runsDir, runId, 'run.lock');
    writeLock(lockPath, runId, 424242);

    let callCount = 0;
    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) {
        return true; // isProcessAlive check
      }
      callCount++;
      if (callCount === 1) {
        throw new Error('ESRCH'); // group kill fails
      }
      return true; // direct kill succeeds
    });
    mockPsResponses('node', '00:30');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await killCommand({ json: false, verbose: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    expect(stdoutChunks.join('')).toContain('Killed 1 active run');
  });

  it('returns GENERAL_ERROR when kill fails completely', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const lockPath = join(runsDir, runId, 'run.lock');
    writeLock(lockPath, runId, 424242);

    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) {
        return true; // isProcessAlive
      }
      throw new Error('EPERM');
    });
    mockPsResponses('node', '00:30');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await killCommand({ json: false, verbose: false }, formatter);

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(stderrChunks.join('')).toContain('Failed to kill');
  });

  it('handles JSON output when some kills fail', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const lockPath = join(runsDir, runId, 'run.lock');
    writeLock(lockPath, runId, 424242);

    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) {
        return true;
      }
      throw new Error('EPERM');
    });
    mockPsResponses('node', '00:30');

    const formatter = new OutputFormatter({ json: true });
    const code = await killCommand({ json: true, verbose: false }, formatter);

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as { failed: number; count: number };
    expect(parsed.failed).toBe(1);
    expect(parsed.count).toBe(0);
  });
});
