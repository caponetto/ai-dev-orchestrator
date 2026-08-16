import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-orchestrator/core';
import { createRunId } from '@ai-orchestrator/ports';
import { FileBackedLiveRequestStore } from '@ai-orchestrator/runner';
import type { PersistedState, RunManifest, RunResult } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { resumeOrchestrator } from '../../composition-root';
import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getRunDir, getRunsDir } from '../../workspace-paths';
import { answerCommand } from '../answer';

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

vi.mock('@ai-orchestrator/core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    DefaultStatePersistence: vi.fn().mockImplementation(function (this: {
      load: ReturnType<typeof vi.fn>;
    }) {
      this.load = vi.fn().mockReturnValue(null);
    }),
  };
});

vi.mock('../../composition-root', () => ({
  resumeOrchestrator: vi.fn(),
}));

const mockResumeOrchestrator = vi.mocked(resumeOrchestrator);

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runId: 'run-001',
    finalState: 'REFINEMENT',
    artifactInventory: [],
    manifest: {} as unknown as RunManifest,
    ...overrides,
  };
}

function mockEngineContext(
  runId: string,
  runDir: string,
  resumeImpl: ReturnType<typeof vi.fn>,
): void {
  mockResumeOrchestrator.mockResolvedValue({
    engine: { resume: resumeImpl, start: vi.fn() } as never,
    journalWriter: {} as never,
    journalReader: {} as never,
    statePersistence: {} as never,
    agentStreamBus: {} as never,
    liveRequestStore: {} as never,
    artifactStore: {} as never,
    runId,
    runDir,
    warnings: [],
  });
}

