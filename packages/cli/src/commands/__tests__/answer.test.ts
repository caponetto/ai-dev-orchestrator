import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { createRunId } from '@ai-dev-orchestrator/ports';
import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import type { PersistedState, RunManifest, RunResult } from '@ai-dev-orchestrator/schemas';
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

vi.mock('@ai-dev-orchestrator/core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    DefaultStatePersistence: vi.fn().mockImplementation(function (this: {
      load: ReturnType<typeof vi.fn>;
    }) {
      this.load = vi.fn().mockReturnValue({
        currentState: 'WAITING_FOR_HUMAN',
        waitingContext: {
          requiredInput: 'text',
          requestingState: 'REFINEMENT',
          waitingSince: 'wait-1',
        },
      });
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
    answerAccepted: true,
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

  it.each([true, false])(
    'does not report the previous answer file as a newly accepted answer (JSON: %s)',
    async (json) => {
      const runId = createRunId();
      const dir = join(getRunDir(runId), 'artifacts');
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'clarification_answers_v1.md');
      writeFileSync(path, 'previous');
      mockEngineContext(
        runId,
        getRunDir(runId),
        vi
          .fn()
          .mockResolvedValue(
            makeRunResult({ runId, finalState: 'WAITING_FOR_HUMAN', answerAccepted: false }),
          ),
      );
      expect(
        await answerCommand(
          {
            runId,
            inputFile: null,
            messageId: null,
            answers: ['pending answer'],
            json,
            verbose: false,
          },
          new OutputFormatter({ json }),
        ),
      ).toBe(ExitCode.SUCCESS);
      expect(readFileSync(path, 'utf8')).toBe('previous');
      if (json) {
        const output = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
        expect(output.accepted).toBe(false);
        expect(output).not.toHaveProperty('artifactPath');
      } else {
        expect(stdoutChunks.join('')).toContain('Answer not accepted');
      }
    },
  );

  it('preserves an accepted answer when bootstrap fails before run ownership', async () => {
    const runId = createRunId();
    const dir = join(getRunDir(runId), 'artifacts');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'clarification_answers_v1.md');
    writeFileSync(path, 'accepted answer');
    mockResumeOrchestrator.mockRejectedValueOnce(new Error('bootstrap failed'));
    const code = await answerCommand(
      {
        runId,
        inputFile: null,
        messageId: null,
        answers: ['losing answer'],
        json: false,
        verbose: false,
      },
      new OutputFormatter(),
    );
    expect(code).toBe(ExitCode.CONFIGURATION_ERROR);
    expect(readFileSync(path, 'utf8')).toBe('accepted answer');
  });
  it.each(['positional', 'file'])(
    'rejects blank %s input before bootstrap or artifact mutation',
    async (mode) => {
      const runId = createRunId();
      mkdirSync(getRunDir(runId), { recursive: true });
      const file = join(getRunDir(runId), 'empty.txt');
      writeFileSync(file, '  ');
      expect(
        await answerCommand(
          {
            runId,
            inputFile: mode === 'file' ? file : null,
            messageId: null,
            answers: ['  '],
            json: true,
            verbose: false,
          },
          new OutputFormatter({ json: true }),
        ),
      ).toBe(ExitCode.INVALID_ARGUMENTS);
      expect(mockResumeOrchestrator).not.toHaveBeenCalled();
      expect(existsSync(join(getRunDir(runId), 'artifacts'))).toBe(false);
    },
  );

  it.each([null, { requiredInput: 'approval' }, { requiredInput: 'text', liveSessionId: 'live' }])(
    'rejects a missing or incompatible text wait without changing an old answer (%s)',
    async (waitingContext) => {
      const runId = createRunId();
      const dir = join(getRunDir(runId), 'artifacts');
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'clarification_answers_v1.md');
      writeFileSync(path, 'previous');
      vi.mocked(DefaultStatePersistence).mockImplementationOnce(function (this: {
        load: ReturnType<typeof vi.fn>;
      }) {
        this.load = vi.fn().mockReturnValue({ currentState: 'WAIT', waitingContext });
      } as never);
      const resume = vi.fn();
      mockEngineContext(runId, getRunDir(runId), resume);
      expect(
        await answerCommand(
          {
            runId,
            inputFile: null,
            messageId: null,
            answers: ['replacement'],
            json: false,
            verbose: false,
          },
          new OutputFormatter(),
        ),
      ).toBe(ExitCode.INVALID_ARGUMENTS);
      expect(resume).not.toHaveBeenCalled();
      expect(readFileSync(path, 'utf8')).toBe('previous');
    },
  );
  it('refuses to replace an answer already committed in an interrupted transition', async () => {
    const runId = createRunId();
    mkdirSync(getRunDir(runId), { recursive: true });
    vi.mocked(DefaultStatePersistence).mockImplementationOnce(function (this: {
      load: ReturnType<typeof vi.fn>;
    }) {
      this.load = vi.fn().mockReturnValue({
        currentState: 'WAIT',
        entryActionContinuation: {
          resumeInput: { type: 'text', content: 'accepted' },
          resumeWaitingContext: {
            requiredInput: 'text',
            requestingState: 'WORK',
            waitingSince: 'wait-1',
          },
        },
      });
    } as never);
    const resume = vi.fn();
    mockEngineContext(runId, getRunDir(runId), resume);
    expect(
      await answerCommand(
        {
          runId,
          inputFile: null,
          messageId: null,
          answers: ['replacement'],
          json: true,
          verbose: false,
        },
        new OutputFormatter({ json: true }),
      ),
    ).toBe(ExitCode.INVALID_ARGUMENTS);
    expect(resume).not.toHaveBeenCalled();
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
    expect(mockResume).toHaveBeenCalledWith({
      type: 'text',
      content: 'Yes, use OAuth2',
      waitIdentity: {
        stateId: 'WAITING_FOR_HUMAN',
        requestingState: 'REFINEMENT',
        waitingSince: 'wait-1',
      },
    });
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

    expect(mockResume).toHaveBeenCalledWith({
      type: 'text',
      content: 'first\nsecond',
      waitIdentity: {
        stateId: 'WAITING_FOR_HUMAN',
        requestingState: 'REFINEMENT',
        waitingSince: 'wait-1',
      },
    });
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
    expect(mockResume).toHaveBeenCalledWith({
      type: 'text',
      content: 'Answer 1\nAnswer 2',
      waitIdentity: {
        stateId: 'WAITING_FOR_HUMAN',
        requestingState: 'REFINEMENT',
        waitingSince: 'wait-1',
      },
    });
  });

  it('delegates answer persistence to the owned engine instead of writing before resume', async () => {
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
    expect(existsSync(artifactPath)).toBe(false);
    expect(mockResume).toHaveBeenCalledOnce();
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
    expect(mockResume).toHaveBeenCalledWith({
      type: 'text',
      content: 'React',
      waitIdentity: {
        stateId: 'WAITING_FOR_HUMAN',
        requestingState: 'REFINEMENT',
        waitingSince: 'wait-1',
      },
    });
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
    expect(parsed.outcome).toBe('response_written');
    expect(parsed.exitCode).toBe(ExitCode.SUCCESS);
    expect(parsed).not.toHaveProperty('finalState');
    expect(mockResumeOrchestrator).not.toHaveBeenCalled();
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
    expect(mockResume).toHaveBeenCalledWith({
      type: 'text',
      content: 'Use Redis',
      sessionId: 'session-abc',
      requestId: 'req-123',
    });
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
