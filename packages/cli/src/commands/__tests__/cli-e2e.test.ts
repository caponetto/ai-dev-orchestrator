import { type Dirent, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultJournalReader, DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { WorkflowDefinition } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, beforeEach, afterEach, vi, assert } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getAiDir, getJournalPath, getRunDir, getRunsDir } from '../../workspace-paths';
import { answerCommand } from '../answer';
import { approveCommand } from '../approve';
import { artifactsCommand } from '../artifacts';
import { inspectCommand } from '../inspect';
import { listCommand } from '../list';
import { retryCommand } from '../retry';
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

async function seedTextWait(runId: string): Promise<void> {
  const persistence = new DefaultStatePersistence(getRunsDir());
  const state = persistence.load(createRunId(runId));
  assert(state);
  const definition: WorkflowDefinition = {
    name: 'answer-journey',
    version: '1',
    initialState: 'WAITING_FOR_HUMAN',
    terminalStates: ['DONE'],
    states: {
      WAITING_FOR_HUMAN: {
        type: 'wait',
        description: 'Clarification',
        transitions: [
          {
            target: 'DONE',
            trigger: 'human_input',
            guards: [],
            priority: 0,
            governanceRequired: false,
          },
        ],
      },
      DONE: { type: 'terminal', description: '', transitions: [] },
    },
  };
  writeFileSync(join(getRunDir(runId), 'workflow-definition.json'), JSON.stringify(definition));
  await persistence.save({
    ...state,
    currentState: 'WAITING_FOR_HUMAN',
    previousState: state.currentState,
    workflowName: definition.name,
    workflowVersion: definition.version,
    persistedAt: new Date(Math.max(Date.now(), Date.parse(state.persistedAt) + 1)).toISOString(),
    waitingContext: {
      reason: 'clarification_needed',
      requiredInput: 'text',
      requestingState: 'WAITING_FOR_HUMAN',
      waitingSince: 'answer-journey',
      autoResumeSafe: false,
      presentedArtifacts: [],
    },
  });
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

  it.each(['FAILED', 'ABORTED'])(
    'direct retry recovers a %s checkpoint with real composition',
    async (terminal) => {
      const formatter = new OutputFormatter({ noColor: true });
      expect(
        await runCommand(
          baseDir,
          {
            sources: ['Verify retry'],
            verbose: false,
            json: false,
            dryRun: false,
          },
          formatter,
        ),
      ).toBe(ExitCode.SUCCESS);
      const runId = findRunId();
      const persistence = new DefaultStatePersistence(getRunsDir());
      const checkpoint = persistence.load(createRunId(runId));
      assert(checkpoint);
      const definition: WorkflowDefinition = {
        name: 'retry-test',
        version: '1',
        initialState: 'WORK',
        terminalStates: ['DONE', terminal],
        states: {
          WORK: {
            type: 'action',
            description: 'Retry worker',
            entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
            transitions: [
              {
                target: 'DONE',
                trigger: 'completion',
                guards: [],
                priority: 0,
                governanceRequired: false,
              },
            ],
          },
          DONE: { type: 'terminal', description: '', transitions: [] },
          [terminal]: { type: 'terminal', description: '', transitions: [] },
        },
      };
      writeFileSync(join(getRunDir(runId), 'workflow-definition.json'), JSON.stringify(definition));
      await persistence.save({
        ...checkpoint,
        currentState: terminal,
        previousState: 'WORK',
        workflowName: definition.name,
        workflowVersion: definition.version,
        stateHistory: ['WORK', terminal],
        waitingContext: undefined,
        pendingTerminalState: undefined,
        terminalRecoveryState: undefined,
        executionPaused: false,
        entryActionContinuation: undefined,
        interruptedActionResults: undefined,
        persistedAt: new Date().toISOString(),
      });
      const journalPath = getJournalPath(getRunDir(runId));
      new DefaultJournalWriter(journalPath, runId, 90).append({
        timestamp: new Date().toISOString(),
        runId,
        sequence: 0,
        type: 'error',
        data: {
          kind: 'error',
          errorCode: 'fixture_gap',
          message: 'Sparse sequence fixture',
          recoverable: true,
        },
      });

      const code = await retryCommand(baseDir, { runId, verbose: false, json: false }, formatter);

      expect(code, stderrChunks.join('')).toBe(ExitCode.SUCCESS);
      expect(persistence.load(createRunId(runId))).toMatchObject({
        currentState: 'DONE',
        stateHistory: ['WORK', terminal, 'WORK', 'DONE'],
        repoRoot: baseDir,
      });
      expect(persistence.probeLock(createRunId(runId)).exists).toBe(false);
      const sequences = new DefaultJournalReader(journalPath)
        .readAll()
        .map((event) => event.sequence);
      expect(sequences.at(-1)).toBeGreaterThan(91);
      expect(
        sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]),
      ).toBe(true);
    },
  );

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
    await seedTextWait(runId);

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
    await seedTextWait(runId);

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