describe('answerCommand', () => {
  let baseDir: string;
  let stdoutChunks: string[];

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-answer-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, 'runs', runId));
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockResumeOrchestrator.mockReset();
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('returns GENERAL_ERROR when no run found', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      { runId: null, inputFile: null, messageId: null, answers: [], json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('returns GENERAL_ERROR when run directory does not exist', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      {
        runId: 'run-nonexistent-000000-abc123',
        inputFile: null,
        messageId: null,
        answers: ['yes'],
        json: false,
        verbose: false,
      },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('returns INVALID_ARGUMENTS when no answers provided', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      { runId, inputFile: null, messageId: null, answers: [], json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.INVALID_ARGUMENTS);
  });

  it('returns GENERAL_ERROR when input file cannot be read', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      {
        runId,
        inputFile: '/nonexistent/file.txt',
        messageId: null,
        answers: [],
        json: false,
        verbose: false,
      },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('accepts answers from positional arguments', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId }));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: null,
        answers: ['Yes, use OAuth2'],
        json: false,
        verbose: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    expect(mockResume).toHaveBeenCalledWith({ type: 'text', content: 'Yes, use OAuth2' });
  });

  it('joins multiple positional answers with newlines', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId }));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: null,
        answers: ['first', 'second'],
        json: false,
        verbose: false,
      },
      formatter,
    );

    expect(mockResume).toHaveBeenCalledWith({ type: 'text', content: 'first\nsecond' });
  });

  it('accepts answers from --input-file', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const answersFile = join(baseDir, 'answers.txt');
    writeFileSync(answersFile, 'Answer 1\nAnswer 2', 'utf8');

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId }));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      { runId, inputFile: answersFile, messageId: null, answers: [], json: false, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    expect(mockResume).toHaveBeenCalledWith({ type: 'text', content: 'Answer 1\nAnswer 2' });
  });

  it('writes clarification artifact before resuming engine', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId }));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: null,
        answers: ['my answer'],
        json: false,
        verbose: false,
      },
      formatter,
    );

    const artifactPath = join(runDir, 'artifacts', 'clarification_answers_v1.md');
    expect(existsSync(artifactPath)).toBe(true);
    expect(readFileSync(artifactPath, 'utf8')).toBe('my answer');
  });

  it('produces valid JSON output', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const mockResume = vi
      .fn()
      .mockResolvedValue(makeRunResult({ runId, finalState: 'REFINEMENT', artifactInventory: [] }));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ json: true });
    const code = await answerCommand(
      { runId, inputFile: null, messageId: null, answers: ['answer'], json: true, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
    expect(parsed.runId).toBe(runId);
    expect(parsed.status).toBe('answers_received');
    expect(parsed.finalState).toBe('REFINEMENT');
  });

  it('returns CONFIGURATION_ERROR when resumeOrchestrator fails', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    mockResumeOrchestrator.mockImplementation(() => {
      throw new Error('Configuration invalid');
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      { runId, inputFile: null, messageId: null, answers: ['answer'], json: false, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.CONFIGURATION_ERROR);
  });

  it('returns RUN_FAILED when engine.resume throws', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const mockResume = vi.fn().mockRejectedValue(new Error('Invalid transition'));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      { runId, inputFile: null, messageId: null, answers: ['answer'], json: false, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.RUN_FAILED);
  });

  it('answers targeted live clarification when --message-id matches', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'clar-001',
      kind: 'clarification',
      createdAt: new Date().toISOString(),
      payload: { question: 'Which database?' },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: 'clar-001',
        answers: ['PostgreSQL'],
        json: false,
        verbose: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    const response = await store.awaitResponse(runId, 'clar-001', 1000);
    expect(response).not.toBeNull();
    expect(response?.payload).toEqual({ answer: 'PostgreSQL' });
    expect(mockResumeOrchestrator).not.toHaveBeenCalled();
  });

  it('returns GENERAL_ERROR when --message-id does not match any pending clarification', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: 'nonexistent-msg',
        answers: ['PostgreSQL'],
        json: false,
        verbose: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(mockResumeOrchestrator).not.toHaveBeenCalled();
  });

  it('uses persisted path when --message-id not provided even with pending live clarifications', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'clar-first',
      kind: 'clarification',
      createdAt: new Date().toISOString(),
      payload: { question: 'Which framework?' },
    });

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId }));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: null,
        answers: ['React'],
        json: false,
        verbose: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    expect(mockResumeOrchestrator).toHaveBeenCalled();
    expect(mockResume).toHaveBeenCalledWith({ type: 'text', content: 'React' });
  });

  it('produces JSON output for targeted live clarification', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'clar-json',
      kind: 'clarification',
      createdAt: new Date().toISOString(),
      payload: { question: 'Which env?' },
    });

    const formatter = new OutputFormatter({ json: true });
    const code = await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: 'clar-json',
        answers: ['production'],
        json: true,
        verbose: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
    expect(parsed.runId).toBe(runId);
    expect(parsed.messageId).toBe('clar-json');
    expect(parsed.status).toBe('live_clarification_answered');
  });
});

