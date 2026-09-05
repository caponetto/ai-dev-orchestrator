import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRunId } from '@ai-dev-orchestrator/ports';
import type { RunManifest, RunResult } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { resumeOrchestrator } from '../../composition-root';
import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getRunDir, getRunsDir } from '../../workspace-paths';
import { approveCommand } from '../approve';

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

vi.mock('../../composition-root', () => ({
  resumeOrchestrator: vi.fn(),
}));

const mockResumeOrchestrator = vi.mocked(resumeOrchestrator);

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runId: 'run-001',
    finalState: 'DONE',
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

describe('approveCommand', () => {
  let baseDir: string;
  let stdoutChunks: string[];

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-approve-${String(Date.now())}`);
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
    const code = await approveCommand(
      { runId: null, reject: false, message: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('returns GENERAL_ERROR when run directory does not exist', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await approveCommand(
      {
        runId: 'run-nonexistent-000000-abc123',
        reject: false,
        message: null,
        json: false,
        verbose: false,
      },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('approves a run via the engine', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId, finalState: 'DONE' }));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await approveCommand(
      { runId, reject: false, message: null, json: false, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    expect(mockResume).toHaveBeenCalledWith({ type: 'approval', content: 'Approved via CLI' });
  });

  it('rejects a run with --reject flag', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId, finalState: 'ABORTED' }));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await approveCommand(
      { runId, reject: true, message: 'Not ready', json: false, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.RUN_ABORTED);
    expect(mockResume).toHaveBeenCalledWith({ type: 'rejection', content: 'Not ready' });
  });

  it('passes custom message to engine', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const mockResume = vi.fn().mockResolvedValue(makeRunResult({ runId }));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ noColor: true });
    await approveCommand(
      { runId, reject: false, message: 'LGTM with minor changes', json: false, verbose: false },
      formatter,
    );

    expect(mockResume).toHaveBeenCalledWith({
      type: 'approval',
      content: 'LGTM with minor changes',
    });
  });

  it('produces valid JSON output', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const mockResume = vi
      .fn()
      .mockResolvedValue(makeRunResult({ runId, finalState: 'DONE', artifactInventory: [] }));
    mockEngineContext(runId, runDir, mockResume);

    const formatter = new OutputFormatter({ json: true });
    const code = await approveCommand(
      { runId, reject: false, message: null, json: true, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
    expect(parsed.runId).toBe(runId);
    expect(parsed.status).toBe('approval');
    expect(parsed.finalState).toBe('DONE');
    expect(parsed.artifacts).toBe(0);
  });

  it('returns CONFIGURATION_ERROR when resumeOrchestrator fails', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    mockResumeOrchestrator.mockImplementation(() => {
      throw new Error('Configuration invalid');
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await approveCommand(
      { runId, reject: false, message: null, json: false, verbose: false },
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
    const code = await approveCommand(
      { runId, reject: false, message: null, json: false, verbose: false },
      formatter,
    );

    expect(code).toBe(ExitCode.RUN_FAILED);
  });
});
