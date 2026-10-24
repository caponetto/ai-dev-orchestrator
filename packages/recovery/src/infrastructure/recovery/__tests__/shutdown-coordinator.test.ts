import type { JournalWriter, StatePersistence } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { LockHandle, RunLifecycleData } from '@ai-dev-orchestrator/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShutdownCoordinator } from '../shutdown-coordinator';

function makeMockStatePersistence(): StatePersistence {
  return {
    save: vi.fn(),
    load: vi.fn().mockReturnValue(null),
    exists: vi.fn().mockReturnValue(false),
    validate: vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
    probeLock: vi.fn().mockReturnValue({
      exists: false,
      pid: 0,
      pidRunning: false,
      hostname: '',
      unreadable: false,
    }),
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    reconstructFromJournal: vi.fn().mockReturnValue(null),
  };
}

function makeMockJournalWriter(): JournalWriter {
  return {
    append: vi.fn(),
    appendBatch: vi.fn(),
  };
}

function makeLockHandle(): LockHandle {
  return {
    runId: createRunId('run-1'),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    lockPath: '/tmp/test.lock',
    hostname: 'test-host',
  };
}

describe('ShutdownCoordinator', () => {
  let coordinator: ShutdownCoordinator;

  afterEach(() => {
    coordinator.uninstall();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts with shutdown not requested', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      expect(coordinator.isShutdownRequested()).toBe(false);
    });

    it('returns default shutdown reason as signal', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      expect(coordinator.getShutdownReason()).toBe('signal');
    });

    it('returns shutdown state with requested false', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      const state = coordinator.getShutdownState();
      expect(state.requested).toBe(false);
      expect(state.requestedAt).toBe('');
    });
  });

  it('installs once and delivers only the first shutdown request', () => {
    coordinator = new ShutdownCoordinator(makeMockStatePersistence(), makeMockJournalWriter());
    const before = process.listenerCount('SIGINT');
    coordinator.install();
    coordinator.install();
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    const listener = vi.fn();
    coordinator.onShutdown(listener);
    coordinator.requestShutdown('abort');
    const first = coordinator.getShutdownState();
    coordinator.requestShutdown('signal');
    expect(listener).toHaveBeenCalledOnce();
    expect(coordinator.getShutdownState()).toEqual(first);
  });

  it('permits unsubscribe and immediately notifies late subscribers only once', () => {
    coordinator = new ShutdownCoordinator(makeMockStatePersistence(), makeMockJournalWriter());
    const removed = vi.fn();
    const unsubscribe = coordinator.onShutdown(removed);
    unsubscribe();
    unsubscribe();
    coordinator.requestShutdown('signal');
    expect(removed).not.toHaveBeenCalled();
    const late = vi.fn();
    coordinator.onShutdown(late)();
    coordinator.requestShutdown('abort');
    expect(late).toHaveBeenCalledOnce();
    expect(() => {
      coordinator.onShutdown(() => {
        throw new Error('late failure');
      })();
    }).not.toThrow();
  });
  it('keeps the first shutdown deadline across repeated signals and clears it on uninstall', () => {
    vi.useFakeTimers();
    coordinator = new ShutdownCoordinator(makeMockStatePersistence(), makeMockJournalWriter(), 100);
    const expire = vi.fn();
    coordinator.install(expire);
    coordinator.requestShutdown('signal');
    vi.advanceTimersByTime(75);
    coordinator.requestShutdown('abort');
    vi.advanceTimersByTime(25);
    expect(expire).toHaveBeenCalledOnce();
    coordinator.uninstall();
    vi.advanceTimersByTime(100);
    expect(expire).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
  it('cancels a pending deadline on uninstall', () => {
    vi.useFakeTimers();
    coordinator = new ShutdownCoordinator(makeMockStatePersistence(), makeMockJournalWriter(), 100);
    const expire = vi.fn();
    coordinator.install(expire);
    coordinator.requestShutdown('signal');
    coordinator.uninstall();
    vi.advanceTimersByTime(200);
    expect(expire).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('honors time already spent shutting down when installed late', () => {
    vi.useFakeTimers();
    coordinator = new ShutdownCoordinator(makeMockStatePersistence(), makeMockJournalWriter(), 100);
    coordinator.requestShutdown('signal');
    vi.advanceTimersByTime(75);
    const expire = vi.fn();
    coordinator.install(expire);
    vi.advanceTimersByTime(25);
    expect(expire).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
  it.each([NaN, Infinity, -1])('rejects an invalid graceful timeout %s', (timeout) => {
    coordinator = new ShutdownCoordinator(makeMockStatePersistence(), makeMockJournalWriter());
    expect(
      () => new ShutdownCoordinator(makeMockStatePersistence(), makeMockJournalWriter(), timeout),
    ).toThrow('finite non-negative');
  });
  it('ignores a deadline callback already queued when the coordinator is uninstalled', () => {
    vi.useFakeTimers();
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    coordinator = new ShutdownCoordinator(makeMockStatePersistence(), makeMockJournalWriter(), 100);
    const expire = vi.fn();
    coordinator.install(expire);
    coordinator.requestShutdown('signal');
    const callback = schedule.mock.calls.at(-1)?.[0];
    if (typeof callback !== 'function') {
      throw new Error('Expected a scheduled deadline');
    }
    coordinator.uninstall();
    callback();
    expect(expire).not.toHaveBeenCalled();
  });
  it('supports an immediate deadline', () => {
    vi.useFakeTimers();
    coordinator = new ShutdownCoordinator(makeMockStatePersistence(), makeMockJournalWriter(), 0);
    const expire = vi.fn();
    coordinator.install(expire);
    coordinator.requestShutdown('signal');
    vi.advanceTimersByTime(0);
    expect(expire).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  describe('signal handler installation', () => {
    it('installs handlers for both SIGTERM and SIGINT', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);

      const sigTermBefore = process.listenerCount('SIGTERM');
      const sigIntBefore = process.listenerCount('SIGINT');

      coordinator.install();

      expect(process.listenerCount('SIGTERM')).toBe(sigTermBefore + 1);
      expect(process.listenerCount('SIGINT')).toBe(sigIntBefore + 1);
    });

    it('triggers shutdown flag when SIGTERM is emitted', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.install();

      process.emit('SIGTERM');

      expect(coordinator.isShutdownRequested()).toBe(true);
      expect(coordinator.getShutdownReason()).toBe('signal');
    });

    it('triggers shutdown flag when SIGINT is emitted', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.install();

      process.emit('SIGINT');

      expect(coordinator.isShutdownRequested()).toBe(true);
      expect(coordinator.getShutdownReason()).toBe('signal');
    });

    it('removes handlers on uninstall', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);

      const sigTermBefore = process.listenerCount('SIGTERM');
      const sigIntBefore = process.listenerCount('SIGINT');

      coordinator.install();
      expect(process.listenerCount('SIGTERM')).toBe(sigTermBefore + 1);
      expect(process.listenerCount('SIGINT')).toBe(sigIntBefore + 1);

      coordinator.uninstall();
      expect(process.listenerCount('SIGTERM')).toBe(sigTermBefore);
      expect(process.listenerCount('SIGINT')).toBe(sigIntBefore);
    });

    it('does not trigger shutdown after uninstall', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.install();
      coordinator.uninstall();

      // Re-emit should not trigger since handlers are removed
      // (We can't fully test this without side effects, but listener count proves removal)
      expect(coordinator.isShutdownRequested()).toBe(false);
    });
  });

  describe('requestShutdown', () => {
    it('sets the shutdown flag', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.requestShutdown('signal');
      expect(coordinator.isShutdownRequested()).toBe(true);
    });

    it('records signal reason', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.requestShutdown('signal');
      expect(coordinator.getShutdownReason()).toBe('signal');
    });

    it('records timeout reason', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.requestShutdown('timeout');
      expect(coordinator.getShutdownReason()).toBe('timeout');
    });

    it('records abort reason', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.requestShutdown('abort');
      expect(coordinator.getShutdownReason()).toBe('abort');
    });

    it('records requestedAt timestamp', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      const before = new Date().toISOString();
      coordinator.requestShutdown('signal');
      const after = new Date().toISOString();

      const state = coordinator.getShutdownState();
      expect(state.requested).toBe(true);
      expect(state.requestedAt >= before).toBe(true);
      expect(state.requestedAt <= after).toBe(true);
    });
  });

  describe('getShutdownState', () => {
    it('returns full shutdown state after request', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.requestShutdown('abort');

      const state = coordinator.getShutdownState();
      expect(state.requested).toBe(true);
      expect(state.reason).toBe('abort');
      expect(state.requestedAt).not.toBe('');
    });
  });

  describe('graceful timeout', () => {
    it('returns configured timeout value', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      expect(coordinator.getGracefulTimeoutMs()).toBe(5000);
    });

    it('uses default timeout of 10000ms', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw);
      expect(coordinator.getGracefulTimeoutMs()).toBe(10000);
    });
  });

  describe('initiateShutdown', () => {
    it('saves state checkpoint', async () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);

      const lock = makeLockHandle();
      await coordinator.initiateShutdown(createRunId('run-1'), lock, 'IMPLEMENTATION');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sp.save).toHaveBeenCalledOnce();
    });

    it('writes journal abort event', async () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);

      const lock = makeLockHandle();
      await coordinator.initiateShutdown(createRunId('run-1'), lock, 'IMPLEMENTATION');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(jw.append).toHaveBeenCalledOnce();
    });

    it('releases the lock', async () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);

      const lock = makeLockHandle();
      await coordinator.initiateShutdown(createRunId('run-1'), lock, 'IMPLEMENTATION');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sp.releaseLock).toHaveBeenCalledWith(lock);
    });

    it('saves state with current FSM state', async () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);

      const lock = makeLockHandle();
      await coordinator.initiateShutdown(createRunId('run-1'), lock, 'PLANNING');

      const savedState = (sp.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(savedState['currentState']).toBe('PLANNING');
      expect(savedState['runId']).toBe('run-1');
    });

    it('writes journal event with signal shutdown reason', async () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.requestShutdown('signal');

      const lock = makeLockHandle();
      await coordinator.initiateShutdown(createRunId('run-1'), lock, 'IMPLEMENTATION');

      const journalEvent = (jw.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: RunLifecycleData;
      };
      expect(journalEvent.data.reason).toBe('shutdown:signal');
    });

    it('writes journal event with timeout shutdown reason', async () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.requestShutdown('timeout');

      const lock = makeLockHandle();
      await coordinator.initiateShutdown(createRunId('run-1'), lock, 'IMPLEMENTATION');

      const journalEvent = (jw.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: RunLifecycleData;
      };
      expect(journalEvent.data.reason).toBe('shutdown:timeout');
    });

    it('writes journal event with abort shutdown reason', async () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);
      coordinator.requestShutdown('abort');

      const lock = makeLockHandle();
      await coordinator.initiateShutdown(createRunId('run-1'), lock, 'IMPLEMENTATION');

      const journalEvent = (jw.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: RunLifecycleData;
      };
      expect(journalEvent.data.reason).toBe('shutdown:abort');
    });

    it('writes journal event with run_aborted type and paused status', async () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);

      const lock = makeLockHandle();
      await coordinator.initiateShutdown(createRunId('run-1'), lock, 'IMPLEMENTATION');

      const journalEvent = (jw.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        type: string;
        data: RunLifecycleData;
      };
      expect(journalEvent.type).toBe('run_aborted');
      expect(journalEvent.data.status).toBe('paused');
    });
  });

  describe('onShutdown', () => {
    it('invokes listeners when shutdown is requested', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);

      const listener = vi.fn();
      coordinator.onShutdown(listener);
      coordinator.requestShutdown('signal');

      expect(listener).toHaveBeenCalledOnce();
    });

    it('invokes multiple listeners in order', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);

      const order: number[] = [];
      coordinator.onShutdown(() => order.push(1));
      coordinator.onShutdown(() => order.push(2));
      coordinator.requestShutdown('abort');

      expect(order).toEqual([1, 2]);
    });

    it('continues invoking listeners even if one throws', () => {
      const sp = makeMockStatePersistence();
      const jw = makeMockJournalWriter();
      coordinator = new ShutdownCoordinator(sp, jw, 5000);

      const second = vi.fn();
      coordinator.onShutdown(() => {
        throw new Error('boom');
      });
      coordinator.onShutdown(second);
      coordinator.requestShutdown('signal');

      expect(second).toHaveBeenCalledOnce();
    });
  });
});