describe('answerCommand session path', () => {
  let baseDir: string;
  let stdoutChunks: string[];

  function makeSessionState(overrides: Partial<PersistedState> = {}): PersistedState {
    return {
      runId: 'run-000000-abc123',
      schemaVersion: 1,
      currentState: 'WAITING_FOR_HUMAN',
      previousState: null,
      stateEnteredAt: '2026-01-01T00:00:00Z',
      transitionCount: 1,
      stateHistory: ['INIT', 'WAITING_FOR_HUMAN'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      waitingContext: {
        liveSessionId: 'session-abc',
        liveRequestType: 'clarification',
        pendingRequestId: 'req-123',
        reason: 'Need input',
        requiredInput: 'text',
        requestingState: 'REFINEMENT',
        autoResumeSafe: false,
        presentedArtifacts: [],
        waitingSince: '2026-01-01T00:00:00Z',
      },
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: '2026-01-01T00:00:00Z',
      persistenceVersion: 1,
      checksum: 'abc123',
      ...overrides,
    } as PersistedState;
  }

  function mockSessionEngineContext(
    runId: string,
    runDir: string,
    resumeImpl: ReturnType<typeof vi.fn>,
  ): void {
    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: resumeImpl, start: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: {} as never,
      statePersistence: {} as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      runId,
      runDir,
      warnings: [],
    });
  }

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-answer-session-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, 'runs', runId));
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockResumeOrchestrator.mockReset();
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('routes through session supervisor when state has live session for clarification', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    vi.mocked(DefaultStatePersistence).mockImplementation(function (this: {
      load: ReturnType<typeof vi.fn>;
    }) {
      this.load = vi.fn().mockReturnValue(makeSessionState({ runId }));
    } as never);

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId, finalState: 'DONE' }));
    mockSessionEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: null,
        answers: ['Use Redis'],
        json: false,
        verbose: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    expect(mockResumeOrchestrator).toHaveBeenCalled();
    expect(mockResume).toHaveBeenCalledWith({ type: 'text', content: 'Use Redis' });
  });

  it('returns GENERAL_ERROR when messageId does not match session pending request', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    vi.mocked(DefaultStatePersistence).mockImplementation(function (this: {
      load: ReturnType<typeof vi.fn>;
    }) {
      this.load = vi.fn().mockReturnValue(
        makeSessionState({
          runId,
          waitingContext: {
            liveSessionId: 'session-abc',
            liveRequestType: 'clarification',
            pendingRequestId: 'req-123',
            reason: 'Need input',
            requiredInput: 'text',
            requestingState: 'REFINEMENT',
            autoResumeSafe: false,
            presentedArtifacts: [],
            waitingSince: '2026-01-01T00:00:00Z',
          },
        }),
      );
    } as never);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: 'req-456',
        answers: ['answer'],
        json: false,
        verbose: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(mockResumeOrchestrator).not.toHaveBeenCalled();
  });

  it('returns CONFIGURATION_ERROR when resumeOrchestrator fails in session path', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    vi.mocked(DefaultStatePersistence).mockImplementation(function (this: {
      load: ReturnType<typeof vi.fn>;
    }) {
      this.load = vi.fn().mockReturnValue(makeSessionState({ runId }));
    } as never);

    mockResumeOrchestrator.mockImplementation(() => {
      throw new Error('Configuration invalid');
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      { runId, inputFile: null, messageId: null, answers: ['answer'], json: false, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.CONFIGURATION_ERROR);
  });

  it('returns RUN_FAILED when engine.resume fails in session path', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    vi.mocked(DefaultStatePersistence).mockImplementation(function (this: {
      load: ReturnType<typeof vi.fn>;
    }) {
      this.load = vi.fn().mockReturnValue(makeSessionState({ runId }));
    } as never);

    const mockResume = vi.fn().mockRejectedValue(new Error('Engine failure'));
    mockSessionEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      { runId, inputFile: null, messageId: null, answers: ['answer'], json: false, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.RUN_FAILED);
  });

  it('outputs JSON in session path', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    vi.mocked(DefaultStatePersistence).mockImplementation(function (this: {
      load: ReturnType<typeof vi.fn>;
    }) {
      this.load = vi.fn().mockReturnValue(makeSessionState({ runId }));
    } as never);

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId, finalState: 'COMPLETED' }));
    mockSessionEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ json: true });
    const code = await answerCommand(
      { runId, inputFile: null, messageId: null, answers: ['answer'], json: true, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
    expect(parsed.runId).toBe(runId);
    expect(parsed.messageId).toBe('req-123');
    expect(parsed.status).toBe('session_clarification_answered');
    expect(parsed.finalState).toBe('COMPLETED');
  });

  it('outputs text in session path', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    vi.mocked(DefaultStatePersistence).mockImplementation(function (this: {
      load: ReturnType<typeof vi.fn>;
    }) {
      this.load = vi.fn().mockReturnValue(makeSessionState({ runId }));
    } as never);

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId, finalState: 'DONE' }));
    mockSessionEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: null,
        answers: ['my answer'],
        json: false,
        verbose: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('Session clarification answered');
    expect(output).toContain(runId);
    expect(output).toContain('DONE');
  });
});
