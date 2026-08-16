import { type Dirent, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getAiDir, getRunDir, getRunsDir } from '../../workspace-paths';
import { answerCommand } from '../answer';
import { approveCommand } from '../approve';
import { artifactsCommand } from '../artifacts';
import { inspectCommand } from '../inspect';
import { listCommand } from '../list';
import { runCommand } from '../run';
import { statusCommand } from '../status';

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

function findRunId(): string {
  const runsDir = getRunsDir();
  const entries = readdirSync(runsDir, { withFileTypes: true })
    .filter((e: Dirent) => e.isDirectory())
    .map((e: Dirent) => e.name)
    .sort()
    .reverse();
  return entries[0];
}

function parseJsonFromChunks(chunks: string[]): unknown {
  const jsonLine = chunks.find((c) => c.trimStart().startsWith('{'));
  if (!jsonLine) {
    throw new Error(`No JSON found in output: ${chunks.join('')}`);
  }
  return JSON.parse(jsonLine);
}

describe('CLI E2E — User Journeys (real composition, fixture driver)', { timeout: 30_000 }, () => {
  let baseDir: string;
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-e2e-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getAiDir).mockReturnValue(join(baseDir, '.ai'));
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, '.ai', 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, '.ai', 'runs', runId));
    process.env['AI_ORCHESTRATOR_FIXTURE'] = '1';
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
    delete process.env['AI_ORCHESTRATOR_FIXTURE'];
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('happy path: run → approve → status → list → inspect → artifacts', async () => {
    const formatter = new OutputFormatter({ noColor: true });

    const runCode = await runCommand(
      baseDir,
      { sources: ['Add a health endpoint'], verbose: false, json: false, dryRun: false },
      formatter,
    );
    if (runCode !== ExitCode.SUCCESS) {
      throw new Error(`runCommand failed (code ${String(runCode)}): ${stderrChunks.join('')}`);
    }

    const runId = findRunId();
    expect(runId).toBeDefined();

    let iterations = 0;
    let finalState = '';
    while (finalState !== 'DONE' && iterations < 15) {
      stdoutChunks = [];
      await approveCommand(
        { runId, reject: false, message: null, json: true, verbose: false },
        formatter,
      );
      const result = parseJsonFromChunks(stdoutChunks) as { finalState: string };
      finalState = result.finalState;
      iterations++;
    }
    expect(finalState).toBe('DONE');

    stdoutChunks = [];
    const statusCode = await statusCommand(
      { runId, json: true, verbose: false, watch: false },
      formatter,
    );
    expect(statusCode).toBe(ExitCode.SUCCESS);
    const statusData = parseJsonFromChunks(stdoutChunks) as {
      currentState: string;
      status: string;
    };
    expect(statusData.currentState).toBe('DONE');
    expect(statusData.status).toBe('completed');

    stdoutChunks = [];
    const listCode = listCommand(
      { status: null, limit: 10, json: true, verbose: false },
      formatter,
    );
    expect(listCode).toBe(ExitCode.SUCCESS);
    const listData = parseJsonFromChunks(stdoutChunks) as { runs: Array<{ runId: string }> };
    expect(listData.runs.some((r) => r.runId === runId)).toBe(true);

    stdoutChunks = [];
    const inspectCode = inspectCommand({ runId, json: true, verbose: false }, formatter);
    expect(inspectCode).toBe(ExitCode.SUCCESS);
    const inspectData = parseJsonFromChunks(stdoutChunks) as { runId: string; status: string };
    expect(inspectData.runId).toBe(runId);

    stdoutChunks = [];
    const artifactsCode = artifactsCommand(
      { runId, type: null, json: true, verbose: false },
      formatter,
    );
    expect(artifactsCode).toBe(ExitCode.SUCCESS);

    const runDir = getRunDir(runId);
    expect(existsSync(join(runDir, 'journal.md'))).toBe(true);
    expect(existsSync(join(runDir, 'manifest.yaml'))).toBe(true);
  });

  it('feasible spec with no clarification needs completes without human gate', async () => {
    const formatter = new OutputFormatter({ noColor: true });

    const runCode = await runCommand(
      baseDir,
      { sources: ['Add logging'], verbose: false, json: false, dryRun: false },
      formatter,
    );
    expect(runCode).toBe(ExitCode.SUCCESS);

    const runId = findRunId();

    stdoutChunks = [];
    await statusCommand({ runId, json: true, verbose: false, watch: false }, formatter);
    const finalStatus = parseJsonFromChunks(stdoutChunks) as {
      currentState: string;
      status: string;
    };
    expect(finalStatus.currentState).toBe('DONE');
    expect(finalStatus.status).toBe('completed');
  });

  it('answer flow: run (paused) → answer → approve loop → done', async () => {
    const formatter = new OutputFormatter({ noColor: true });

    const runCode = await runCommand(
      baseDir,
      { sources: ['Fix the auth bug'], verbose: false, json: false, dryRun: false },
      formatter,
    );
    expect(runCode).toBe(ExitCode.SUCCESS);

    const runId = findRunId();

    stdoutChunks = [];
    await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: null,
        answers: ['Use structured logging for auth events'],
        json: true,
        verbose: false,
      },
      formatter,
    );
    const answerResult = parseJsonFromChunks(stdoutChunks) as { finalState: string };
    expect(answerResult.finalState).toBeDefined();

    let done = answerResult.finalState === 'DONE';
    let iterations = 0;
    while (!done && iterations < 15) {
      stdoutChunks = [];
      await approveCommand(
        { runId, reject: false, message: null, json: true, verbose: false },
        formatter,
      );
      const result = parseJsonFromChunks(stdoutChunks) as { finalState: string };
      if (result.finalState === 'DONE') {
        done = true;
      }
      iterations++;
    }

    expect(done).toBe(true);
  });

  it('resume flow: run (paused) → answer → approve loop → done', async () => {
    const formatter = new OutputFormatter({ noColor: true });

    const runCode = await runCommand(
      baseDir,
      {
        sources: ['Add caching to artifact store'],
        verbose: false,
        json: false,
        dryRun: false,
      },
      formatter,
    );
    expect(runCode).toBe(ExitCode.SUCCESS);

    const runId = findRunId();

    stdoutChunks = [];
    await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: null,
        answers: ['Use LRU eviction with 5-minute TTL'],
        json: true,
        verbose: false,
      },
      formatter,
    );

    let finalState = '';
    let iterations = 0;
    while (finalState !== 'DONE' && iterations < 15) {
      stdoutChunks = [];
      await approveCommand(
        { runId, reject: false, message: null, json: true, verbose: false },
        formatter,
      );
      const result = parseJsonFromChunks(stdoutChunks) as { finalState: string };
      finalState = result.finalState;
      iterations++;
    }
    expect(finalState).toBe('DONE');

    const runDir = getRunDir(runId);
    expect(existsSync(join(runDir, 'manifest.yaml'))).toBe(true);
  });
});
