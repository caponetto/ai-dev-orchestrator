import { describe, expect, it, vi } from 'vitest';

import { CliProcessRegistry } from '../cli-process-registry';

describe('CLI process ownership', () => {
  it('retains an owned process until native cleanup without restarting cancellation', async () => {
    const registry = new CliProcessRegistry();
    let close!: () => void;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const kill = vi.fn(() => true);
    const tracked = { kill, closed };
    registry.track(tracked);
    registry.killAll();
    registry.killAll();
    expect(kill).toHaveBeenCalledOnce();
    close();
    await closed;
    registry.killAll();
    expect(kill).toHaveBeenCalledOnce();
    registry.track(tracked);
    registry.killAll();
    expect(kill).toHaveBeenCalledTimes(2);
  });
  it('invalidates pending attempts even without an active subprocess', () => {
    const registry = new CliProcessRegistry();
    const pendingGeneration = registry.generation;
    registry.killAll();
    expect(registry.generation).toBe(pendingGeneration + 1);
  });

  it('signals remaining processes after a failed signal and forgets cancelled processes', () => {
    const registry = new CliProcessRegistry();
    const failedSignal = vi.fn(() => {
      throw new Error('already gone');
    });
    const liveSignal = vi.fn(() => true);
    registry.track({ kill: failedSignal });
    registry.track({ kill: liveSignal });
    registry.killAll();
    registry.killAll();
    expect(failedSignal).toHaveBeenCalledTimes(1);
    expect(liveSignal).toHaveBeenCalledTimes(1);
  });

  it('does not signal completed processes and permits tracking a later dispatch', () => {
    const registry = new CliProcessRegistry();
    const completed = vi.fn(() => true);
    const untrack = registry.track({ kill: completed });
    untrack();
    registry.killAll();
    const later = vi.fn(() => true);
    registry.track({ kill: later });
    registry.killAll();
    expect(completed).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledTimes(1);
  });
});
