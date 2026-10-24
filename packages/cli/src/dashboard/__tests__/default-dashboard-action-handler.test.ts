import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { projectWorkflowPreview } from '@ai-dev-orchestrator/dashboard-server';
import type { AgentSessionSupervisor, AgentStreamBus } from '@ai-dev-orchestrator/ports';
import type { RunId } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadAllWorkflows,
  loadWorkflowByName,
  preflightSelectedModels,
} from '../../composition-root';
import { getRunDir, getRunsDir } from '../../workspace-paths';
import { DefaultDashboardActionHandler } from '../default-dashboard-action-handler';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  const { EventEmitter } = await import('node:events');
  return {
    ...(actual as object),
    spawn: vi.fn().mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    rmSync: vi.fn((actual as Record<string, unknown>).rmSync as (...args: unknown[]) => void),
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

vi.mock('../../composition-root', () => ({
  loadWorkflowByName: vi.fn(),
  loadAllWorkflows: vi.fn(),
  preflightSelectedModels: vi.fn().mockResolvedValue({ warnings: [], receipt: 'checked' }),
}));

vi.mock('@ai-dev-orchestrator/dashboard-server', () => ({
  projectWorkflowPreview: vi.fn(),
}));

function makeSupervisor(overrides?: Partial<AgentSessionSupervisor>): AgentSessionSupervisor {
  return {
    createSession: vi.fn().mockResolvedValue(null),
    attach: vi.fn().mockResolvedValue(null),
    sendHumanResponse: vi.fn().mockResolvedValue(false),
    waitForAdvance: vi.fn().mockResolvedValue({ kind: 'completed', durationMs: 0 }),
    pause: vi.fn().mockResolvedValue(true),
    abort: vi.fn().mockResolvedValue(true),
    finalize: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockResolvedValue(null),
    getState: vi.fn().mockReturnValue(null),
    listByRun: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeStreamBus(): AgentStreamBus {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
    getClientCount: vi.fn().mockReturnValue(0),
  };
}

describe('DefaultDashboardActionHandler', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'dash-action-'));
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, 'runs', runId));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  async function seedRunState(runId: string, state: Record<string, unknown>): Promise<void> {
    const runsDir = getRunsDir();
    const persistence = new DefaultStatePersistence(runsDir);
    await persistence.save({
      runId,
      schemaVersion: 1,
      workflowName: 'test',
      workflowVersion: '1.0.0',
      currentState: 'WAITING_FOR_HUMAN',
      previousState: 'IMPL',
      stateEnteredAt: new Date().toISOString(),
      transitionCount: 1,
      stateHistory: ['IMPL', 'WAITING_FOR_HUMAN'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      persistedAt: new Date().toISOString(),
      persistenceVersion: 1,
      checksum: 'test',
      ...state,
    } as unknown as Parameters<typeof persistence.save>[0]);
  }

  it('waits for child spawn before acknowledging retry or publishing its request', async () => {
    await seedRunState('spawn-stage', { currentState: 'FAILED', previousState: 'WORK' });
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
    const bus = makeStreamBus();
    const publish = vi.spyOn(bus, 'publish');
    const handler = new DefaultDashboardActionHandler(undefined, bus);
    let settled = false;
    const pending = handler.retry('spawn-stage').then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(child.unref).not.toHaveBeenCalled();
    child.emit('spawn');
    expect(await pending).toMatchObject({ success: true, outcome: 'started' });
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('reports asynchronous spawn failure without publishing a retry and permits another attempt', async () => {
    await seedRunState('async-failure', { currentState: 'FAILED', previousState: 'WORK' });
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
    const bus = makeStreamBus();
    const publish = vi.spyOn(bus, 'publish');
    const handler = new DefaultDashboardActionHandler(undefined, bus);
    const pending = handler.retry('async-failure');
    child.emit('error', new Error('asynchronous launch failure'));
    expect(await pending).toEqual({ success: false, error: 'asynchronous launch failure' });
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        structuredData: { action: 'request_failed', error: 'asynchronous launch failure' },
        stateId: 'FAILED',
      }),
    );
    expect(await handler.retry('async-failure')).toMatchObject({
      success: true,
      outcome: 'started',
    });
  });

  it('coalesces duplicate retry clicks while launch is pending and clears the pending entry', async () => {
    await seedRunState('duplicates', { currentState: 'FAILED', previousState: 'WORK' });
    vi.mocked(spawn).mockClear();
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
    const handler = new DefaultDashboardActionHandler();
    const a = handler.retry('duplicates');
    const b = handler.retry('duplicates');
    expect(spawn).toHaveBeenCalledOnce();
    child.emit('spawn');
    expect(await a).toEqual(await b);
    expect(await handler.retry('duplicates')).toMatchObject({ success: true, outcome: 'started' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('rejects a conflicting control while another launch for the same run is pending', async () => {
    await seedRunState('conflicting', {});
    vi.mocked(spawn).mockClear();
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
    const handler = new DefaultDashboardActionHandler();
    const first = handler.approve('conflicting', {});
    await Promise.resolve();
    expect(await handler.reject('conflicting', {})).toMatchObject({
      success: false,
      error: expect.stringContaining('already starting') as unknown,
    });
    child.emit('spawn');
    expect(await first).toMatchObject({ success: true, outcome: 'started' });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it.each(['launch', 'abort'])(
    'keeps a successful %s outcome when stream notification fails',
    async (action) => {
      await seedRunState('notify-fails', {
        currentState: action === 'launch' ? 'FAILED' : 'WAITING_FOR_HUMAN',
        previousState: 'WORK',
      });
      const bus = makeStreamBus();
      const publish = vi.spyOn(bus, 'publish');
      publish.mockImplementation(() => {
        throw new Error('stream unavailable');
      });
      const handler = new DefaultDashboardActionHandler(undefined, bus);
      const result =
        action === 'launch'
          ? await handler.retry('notify-fails')
          : await handler.abort('notify-fails', {});
      expect(result).toMatchObject({
        success: true,
        outcome: action === 'launch' ? 'started' : 'aborted',
      });
    },
  );

  it('does not publish an abort when checkpoint persistence fails', async () => {
    await seedRunState('abort-save-fails', {});
    const save = vi
      .spyOn(DefaultStatePersistence.prototype, 'save')
      .mockRejectedValue(new Error('save unavailable'));
    try {
      const bus = makeStreamBus();
      const publish = vi.spyOn(bus, 'publish');
      expect(
        await new DefaultDashboardActionHandler(undefined, bus).abort('abort-save-fails', {}),
      ).toEqual({ success: false, error: 'save unavailable' });
      expect(publish).not.toHaveBeenCalled();
    } finally {
      save.mockRestore();
    }
  });

  it.each(['approve', 'reject', 'answer'])(
    'rejects a stale %s request after the run has completed',
    async (action) => {
      await seedRunState('stale-control', { currentState: 'DONE' });
      vi.mocked(spawn).mockClear();
      const handler = new DefaultDashboardActionHandler();
      const result =
        action === 'answer'
          ? await handler.answer('stale-control', { content: 'text' })
          : action === 'approve'
            ? await handler.approve('stale-control', {})
            : await handler.reject('stale-control', {});
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('terminal state') as unknown,
      });
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each([new Error('read unavailable'), 'read unavailable'])(
    'reports state inspection failure without launching: %s',
    async (failure) => {
      await seedRunState('read-fails', {});
      vi.mocked(spawn).mockClear();
      const load = vi.spyOn(DefaultStatePersistence.prototype, 'load').mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise non-Error persistence failures.
        throw failure;
      });
      try {
        expect(await new DefaultDashboardActionHandler().approve('read-fails', {})).toEqual({
          success: false,
          error: 'read unavailable',
        });
        expect(spawn).not.toHaveBeenCalled();
      } finally {
        load.mockRestore();
      }
    },
  );

  it.each(['new-session', undefined])(
    'rechecks session identity after owner release (%s)',
    async (liveSessionId) => {
      await seedRunState('session-moved', { waitingContext: { liveSessionId: 'old-session' } });
      vi.mocked(spawn).mockClear();
      const store = new DefaultStatePersistence(getRunsDir());
      const state = store.load('session-moved' as RunId);
      if (!state) {
        throw new Error('missing state');
      }
      const waitingContext = state.waitingContext;
      if (!waitingContext) {
        throw new Error('missing waiting context');
      }
      let reads = 0;
      const load = vi.spyOn(DefaultStatePersistence.prototype, 'load').mockImplementation(() => {
        if (reads++ === 0) {
          return state;
        }
        return {
          ...state,
          waitingContext: liveSessionId ? { ...waitingContext, liveSessionId } : undefined,
        };
      });
      try {
        expect(
          await new DefaultDashboardActionHandler().approve('session-moved', {
            sessionId: 'old-session',
          }),
        ).toMatchObject({
          success: false,
          error: expect.stringContaining('Session ID mismatch') as unknown,
        });
        expect(spawn).not.toHaveBeenCalled();
      } finally {
        load.mockRestore();
      }
    },
  );

  it('reports completion winning an abort race without publishing an aborted event', async () => {
    const runId = 'completion-wins';
    await seedRunState(runId, { currentState: 'DONE' });
    const path = join(getRunDir(runId), 'state.yaml');
    const done = readFileSync(path, 'utf8');
    await seedRunState(runId, { currentState: 'WAITING_FOR_HUMAN' });
    const store = new DefaultStatePersistence(getRunsDir());
    const acquire = store.acquireLock.bind(store);
    const lock = vi
      .spyOn(DefaultStatePersistence.prototype, 'acquireLock')
      .mockImplementation((id) => {
        writeFileSync(path, done);
        return acquire(id);
      });
    try {
      const bus = makeStreamBus();
      const publish = vi.spyOn(bus, 'publish');
      expect(
        await new DefaultDashboardActionHandler(undefined, bus).abort(runId, {}),
      ).toMatchObject({
        success: true,
        outcome: 'already_terminal',
        finalState: 'DONE',
      });
      expect(publish).not.toHaveBeenCalled();
    } finally {
      lock.mockRestore();
    }
  });

  it('aborts pending terminal cleanup instead of announcing an already-finished run', async () => {
    await seedRunState('pending-abort', {
      currentState: 'DONE',
      pendingTerminalState: 'DONE',
      terminalRecoveryState: 'WORK',
    });
    expect(await new DefaultDashboardActionHandler().abort('pending-abort', {})).toMatchObject({
      success: true,
      outcome: 'aborted',
      finalState: 'ABORTED',
    });
  });

  it('abort calls supervisor.abort with liveSessionId from state', async () => {
    const abortMock = vi.fn().mockResolvedValue(true);
    const supervisor = makeSupervisor({ abort: abortMock });
    const handler = new DefaultDashboardActionHandler(supervisor);

    await seedRunState('run-1', {
      waitingContext: {
        liveSessionId: 'sess-42',
        pendingRequestId: 'req-1',
        sessionTransport: 'stdio',
      },
    });

    const result = await handler.abort('run-1', {});
    expect(result.success).toBe(true);
    expect(abortMock).toHaveBeenCalledWith('sess-42', 'Aborted via dashboard');
  });

  it('does not cancel a session when the abort request loses run ownership', async () => {
    await seedRunState('run-losing-abort', { waitingContext: { liveSessionId: 'session' } });
    const abort = vi.fn().mockResolvedValue(true);
    const acquire = vi
      .spyOn(DefaultStatePersistence.prototype, 'acquireLock')
      .mockImplementation(() => {
        throw new Error('owned elsewhere');
      });
    try {
      const result = await new DefaultDashboardActionHandler(makeSupervisor({ abort })).abort(
        'run-losing-abort',
        {},
      );
      expect(result).toEqual({ success: false, error: 'owned elsewhere' });
      expect(abort).not.toHaveBeenCalled();
    } finally {
      acquire.mockRestore();
    }
  });

  it('rejects a stale session abort before signalling the current run process', async () => {
    const abort = vi.fn().mockResolvedValue(true);
    const supervisor = makeSupervisor({ abort });
    const streamBus = makeStreamBus();
    const publish = vi.spyOn(streamBus, 'publish');
    const handler = new DefaultDashboardActionHandler(supervisor, streamBus);
    await seedRunState('run-stale-abort', {
      waitingContext: { liveSessionId: 'current-session' },
    });
    const lockPath = join(getRunDir('run-stale-abort'), 'run.lock');
    const lockContent = JSON.stringify({ pid: 424242, hostname: hostname() });
    writeFileSync(lockPath, lockContent);
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    try {
      const result = await handler.abort('run-stale-abort', { sessionId: 'stale-session' });

      expect(result).toEqual({
        success: false,
        error: 'Session ID mismatch: expected current-session, got stale-session',
      });
      expect(kill).not.toHaveBeenCalled();
      expect(abort).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(
        new DefaultStatePersistence(getRunsDir()).load('run-stale-abort' as RunId),
      ).toMatchObject({ currentState: 'WAITING_FOR_HUMAN' });
    } finally {
      kill.mockRestore();
    }
  });

  it('abort calls supervisor.abort with explicit sessionId', async () => {
    const abortMock = vi.fn().mockResolvedValue(true);
    const supervisor = makeSupervisor({ abort: abortMock });
    const handler = new DefaultDashboardActionHandler(supervisor);

    await seedRunState('run-1', {
      waitingContext: {
        liveSessionId: 'sess-42',
        pendingRequestId: 'req-1',
        sessionTransport: 'stdio',
      },
    });

    const result = await handler.abort('run-1', { sessionId: 'sess-42' });
    expect(result.success).toBe(true);
    expect(abortMock).toHaveBeenCalledWith('sess-42', 'Aborted via dashboard');
  });

  it('abort without supervisor still persists ABORTED state', async () => {
    const handler = new DefaultDashboardActionHandler();

    await seedRunState('run-1', {
      waitingContext: {
        liveSessionId: 'sess-42',
        pendingRequestId: 'req-1',
        sessionTransport: 'stdio',
      },
    });

    const result = await handler.abort('run-1', {});
    expect(result.success).toBe(true);

    const runsDir = getRunsDir();
    const persistence = new DefaultStatePersistence(runsDir);
    const state = persistence.load('run-1' as RunId);
    expect(state?.currentState).toBe('ABORTED');
  });

  it('abort tolerates supervisor.abort failure gracefully', async () => {
    const abortMock = vi.fn().mockRejectedValue(new Error('session already dead'));
    const supervisor = makeSupervisor({ abort: abortMock });
    const handler = new DefaultDashboardActionHandler(supervisor);

    await seedRunState('run-1', {
      waitingContext: {
        liveSessionId: 'sess-42',
        pendingRequestId: 'req-1',
        sessionTransport: 'stdio',
      },
    });

    const result = await handler.abort('run-1', {});
    expect(result.success).toBe(true);
    expect(abortMock).toHaveBeenCalledWith('sess-42', 'Aborted via dashboard');

    const runsDir = getRunsDir();
    const persistence = new DefaultStatePersistence(runsDir);
    const state = persistence.load('run-1' as RunId);
    expect(state?.currentState).toBe('ABORTED');
  });

  it('abort rejects mismatched sessionId', async () => {
    const abortMock = vi.fn().mockResolvedValue(true);
    const supervisor = makeSupervisor({ abort: abortMock });
    const handler = new DefaultDashboardActionHandler(supervisor);

    await seedRunState('run-1', {
      waitingContext: {
        liveSessionId: 'sess-42',
        pendingRequestId: 'req-1',
        sessionTransport: 'stdio',
      },
    });

    const result = await handler.abort('run-1', { sessionId: 'sess-wrong' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('mismatch');
    expect(abortMock).not.toHaveBeenCalled();
  });

  describe('retry', () => {
    it('leaves a failed checkpoint intact when the retry process cannot be started', async () => {
      await seedRunState('run-spawn-failure', {
        currentState: 'FAILED',
        previousState: 'IMPLEMENTATION',
      });
      const persistence = new DefaultStatePersistence(getRunsDir());
      const original = persistence.load('run-spawn-failure' as RunId);
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('cannot start retry process');
      });

      const result = await new DefaultDashboardActionHandler().retry('run-spawn-failure');

      expect(result).toEqual({ success: false, error: 'cannot start retry process' });
      expect(persistence.load('run-spawn-failure' as RunId)).toEqual(original);
    });

    it('rejects retry of a completed success without changing its checkpoint', async () => {
      await seedRunState('run-completed', { currentState: 'DONE', previousState: 'WRAP_UP' });
      const result = await new DefaultDashboardActionHandler().retry('run-completed');
      expect(result.success).toBe(false);
      expect(result.error).toContain('completed');
      expect(
        new DefaultStatePersistence(getRunsDir()).load('run-completed' as RunId)?.currentState,
      ).toBe('DONE');
    });

    it('rejects retry while unfinished terminal cleanup has a live owner', async () => {
      await seedRunState('run-owned-cleanup', {
        currentState: 'WRAP_UP',
        previousState: 'WRAP_UP',
        pendingTerminalState: 'DONE',
      });
      const persistence = new DefaultStatePersistence(getRunsDir());
      const lock = persistence.acquireLock('run-owned-cleanup' as RunId);
      const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
      try {
        const result = await new DefaultDashboardActionHandler().retry('run-owned-cleanup');
        expect(result.success).toBe(false);
        expect(result.error).toContain('active');
        expect(kill).not.toHaveBeenCalledWith(-process.pid, 'SIGTERM');
        expect(existsSync(lock.lockPath)).toBe(true);
      } finally {
        kill.mockRestore();
        persistence.releaseLock(lock);
      }
    });

    it('returns error when run directory does not exist', async () => {
      const handler = new DefaultDashboardActionHandler();
      const result = await handler.retry('nonexistent-run');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('retries pending terminal cleanup without rewinding the source state or clearing its cursor', async () => {
      await seedRunState('run-pending', {
        currentState: 'WRAP_UP',
        previousState: 'WRAP_UP',
        pendingTerminalState: 'DONE',
        terminalRecoveryState: 'WRAP_UP',
        entryActionContinuation: {
          stateId: 'DONE',
          nextActionIndex: 1,
          completedResults: [
            {
              action: { type: 'notify_human', params: { reason: 'completed first action' } },
              success: true,
            },
          ],
        },
      });
      const result = await new DefaultDashboardActionHandler().retry('run-pending');
      expect(result.success).toBe(true);
      const saved = new DefaultStatePersistence(getRunsDir()).load('run-pending' as RunId);
      expect(saved?.currentState).toBe('WRAP_UP');
      expect(saved?.pendingTerminalState).toBe('DONE');
      expect(saved?.entryActionContinuation?.nextActionIndex).toBe(1);
    });

    it('returns error when run is not in a terminal state', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-1', {
        currentState: 'IMPLEMENTATION',
        previousState: 'PLANNING',
      });

      const result = await handler.retry('run-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not in a terminal state');
    });

    it('returns error when previousState is null', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-1', {
        currentState: 'ABORTED',
        previousState: null,
      });

      const result = await handler.retry('run-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('no previous state');
    });

    it('returns error when previousState is also terminal', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-1', {
        currentState: 'ABORTED',
        previousState: 'DONE',
        stateHistory: ['DONE', 'ABORTED'],
      });

      const result = await handler.retry('run-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('terminal state');
    });

    it('spawns retry without rewriting an aborted checkpoint before the child owns its lock', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-1', {
        currentState: 'ABORTED',
        previousState: 'IMPLEMENTATION',
        stateHistory: ['INTAKE', 'IMPLEMENTATION', 'ABORTED'],
      });

      const result = await handler.retry('run-1');
      expect(result.success).toBe(true);

      const runsDir = getRunsDir();
      const persistence = new DefaultStatePersistence(runsDir);
      const state = persistence.load('run-1' as RunId);
      expect(state?.currentState).toBe('ABORTED');
    });

    it('preserves a FAILED checkpoint for the engine to retry under its lock', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-1', {
        currentState: 'FAILED',
        previousState: 'CODE_REVIEW',
        stateHistory: ['CODE_REVIEW', 'FAILED'],
      });

      const result = await handler.retry('run-1');
      expect(result.success).toBe(true);

      const runsDir = getRunsDir();
      const persistence = new DefaultStatePersistence(runsDir);
      const state = persistence.load('run-1' as RunId);
      expect(state?.currentState).toBe('FAILED');
    });
  });

  it('abort returns error when run directory does not exist', async () => {
    const handler = new DefaultDashboardActionHandler();
    const result = await handler.abort('nonexistent-run', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('abort returns error when no state can be recovered', async () => {
    const handler = new DefaultDashboardActionHandler();
    const runDir = join(baseDir, 'runs', 'empty-run');
    mkdirSync(runDir, { recursive: true });
    const result = await handler.abort('empty-run', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('No state found');
  });

  it('abort returns error for lock-only run without force flag', async () => {
    const handler = new DefaultDashboardActionHandler();
    const runId = 'lock-only';
    const runDir = join(baseDir, 'runs', runId);
    const lockPath = join(runDir, 'run.lock');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      lockPath,
      [
        `runId: ${runId}`,
        'pid: 999999',
        'acquiredAt: 2026-01-01T00:00:00Z',
        `lockPath: ${lockPath}`,
        `hostname: ${hostname()}`,
      ].join('\n'),
      'utf8',
    );

    const result = await handler.abort(runId, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('has not checkpointed yet');
    expect(result.error).toContain('force');
  });

  it('abort returns success for already-terminal state', async () => {
    const handler = new DefaultDashboardActionHandler();
    await seedRunState('run-done', {
      currentState: 'DONE',
      previousState: 'CODE_REVIEW',
    });
    const result = await handler.abort('run-done', {});
    expect(result.success).toBe(true);
  });

  it('retry returns error when no state can be recovered', async () => {
    const handler = new DefaultDashboardActionHandler();
    const runDir = join(baseDir, 'runs', 'empty-retry');
    mkdirSync(runDir, { recursive: true });
    const result = await handler.retry('empty-retry');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No state found');
  });

  describe('approve', () => {
    it('returns success for valid run', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-approve', {
        waitingContext: {
          liveSessionId: 'sess-1',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      const result = await handler.approve('run-approve', {});
      expect(result.success).toBe(true);
    });

    it('returns error when run directory does not exist', async () => {
      const handler = new DefaultDashboardActionHandler();
      const result = await handler.approve('nonexistent-run', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when no state file exists', async () => {
      const handler = new DefaultDashboardActionHandler();
      const runDir = join(baseDir, 'runs', 'run-no-state');
      mkdirSync(runDir, { recursive: true });
      const result = await handler.approve('run-no-state', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('No state found');
    });

    it('succeeds when sessionId matches liveSessionId', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-match', {
        waitingContext: {
          liveSessionId: 'sess-42',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      const result = await handler.approve('run-match', { sessionId: 'sess-42' });
      expect(result.success).toBe(true);
    });

    it('validates session ID mismatch', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-sess', {
        waitingContext: {
          liveSessionId: 'sess-42',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      const result = await handler.approve('run-sess', { sessionId: 'sess-wrong' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('mismatch');
    });

    it('publishes to streamBus on success', async () => {
      const streamBus = makeStreamBus();
      const handler = new DefaultDashboardActionHandler(undefined, streamBus);
      await seedRunState('run-bus', {
        waitingContext: {
          liveSessionId: 'sess-1',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      const result = await handler.approve('run-bus', {});
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(streamBus.publish)).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-bus',
          type: 'status',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          structuredData: expect.objectContaining({
            action: 'approval_requested',
            outcome: 'started',
          }),
        }),
      );
    });

    it('publishes fallback content when no requestingState', async () => {
      const streamBus = makeStreamBus();
      const handler = new DefaultDashboardActionHandler(undefined, streamBus);
      await seedRunState('run-no-req', {});
      const result = await handler.approve('run-no-req', {});
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(streamBus.publish)).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-no-req',
          content: 'Approval requested',
        }),
      );
    });
  });

  describe('reject', () => {
    it('returns success for valid run', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-reject', {
        waitingContext: {
          liveSessionId: 'sess-1',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      const result = await handler.reject('run-reject', {});
      expect(result.success).toBe(true);
    });

    it('publishes fallback content when no requestingState', async () => {
      const streamBus = makeStreamBus();
      const handler = new DefaultDashboardActionHandler(undefined, streamBus);
      await seedRunState('run-rej-noreq', {});
      const result = await handler.reject('run-rej-noreq', {});
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(streamBus.publish)).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-rej-noreq',
          content: 'Rejection requested',
        }),
      );
    });

    it('publishes to streamBus with rejection action', async () => {
      const streamBus = makeStreamBus();
      const handler = new DefaultDashboardActionHandler(undefined, streamBus);
      await seedRunState('run-rej-bus', {
        waitingContext: {
          liveSessionId: 'sess-1',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      const result = await handler.reject('run-rej-bus', {});
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(streamBus.publish)).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-rej-bus',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          structuredData: expect.objectContaining({
            action: 'rejection_requested',
            outcome: 'started',
          }),
        }),
      );
    });
  });

  describe('answer', () => {
    it('returns error for empty content', async () => {
      const handler = new DefaultDashboardActionHandler();
      const result = await handler.answer('run-1', { content: '   ' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('non-empty');
    });

    it('returns success for non-empty content', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-ans', {
        waitingContext: {
          liveSessionId: 'sess-1',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      const result = await handler.answer('run-ans', { content: 'My answer' });
      expect(result.success).toBe(true);
    });

    it('publishes to streamBus with answered action', async () => {
      const streamBus = makeStreamBus();
      const handler = new DefaultDashboardActionHandler(undefined, streamBus);
      await seedRunState('run-ans-bus', {
        waitingContext: {
          liveSessionId: 'sess-1',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      const result = await handler.answer('run-ans-bus', { content: 'My answer' });
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(streamBus.publish)).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-ans-bus',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          structuredData: expect.objectContaining({
            action: 'text_requested',
            outcome: 'started',
          }),
        }),
      );
    });
  });

  describe('abort with streamBus', () => {
    it('publishes to streamBus on success', async () => {
      const streamBus = makeStreamBus();
      const handler = new DefaultDashboardActionHandler(undefined, streamBus);
      await seedRunState('run-abort-bus', {
        waitingContext: {
          liveSessionId: 'sess-1',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      const result = await handler.abort('run-abort-bus', {});
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(streamBus.publish)).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-abort-bus',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          structuredData: expect.objectContaining({ action: 'aborted' }),
        }),
      );
    });
  });

  describe('retry with streamBus', () => {
    it('publishes to streamBus on success', async () => {
      const streamBus = makeStreamBus();
      const handler = new DefaultDashboardActionHandler(undefined, streamBus);
      await seedRunState('run-retry-bus', {
        currentState: 'ABORTED',
        previousState: 'IMPLEMENTATION',
        stateHistory: ['INTAKE', 'IMPLEMENTATION', 'ABORTED'],
      });
      const result = await handler.retry('run-retry-bus');
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(streamBus.publish)).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-retry-bus',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          structuredData: expect.objectContaining({
            action: 'retry_requested',
            fromState: 'IMPLEMENTATION',
          }),
        }),
      );
    });
  });

  describe('retry error handling', () => {
    it('returns error when spawn throws during retry', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-retry-err', {
        currentState: 'ABORTED',
        previousState: 'IMPLEMENTATION',
        stateHistory: ['INTAKE', 'IMPLEMENTATION', 'ABORTED'],
      });
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('retry spawn failed');
      });
      const result = await handler.retry('run-retry-err');
      expect(result.success).toBe(false);
      expect(result.error).toBe('retry spawn failed');
    });

    it('handles non-Error throw during retry', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-retry-str', {
        currentState: 'ABORTED',
        previousState: 'IMPLEMENTATION',
        stateHistory: ['INTAKE', 'IMPLEMENTATION', 'ABORTED'],
      });
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw 'string retry error'; // eslint-disable-line @typescript-eslint/only-throw-error
      });
      const result = await handler.retry('run-retry-str');
      expect(result.success).toBe(false);
      expect(result.error).toBe('string retry error');
    });
  });

  describe('retry with repoRoot', () => {
    it('passes --repo flag when repoRoot exists', async () => {
      const handler = new DefaultDashboardActionHandler();
      vi.mocked(spawn).mockClear();
      await seedRunState('run-repo', {
        currentState: 'ABORTED',
        previousState: 'IMPLEMENTATION',
        stateHistory: ['INTAKE', 'IMPLEMENTATION', 'ABORTED'],
        repoRoot: '/my/repo',
      });
      const result = await handler.retry('run-repo');
      expect(result.success).toBe(true);
      const spawnCalls = vi.mocked(spawn).mock.calls;
      const lastCall = spawnCalls[spawnCalls.length - 1] as unknown[] | undefined;
      expect(lastCall?.[1]).toEqual(expect.arrayContaining(['--repo', '/my/repo']));
    });
  });

  describe('deleteRun', () => {
    it('removes run directory', async () => {
      await seedRunState('del-run', {});
      const runDir = join(baseDir, 'runs', 'del-run');
      expect(existsSync(runDir)).toBe(true);
      const handler = new DefaultDashboardActionHandler();
      const result = await handler.deleteRun('del-run');
      expect(result.success).toBe(true);
      expect(existsSync(runDir)).toBe(false);
    });

    it('returns error for non-existent run', async () => {
      const handler = new DefaultDashboardActionHandler();
      const result = await handler.deleteRun('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when rmSync throws', async () => {
      await seedRunState('del-err', {});
      const handler = new DefaultDashboardActionHandler();
      vi.mocked(rmSync).mockImplementationOnce(() => {
        throw new Error('EPERM: operation not permitted');
      });
      const result = await handler.deleteRun('del-err');
      expect(result.success).toBe(false);
      expect(result.error).toBe('EPERM: operation not permitted');
    });

    it('handles non-Error throw from rmSync', async () => {
      await seedRunState('del-str', {});
      const handler = new DefaultDashboardActionHandler();
      vi.mocked(rmSync).mockImplementationOnce(() => {
        throw 'string rmSync error'; // eslint-disable-line @typescript-eslint/only-throw-error
      });
      const result = await handler.deleteRun('del-str');
      expect(result.success).toBe(false);
      expect(result.error).toBe('string rmSync error');
    });
  });

  describe('getWorkflowPreview', () => {
    it('returns null for unknown workflow', () => {
      vi.mocked(loadWorkflowByName).mockReturnValue(null);
      const handler = new DefaultDashboardActionHandler();
      const result = handler.getWorkflowPreview('unknown');
      expect(result).toBeNull();
    });

    it('returns preview for valid workflow', () => {
      const mockWorkflow = {
        name: 'test-workflow',
        version: '1.0.0',
        states: { STATE_A: { roles: [] }, STATE_B: { roles: [] } },
      };
      const mockPreview = { states: [], transitions: [] };
      vi.mocked(loadWorkflowByName).mockReturnValue(
        mockWorkflow as unknown as NonNullable<ReturnType<typeof loadWorkflowByName>>,
      );
      vi.mocked(projectWorkflowPreview).mockReturnValue(
        mockPreview as unknown as ReturnType<typeof projectWorkflowPreview>,
      );
      const handler = new DefaultDashboardActionHandler();
      const result = handler.getWorkflowPreview('test-workflow');
      expect(result).toBe(mockPreview);
      expect(loadWorkflowByName).toHaveBeenCalledWith('test-workflow');
      expect(projectWorkflowPreview).toHaveBeenCalledWith(mockWorkflow);
    });
  });

  describe('listWorkflows', () => {
    it('returns workflow summaries', () => {
      const mockWorkflows = [
        { name: 'wf-1', version: '1.0.0', states: { A: {}, B: {}, C: {} } },
        { name: 'wf-2', version: '2.0.0', states: { X: {} } },
      ];
      vi.mocked(loadAllWorkflows).mockReturnValue(
        mockWorkflows as unknown as ReturnType<typeof loadAllWorkflows>,
      );
      const handler = new DefaultDashboardActionHandler();
      const result = handler.listWorkflows();
      expect(result).toEqual([
        { name: 'wf-1', version: '1.0.0', stateCount: 3 },
        { name: 'wf-2', version: '2.0.0', stateCount: 1 },
      ]);
    });
  });

  describe('resumeWith error handling', () => {
    it('returns error when spawn throws', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-err', {
        waitingContext: {
          liveSessionId: 'sess-1',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });
      const result = await handler.approve('run-err', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('spawn failed');
    });

    it('publishes error to streamBus when spawn throws', async () => {
      const streamBus = makeStreamBus();
      const handler = new DefaultDashboardActionHandler(undefined, streamBus);
      await seedRunState('run-err-bus', {
        waitingContext: {
          liveSessionId: 'sess-1',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });
      const result = await handler.approve('run-err-bus', {});
      expect(result.success).toBe(false);
      // Verify both the success publish and the error publish happened
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const publishCalls = vi.mocked(streamBus.publish).mock.calls;
      const errorEvent = publishCalls.find(
        (call) => (call[0] as unknown as Record<string, unknown>).roleId === 'orchestrator',
      );
      expect(errorEvent).toBeDefined();
      expect((errorEvent?.[0] as unknown as Record<string, unknown>).structuredData).toEqual(
        expect.objectContaining({ action: 'request_failed', error: 'spawn failed' }),
      );
    });

    it('handles non-Error throw in resumeWith', async () => {
      const handler = new DefaultDashboardActionHandler();
      await seedRunState('run-err-str', {
        waitingContext: {
          liveSessionId: 'sess-1',
          pendingRequestId: 'req-1',
          sessionTransport: 'stdio',
          requestingState: 'CODE_REVIEW',
        },
      });
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw 'string error'; // eslint-disable-line @typescript-eslint/only-throw-error
      });
      const result = await handler.approve('run-err-str', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });
  });

  describe('createRun', () => {
    it('returns model failures without spawning a CLI process', async () => {
      vi.mocked(spawn).mockClear();
      vi.mocked(preflightSelectedModels).mockRejectedValueOnce(new Error('Model retired: planner'));
      const handler = new DefaultDashboardActionHandler();

      const result = await handler.createRun({ prompt: 'Build a feature' });

      expect(result).toEqual({ success: false, error: 'Model retired: planner' });
      expect(spawn).not.toHaveBeenCalled();
    });

    it('returns error for empty prompt', async () => {
      const handler = new DefaultDashboardActionHandler();
      const result = await handler.createRun({ prompt: '   ' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('non-empty');
    });

    it('spawns CLI for valid prompt', async () => {
      const handler = new DefaultDashboardActionHandler();
      vi.mocked(spawn).mockClear();
      const result = await handler.createRun({ prompt: 'Build a feature' });
      expect(result.success).toBe(true);
      expect(vi.mocked(spawn)).toHaveBeenCalled();
      const options = vi.mocked(spawn).mock.calls[0]?.[2];
      expect(options.env?.['AI_ORCHESTRATOR_MODEL_PREFLIGHT']).toBe('checked');
    });

    it('returns error when spawn throws', async () => {
      const handler = new DefaultDashboardActionHandler();
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('spawn failed in createRun');
      });
      const result = await handler.createRun({ prompt: 'Build a feature' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('spawn failed in createRun');
    });

    it('handles non-Error throw in createRun', async () => {
      const handler = new DefaultDashboardActionHandler();
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw 'string createRun error'; // eslint-disable-line @typescript-eslint/only-throw-error
      });
      const result = await handler.createRun({ prompt: 'Build a feature' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('string createRun error');
    });
  });

  it('force aborts a lock-only run before the first checkpoint exists', async () => {
    const handler = new DefaultDashboardActionHandler();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) {
        throw Object.assign(new Error('terminated'), { code: 'ESRCH' });
      }
      return true;
    });
    const runId = 'run-1';
    const runDir = getRunDir(runId);
    const lockPath = join(runDir, 'run.lock');
    mkdirSync(runDir, { recursive: true });

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

    const result = await handler.abort(runId, { force: true });

    expect(result.success).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(-424242, 'SIGTERM');

    const runsDir = getRunsDir();
    const persistence = new DefaultStatePersistence(runsDir);
    const state = persistence.load('run-1' as RunId);
    expect(state?.currentState).toBe('ABORTED');
  });
});
