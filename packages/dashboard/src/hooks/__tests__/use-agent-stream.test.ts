// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStream } from '../use-agent-stream';

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: MockEventSource[] = [];

  readyState = MockEventSource.OPEN;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    setTimeout(() => this.onopen?.(new Event('open')), 0);
  }

  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }

  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  simulateError() {
    this.readyState = MockEventSource.CONNECTING;
    this.onerror?.(new Event('error'));
  }
}

describe('useAgentStream', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts disconnected when no runId is provided', () => {
    const { result } = renderHook(() => useAgentStream());
    expect(result.current.status).toBe('disconnected');
    expect(result.current.groups.size).toBe(0);
  });

  it('starts disconnected when active is false', () => {
    const { result } = renderHook(() => useAgentStream('run-1', false));
    expect(result.current.status).toBe('disconnected');
  });

  it('connects to the correct URL', () => {
    renderHook(() => useAgentStream('run-1'));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/runs/run-1/agent-stream');
  });

  it('sets status to connected on open', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStream('run-1'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.status).toBe('connected');
    vi.useRealTimers();
  });

  it('groups incoming events by dispatchId', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStream('run-1'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateMessage({
        runId: 'run-1',
        stateId: 'state-1',
        roleId: 'role-1',
        dispatchId: 'dispatch-1',
        timestamp: '2026-01-01T00:00:00Z',
        type: 'stdout',
        content: 'Hello',
      });
    });

    expect(result.current.groups.size).toBe(1);
    const group = result.current.groups.get('dispatch-1');
    expect(group?.lines).toHaveLength(1);
    expect(group?.roleId).toBe('role-1');

    vi.useRealTimers();
  });

  it('deduplicates events with the same key', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStream('run-1'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const source = MockEventSource.instances[0];
    const event = {
      runId: 'run-1',
      stateId: 'state-1',
      roleId: 'role-1',
      dispatchId: 'dispatch-1',
      timestamp: '2026-01-01T00:00:00Z',
      type: 'stdout',
      content: 'Hello',
    };

    act(() => {
      source.simulateMessage(event);
      source.simulateMessage(event);
    });

    expect(result.current.groups.get('dispatch-1')?.lines).toHaveLength(1);

    vi.useRealTimers();
  });

  it('parses protocol messages from content', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStream('run-1'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateMessage({
        runId: 'run-1',
        stateId: 'state-1',
        roleId: 'role-1',
        dispatchId: 'dispatch-1',
        timestamp: '2026-01-01T00:00:01Z',
        type: 'stdout',
        content: JSON.stringify({
          protocol: 'orchestrator',
          type: 'progress',
          payload: { step: 1 },
        }),
      });
    });

    const group = result.current.groups.get('dispatch-1');
    expect(group?.lines[0].protocolMessage?.messageType).toBe('progress');
    expect(group?.lines[0].protocolMessage?.payload).toEqual({ step: 1 });

    vi.useRealTimers();
  });

  it('sets status to reconnecting on error with CONNECTING state', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStream('run-1'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateError();
    });

    expect(result.current.status).toBe('reconnecting');

    vi.useRealTimers();
  });

  it('closes EventSource on unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useAgentStream('run-1'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const source = MockEventSource.instances[0];
    unmount();

    expect(source.closed).toBe(true);

    vi.useRealTimers();
  });
});
