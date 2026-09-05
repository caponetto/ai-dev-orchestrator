import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunManifest, RunResult } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resumeOrchestrator } from '../../composition-root';
import { ExitCode } from '../../output/exit-codes';
import type { OutputFormatter } from '../../output/formatter';
import { handleWaitingForHuman } from '../../waiting-for-human';
import { retryCommand } from '../retry';

let mockRunsDir = '';
vi.mock('../../workspace-paths', () => ({
  getRunsDir: () => mockRunsDir,
  getRunDir: (runId: string) => join(mockRunsDir, runId),
  getStatePath: (runDir: string) => join(runDir, 'state.yaml'),
  getJournalPath: (runDir: string) => join(runDir, 'journal.md'),
}));

vi.mock('../../composition-root', () => ({
  resumeOrchestrator: vi.fn(),
}));

vi.mock('../../waiting-for-human', () => ({
  handleWaitingForHuman: vi.fn(),
}));

const mockResumeOrchestrator = vi.mocked(resumeOrchestrator);
const mockHandleWaitingForHuman = vi.mocked(handleWaitingForHuman);

function makeFormatter(): OutputFormatter & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    info: vi.fn((msg: string) => {
      messages.push(`INFO: ${msg}`);
    }),
    error: vi.fn((err: { code: number; message: string; remediation?: string }) => {
      messages.push(`ERROR: ${err.message}`);
      if (err.remediation) {
        messages.push(`REMEDIATION: ${err.remediation}`);
      }
    }),
    success: vi.fn((msg: string) => {
      messages.push(`SUCCESS: ${msg}`);
    }),
    warn: vi.fn((msg: string) => {
      messages.push(`WARN: ${msg}`);
    }),
    summary: vi.fn(),
    startSpinner: vi.fn(),
    clearSpinner: vi.fn(),
    table: vi.fn(),
    json: vi.fn(),
  } as unknown as OutputFormatter & { messages: string[] };
}

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runId: '20260703-120000-abc123',
    finalState: 'DONE',
    artifactInventory: [],
    manifest: {} as unknown as RunManifest,
    ...overrides,
  };
}

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `cli-retry-test-${String(Date.now())}`);
  mkdirSync(testDir, { recursive: true });
  mockRunsDir = join(testDir, '.ai', 'runs');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('retryCommand', () => {
  beforeEach(() => {
    mockResumeOrchestrator.mockReset();
    mockHandleWaitingForHuman.mockReset();
  });

  it('returns GENERAL_ERROR when run directory not found', async () => {
    const formatter = makeFormatter();
    const code = await retryCommand(
      testDir,
      { runId: 'run-nonexistent-000000-abc123', verbose: false, json: false },
      formatter,
    );

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(formatter.messages.some((m) => m.includes('Run directory not found'))).toBe(true);
    expect(formatter.messages.some((m) => m.includes('Check the run ID and try again'))).toBe(true);
  });

  it('returns CONFIGURATION_ERROR when resumeOrchestrator throws', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    mockResumeOrchestrator.mockRejectedValue(new Error('Invalid configuration'));

    const formatter = makeFormatter();
    const code = await retryCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.CONFIGURATION_ERROR);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.error).toHaveBeenCalled();
  });

  it('displays warnings from orchestrator context', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    const retryMock = vi.fn().mockResolvedValue(makeRunResult({ runId }));
    const getStateMock = vi.fn().mockReturnValue({ currentState: 'IMPLEMENTATION' });

    mockResumeOrchestrator.mockResolvedValue({
      engine: { retry: retryMock, getState: getStateMock } as never,
      warnings: ['Warning one', 'Warning two'],
    } as never);

    const formatter = makeFormatter();
    await retryCommand(testDir, { runId, verbose: false, json: false }, formatter);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.warn).toHaveBeenCalledWith('Warning one');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.warn).toHaveBeenCalledWith('Warning two');
    expect(formatter.messages.some((m) => m.includes('WARN: Warning one'))).toBe(true);
    expect(formatter.messages.some((m) => m.includes('WARN: Warning two'))).toBe(true);
  });

  it('returns SUCCESS when result is DONE', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    const retryMock = vi.fn().mockResolvedValue(makeRunResult({ runId, finalState: 'DONE' }));
    const getStateMock = vi.fn().mockReturnValue({ currentState: 'IMPLEMENTATION' });

    mockResumeOrchestrator.mockResolvedValue({
      engine: { retry: retryMock, getState: getStateMock } as never,
      warnings: [],
    } as never);

    const formatter = makeFormatter();
    const code = await retryCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    expect(formatter.messages.some((m) => m.includes('Workflow retried and completed'))).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.summary).toHaveBeenCalledWith({
      'Run ID': runId,
      'Final State': 'DONE',
      Artifacts: 0,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.clearSpinner).toHaveBeenCalled();
  });

  it('returns RUN_ABORTED when result is ABORTED', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    const retryMock = vi.fn().mockResolvedValue(makeRunResult({ runId, finalState: 'ABORTED' }));
    const getStateMock = vi.fn().mockReturnValue({ currentState: 'IMPLEMENTATION' });

    mockResumeOrchestrator.mockResolvedValue({
      engine: { retry: retryMock, getState: getStateMock } as never,
      warnings: [],
    } as never);

    const formatter = makeFormatter();
    const code = await retryCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.RUN_ABORTED);
    expect(formatter.messages.some((m) => m.includes('Workflow was aborted during retry'))).toBe(
      true,
    );
    expect(formatter.messages.some((m) => m.includes('Check the journal for details'))).toBe(true);
  });

  it('returns RUN_FAILED when engine.retry() throws', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    const retryMock = vi.fn().mockRejectedValue(new Error('Agent crashed'));
    const getStateMock = vi.fn().mockReturnValue({ currentState: 'IMPLEMENTATION' });

    mockResumeOrchestrator.mockResolvedValue({
      engine: { retry: retryMock, getState: getStateMock } as never,
      warnings: [],
    } as never);

    const formatter = makeFormatter();
    const code = await retryCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.RUN_FAILED);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.error).toHaveBeenCalled();
  });

  it('returns SUCCESS when result is WAITING_FOR_HUMAN and calls handleWaitingForHuman', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    const runResult = makeRunResult({ runId, finalState: 'WAITING_FOR_HUMAN' });
    const retryMock = vi.fn().mockResolvedValue(runResult);
    const getStateMock = vi.fn().mockReturnValue({ currentState: 'IMPLEMENTATION' });
    const engineMock = { retry: retryMock, getState: getStateMock } as never;

    mockResumeOrchestrator.mockResolvedValue({
      engine: engineMock,
      warnings: [],
    } as never);

    const formatter = makeFormatter();
    const code = await retryCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    expect(mockHandleWaitingForHuman).toHaveBeenCalledWith(runResult, engineMock, runId, formatter);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.clearSpinner).not.toHaveBeenCalled();
  });

  it('returns SUCCESS for other final states (default fallthrough)', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    const retryMock = vi
      .fn()
      .mockResolvedValue(makeRunResult({ runId, finalState: 'IMPLEMENTATION' }));
    const getStateMock = vi.fn().mockReturnValue({ currentState: 'IMPLEMENTATION' });

    mockResumeOrchestrator.mockResolvedValue({
      engine: { retry: retryMock, getState: getStateMock } as never,
      warnings: [],
    } as never);

    const formatter = makeFormatter();
    const code = await retryCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.summary).toHaveBeenCalledWith({
      'Run ID': runId,
      'Final State': 'IMPLEMENTATION',
      Artifacts: 0,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.success).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.clearSpinner).toHaveBeenCalled();
  });
});
