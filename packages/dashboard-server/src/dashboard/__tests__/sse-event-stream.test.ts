import type { DashboardEvent } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { SseEventStream } from '../sse-event-stream';

function makeDashboardEvent(type = 'state_changed'): DashboardEvent {
  return {
    type,
    timestamp: '2025-01-01T00:00:00Z',
    runId: 'run-1',
    data: { detail: 'test' },
  } as DashboardEvent;
}

describe('SseEventStream', () => {
  let stream: SseEventStream;

  beforeEach(() => {
    stream = new SseEventStream();
  });

  it('starts with zero clients', () => {
    expect(stream.getClientCount()).toBe(0);
  });

  it('addClient returns a unique client id', () => {
    const id1 = stream.subscribe(vi.fn());
    const id2 = stream.subscribe(vi.fn());
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^sse-client-/);
  });

  it('addClient increments client count', () => {
    stream.subscribe(vi.fn());
    stream.subscribe(vi.fn());
    expect(stream.getClientCount()).toBe(2);
  });

  it('removeClient decrements client count', () => {
    const id = stream.subscribe(vi.fn());
    stream.unsubscribe(id);
    expect(stream.getClientCount()).toBe(0);
  });

  it('removeClient with unknown id is a no-op', () => {
    stream.subscribe(vi.fn());
    stream.unsubscribe('nonexistent');
    expect(stream.getClientCount()).toBe(1);
  });

  it('broadcast delivers events to all clients', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    stream.subscribe(cb1);
    stream.subscribe(cb2);
    const event = makeDashboardEvent();
    stream.publish(event);
    expect(cb1).toHaveBeenCalledWith(event);
    expect(cb2).toHaveBeenCalledWith(event);
  });

  it('broadcast does not deliver to removed clients', () => {
    const cb = vi.fn();
    const id = stream.subscribe(cb);
    stream.unsubscribe(id);
    stream.publish(makeDashboardEvent());
    expect(cb).not.toHaveBeenCalled();
  });

  it('broadcast swallows errors from individual clients', () => {
    const badCb = vi.fn().mockImplementation(() => {
      throw new Error('client crash');
    });
    const goodCb = vi.fn();
    stream.subscribe(badCb);
    stream.subscribe(goodCb);
    stream.publish(makeDashboardEvent());
    expect(goodCb).toHaveBeenCalledOnce();
  });

  it('broadcast with no clients does nothing', () => {
    expect(() => {
      stream.publish(makeDashboardEvent());
    }).not.toThrow();
  });
});
