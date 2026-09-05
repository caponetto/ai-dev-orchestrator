import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import type { Mock } from 'vitest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { resumeOrchestrator } from '../../composition-root';
import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getRunDir, getRunsDir } from '../../workspace-paths';
import { permitCommand } from '../permit';

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
    DefaultStatePersistence: vi.fn(),
  };
});

vi.mock('../../composition-root', () => ({
  resumeOrchestrator: vi.fn(),
}));

describe('permitCommand', () => {
  let baseDir: string;
  let stdoutChunks: string[];

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-permit-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, 'runs', runId));
    const runsDir = getRunsDir();
    mkdirSync(runsDir, { recursive: true });
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });

    // Default: no session waiting context (non-session path)
    vi.mocked(DefaultStatePersistence).mockImplementation(
      class {
        load = vi.fn().mockReturnValue(null);
      } as unknown as typeof DefaultStatePersistence,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('returns GENERAL_ERROR when no active run found', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId: null, deny: false, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('reports no pending requests when none exist', async () => {
    const runId = 'run-test-001';
    mkdirSync(getRunDir(runId), { recursive: true });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('No pending permission requests');
  });

  it('approves a pending permission request', async () => {
    const runId = 'run-test-002';
    mkdirSync(getRunDir(runId), { recursive: true });

    const runsDir = getRunsDir();
    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'msg-1',
      kind: 'permission',
      createdAt: new Date().toISOString(),
      payload: { action: 'file_write', resource: 'src/index.ts', riskLevel: 'medium' },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);

    const response = await store.awaitResponse(runId, 'msg-1', 1000);
    expect(response).not.toBeNull();
    expect(response?.payload).toEqual({ granted: true });
  });

  it('denies a pending permission request with --deny', async () => {
    const runId = 'run-test-003';
    mkdirSync(getRunDir(runId), { recursive: true });

    const runsDir = getRunsDir();
    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'msg-2',
      kind: 'permission',
      createdAt: new Date().toISOString(),
      payload: { action: 'shell_execute', resource: 'rm -rf /', riskLevel: 'high' },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: true, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);

    const response = await store.awaitResponse(runId, 'msg-2', 1000);
    expect(response).not.toBeNull();
    expect(response?.payload).toEqual({ granted: false });
  });

  it('targets a specific request by messageId', async () => {
    const runId = 'run-test-004';
    mkdirSync(getRunDir(runId), { recursive: true });

    const runsDir = getRunsDir();
    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'msg-a',
      kind: 'permission',
      createdAt: new Date().toISOString(),
      payload: { action: 'file_write', resource: 'a.ts' },
    });
    await store.writeRequest({
      runId,
      messageId: 'msg-b',
      kind: 'permission',
      createdAt: new Date().toISOString(),
      payload: { action: 'file_write', resource: 'b.ts' },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: 'msg-b', json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);

    const responseA = await store.awaitResponse(runId, 'msg-a', 100);
    expect(responseA).toBeNull();

    const responseB = await store.awaitResponse(runId, 'msg-b', 1000);
    expect(responseB).not.toBeNull();
    expect(responseB?.payload).toEqual({ granted: true });
  });

  it('produces JSON output', async () => {
    const runId = 'run-test-005';
    mkdirSync(getRunDir(runId), { recursive: true });

    const runsDir = getRunsDir();
    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'msg-json',
      kind: 'permission',
      createdAt: new Date().toISOString(),
      payload: { action: 'file_write', resource: 'test.ts' },
    });

    const formatter = new OutputFormatter({ json: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: null, json: true, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as { action: string; messageId: string };
    expect(parsed.action).toBe('granted');
    expect(parsed.messageId).toBe('msg-json');
  });

  it('returns GENERAL_ERROR when run directory does not exist', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId: 'run-nonexistent', deny: false, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
    const output = stdoutChunks.join('');
    expect(output).toContain('Run directory not found');
  });

  it('returns GENERAL_ERROR when messageId does not match any pending request', async () => {
    const runId = 'run-test-006';
    mkdirSync(getRunDir(runId), { recursive: true });

    const runsDir = getRunsDir();
    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'msg-x',
      kind: 'permission',
      createdAt: new Date().toISOString(),
      payload: { action: 'file_write', resource: 'src/index.ts' },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: 'msg-nonexistent', json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
    const output = stdoutChunks.join('');
    expect(output).toContain('No pending permission request with message ID');
    expect(output).toContain('msg-nonexistent');
  });

  it('displays the action field as detail when it is a string', async () => {
    const runId = 'run-test-007';
    mkdirSync(getRunDir(runId), { recursive: true });

    const runsDir = getRunsDir();
    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'msg-action',
      kind: 'permission',
      createdAt: new Date().toISOString(),
      payload: { action: 'file_write', resource: 'src/index.ts' },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('file_write');
  });

  it('uses fallback detail when action field is not a string', async () => {
    const runId = 'run-test-008';
    mkdirSync(getRunDir(runId), { recursive: true });

    const runsDir = getRunsDir();
    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'msg-no-action',
      kind: 'permission',
      createdAt: new Date().toISOString(),
      payload: { resource: 'src/index.ts' },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('permission request');
  });

  it('produces denied JSON output with --deny', async () => {
    const runId = 'run-test-009';
    mkdirSync(getRunDir(runId), { recursive: true });

    const runsDir = getRunsDir();
    const store = new FileBackedLiveRequestStore(runsDir);
    await store.writeRequest({
      runId,
      messageId: 'msg-deny-json',
      kind: 'permission',
      createdAt: new Date().toISOString(),
      payload: { action: 'shell_execute', resource: 'dangerous-cmd' },
    });

    const formatter = new OutputFormatter({ json: true });
    const code = await permitCommand(
      { runId, deny: true, messageId: null, json: true, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as { action: string; messageId: string };
    expect(parsed.action).toBe('denied');
    expect(parsed.messageId).toBe('msg-deny-json');
  });

  // --- Session supervisor path tests ---

  function mockSessionState(overrides: {
    liveSessionId?: string;
    liveRequestType?: string;
    pendingRequestId?: string;
  }): void {
    const state: Partial<PersistedState> = {
      waitingContext: {
        liveSessionId: overrides.liveSessionId ?? 'session-1',
        liveRequestType: overrides.liveRequestType ?? 'permission',
        ...('pendingRequestId' in overrides
          ? { pendingRequestId: overrides.pendingRequestId }
          : { pendingRequestId: 'req-1' }),
      },
    } as Partial<PersistedState>;

    vi.mocked(DefaultStatePersistence).mockImplementation(
      class {
        load = vi.fn().mockReturnValue(state);
      } as unknown as typeof DefaultStatePersistence,
    );
  }

  it('returns GENERAL_ERROR when messageId does not match session pending request', async () => {
    const runId = 'run-test-session-mismatch';
    mkdirSync(getRunDir(runId), { recursive: true });

    mockSessionState({ pendingRequestId: 'req-session-1' });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: 'msg-wrong', json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
    const output = stdoutChunks.join('');
    expect(output).toContain('No pending permission request with message ID: msg-wrong');
    expect(output).toContain('Session has pending request: req-session-1');
  });

  it('returns GENERAL_ERROR with generic remediation when session has no pendingRequestId', async () => {
    const runId = 'run-test-session-no-pending';
    mkdirSync(getRunDir(runId), { recursive: true });

    mockSessionState({ pendingRequestId: undefined });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: 'msg-wrong', json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
    const output = stdoutChunks.join('');
    expect(output).toContain('Run `ai status` to see pending requests');
  });

  it('returns CONFIGURATION_ERROR when resumeOrchestrator throws', async () => {
    const runId = 'run-test-session-resume-fail';
    mkdirSync(getRunDir(runId), { recursive: true });

    mockSessionState({});
    (resumeOrchestrator as Mock).mockRejectedValue(new Error('Config not found'));

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.CONFIGURATION_ERROR);
    const output = stdoutChunks.join('');
    expect(output).toContain('Config not found');
  });

  it('outputs warnings from the resumed context', async () => {
    const runId = 'run-test-session-warnings';
    mkdirSync(getRunDir(runId), { recursive: true });

    mockSessionState({});
    (resumeOrchestrator as Mock).mockResolvedValue({
      warnings: ['Warning: token budget exceeded', 'Warning: model fallback used'],
      engine: {
        resume: vi.fn().mockResolvedValue({ finalState: 'completed' }),
      },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('Warning: token budget exceeded');
    expect(output).toContain('Warning: model fallback used');
  });

  it('returns RUN_FAILED when engine.resume throws', async () => {
    const runId = 'run-test-session-engine-fail';
    mkdirSync(getRunDir(runId), { recursive: true });

    mockSessionState({});
    (resumeOrchestrator as Mock).mockResolvedValue({
      warnings: [],
      engine: {
        resume: vi.fn().mockRejectedValue(new Error('Agent crashed')),
      },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.RUN_FAILED);
    const output = stdoutChunks.join('');
    expect(output).toContain('Agent crashed');
  });

  it('produces JSON output in session path', async () => {
    const runId = 'run-test-session-json';
    mkdirSync(getRunDir(runId), { recursive: true });

    mockSessionState({ pendingRequestId: 'req-json-1' });
    (resumeOrchestrator as Mock).mockResolvedValue({
      warnings: [],
      engine: {
        resume: vi.fn().mockResolvedValue({ finalState: 'completed' }),
      },
    });

    const formatter = new OutputFormatter({ json: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: null, json: true, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as {
      action: string;
      messageId: string;
      finalState: string;
    };
    expect(parsed.action).toBe('granted');
    expect(parsed.messageId).toBe('req-json-1');
    expect(parsed.finalState).toBe('completed');
  });

  it('produces non-JSON success output in session path', async () => {
    const runId = 'run-test-session-text';
    mkdirSync(getRunDir(runId), { recursive: true });

    mockSessionState({ pendingRequestId: 'req-text-1' });
    (resumeOrchestrator as Mock).mockResolvedValue({
      warnings: [],
      engine: {
        resume: vi.fn().mockResolvedValue({ finalState: 'completed' }),
      },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: false, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('Approved session permission');
    expect(output).toContain('req-text-1');
    expect(output).toContain('completed');
  });

  it('produces denied output in session path', async () => {
    const runId = 'run-test-session-deny';
    mkdirSync(getRunDir(runId), { recursive: true });

    mockSessionState({ pendingRequestId: 'req-deny-1' });
    (resumeOrchestrator as Mock).mockResolvedValue({
      warnings: [],
      engine: {
        resume: vi.fn().mockResolvedValue({ finalState: 'blocked' }),
      },
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = await permitCommand(
      { runId, deny: true, messageId: null, json: false, verbose: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('Denied session permission');
    expect(output).toContain('req-deny-1');
  });
});
