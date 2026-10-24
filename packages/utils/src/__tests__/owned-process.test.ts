import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OwnedProcess } from '../owned-process';

class FakeChild extends EventEmitter {
  pid: number | undefined = 345678;
  killed = false;
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
  close() {
    this.emit('exit', 0, null);
    this.emit('close', 0, null);
  }
}
let children: FakeChild[];
let alive: boolean;
let kill: MockInstance<typeof process.kill>;
let baselineExitListeners: number;
function own(options: ConstructorParameters<typeof OwnedProcess>[1] = {}, child = new FakeChild()) {
  children.push(child);
  return {
    child,
    owner: new OwnedProcess(child as unknown as ChildProcess, { graceMs: 100, ...options }),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  children = [];
  alive = true;
  baselineExitListeners = process.listenerCount('exit');
  kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (!alive) {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    }
    if (signal === 'SIGKILL') {
      alive = false;
    }
    return true;
  });
});
afterEach(async () => {
  alive = false;
  for (const child of children) {
    child.close();
  }
  await vi.advanceTimersByTimeAsync(150);
  expect(process.listenerCount('exit')).toBe(baselineExitListeners);
  expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('explicit child process ownership', () => {
  it.each([0, 1, -1, 1.5, Number.MAX_SAFE_INTEGER, process.pid])(
    'rejects dangerous PID %s without installing listeners or signalling',
    (pid) => {
      const child = new FakeChild();
      child.pid = pid;
      expect(() => new OwnedProcess(child as unknown as ChildProcess, { ownsGroup: true })).toThrow(
        'valid child PID',
      );
      expect(kill).not.toHaveBeenCalled();
      expect(child.kill).not.toHaveBeenCalled();
    },
  );
  it.each([NaN, -1, Infinity])('rejects invalid kill grace %s', (graceMs) => {
    expect(() => own({ graceMs })).toThrow('termination grace');
  });
  it('does not infer group ownership and observes native close before settling', async () => {
    const { child, owner } = own();
    let finished = false;
    void owner.closed.then(() => {
      finished = true;
    });
    expect(owner.kill()).toBe(true);
    expect(owner.kill()).toBe(false);
    expect(child.killed).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(finished).toBe(false);
    expect(kill).not.toHaveBeenCalled();
    child.close();
    await owner.closed;
    expect(finished).toBe(true);
    expect(owner.kill()).toBe(false);
  });
  it('does not signal a normally completed direct child', async () => {
    const { child, owner } = own();
    child.close();
    await owner.closed;
    expect(child.kill).not.toHaveBeenCalled();
  });
  it('cleans a failed spawn without requiring an exit event', async () => {
    const child = new FakeChild();
    child.pid = undefined;
    const { owner } = own({}, child);
    child.emit('error', new Error('spawn failed'));
    await owner.closed;
    expect(kill).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });
  it('does not confuse an error from an existing child with successful cleanup', async () => {
    const { child, owner } = own();
    let finished = false;
    void owner.closed.then(() => {
      finished = true;
    });
    child.emit('error', new Error('I/O failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    owner.kill();
    child.close();
    await vi.advanceTimersByTimeAsync(25);
    await owner.closed;
  });
  it('starts and cancels a scheduled deadline with process completion', async () => {
    const { child, owner } = own({ timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.close();
    await vi.advanceTimersByTimeAsync(25);
    await owner.closed;
    await vi.advanceTimersByTimeAsync(500);
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('uses the default grace when no grace override is supplied', async () => {
    const child = new FakeChild();
    children.push(child);
    const owner = new OwnedProcess(child as unknown as ChildProcess);
    owner.kill();
    await vi.advanceTimersByTimeAsync(4999);
    expect(child.kill).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.close();
    await owner.closed;
  });
});
describe.skipIf(process.platform === 'win32')('private POSIX process groups', () => {
  it('signals only the explicitly owned group and continues cleanup after parent close', async () => {
    const { child, owner } = own({ ownsGroup: true });
    child.close();
    expect(kill).toHaveBeenCalledWith(-345678, 'SIGTERM');
    let finished = false;
    void owner.closed.then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await owner.closed;
    expect(kill).toHaveBeenCalledWith(-345678, 'SIGKILL');
    expect(child.kill).not.toHaveBeenCalled();
    expect(kill.mock.calls.every(([pid]) => pid === -345678)).toBe(true);
    const count = kill.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(kill).toHaveBeenCalledTimes(count);
  });
  it('clears escalation when the group exits during the grace period', async () => {
    const { child, owner } = own({ ownsGroup: true });
    owner.kill();
    child.close();
    alive = false;
    await vi.advanceTimersByTimeAsync(25);
    await owner.closed;
    await vi.advanceTimersByTimeAsync(500);
    expect(kill).not.toHaveBeenCalledWith(-345678, 'SIGKILL');
  });
  it('does not signal an already empty group', async () => {
    const { child, owner } = own({ ownsGroup: true });
    alive = false;
    child.close();
    await owner.closed;
    expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
  });
  it('ignores queued escalation and poll callbacks after ownership has ended', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const interval = vi.spyOn(globalThis, 'setInterval');
    const { child, owner } = own({ ownsGroup: true });
    owner.kill();
    const lateKill = timeout.mock.calls.at(-1)?.[0];
    const latePoll = interval.mock.calls.at(-1)?.[0];
    alive = false;
    child.close();
    await vi.advanceTimersByTimeAsync(25);
    await owner.closed;
    alive = true;
    vi.mocked(kill).mockClear();
    if (typeof lateKill !== 'function' || typeof latePoll !== 'function') {
      throw new Error('Expected queued callbacks');
    }
    lateKill();
    latePoll();
    expect(kill).not.toHaveBeenCalled();
  });
  it.each([new Error('denied'), 'unknown error'])(
    'does not fall back to unrelated signals after a denied group operation (%s)',
    async (error) => {
      const { child, owner } = own({ ownsGroup: true });
      vi.mocked(kill).mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise non-Error native failures.
        throw error;
      });
      owner.kill();
      child.close();
      let finished = false;
      void owner.closed.then(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(150);
      expect(finished).toBe(false);
      expect(child.kill).not.toHaveBeenCalled();
      vi.mocked(kill).mockImplementation(() => {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      });
      await vi.advanceTimersByTimeAsync(25);
      await owner.closed;
    },
  );
  it('accepts a group disappearing between liveness probe and signal', async () => {
    const { child, owner } = own({ ownsGroup: true });
    vi.mocked(kill).mockImplementation((_pid, signal) => {
      if (signal === 0 && alive) {
        return true;
      }
      alive = false;
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    });
    owner.kill();
    child.close();
    await vi.advanceTimersByTimeAsync(25);
    await owner.closed;
    expect(child.kill).not.toHaveBeenCalled();
  });
  it('does not re-signal after accepted KILL while native close is still pending', async () => {
    const before = new Set(process.listeners('exit'));
    const { child, owner } = own({ ownsGroup: true });
    const hook = process.listeners('exit').find((listener) => !before.has(listener));
    if (!hook) {
      throw new Error('Expected parent exit hook');
    }
    owner.kill();
    await vi.advanceTimersByTimeAsync(100);
    kill.mockClear();
    hook(0);
    expect(kill).not.toHaveBeenCalled();
    child.close();
    await owner.closed;
    kill.mockClear();
    hook(0);
    expect(kill).not.toHaveBeenCalled();
  });
  it('shares one parent-exit hook and forces all active owned groups on parent exit', async () => {
    const before = new Set(process.listeners('exit'));
    const first = own({ ownsGroup: true });
    const secondChild = new FakeChild();
    secondChild.pid = 345679;
    const second = own({ ownsGroup: true }, secondChild);
    expect(process.listenerCount('exit')).toBe(baselineExitListeners + 1);
    const hook = process.listeners('exit').find((listener) => !before.has(listener));
    if (!hook) {
      throw new Error('Expected parent exit hook');
    }
    hook(0);
    expect(kill).toHaveBeenCalledWith(-345678, 'SIGKILL');
    expect(kill).toHaveBeenCalledWith(-345679, 'SIGKILL');
    first.child.close();
    second.child.close();
    await Promise.all([first.owner.closed, second.owner.closed]);
  });
});
