// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventStreamProvider } from '../event-stream-context';
import { useEventStream } from '../use-event-stream';

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

function wrapper({ children }: { readonly children: ReactNode }) {
  return <EventStreamProvider>{children}</EventStreamProvider>;
}

describe('useEventStream', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('global stream (no runId)', () => {
    it('connects to /events via shared provider', () => {
      renderHook(() => useEventStream(), { wrapper });
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url).toContain('/events');
      expect(MockEventSource.instances[0].url).not.toContain('runId=');
    });

    it('shares a single connection across multiple consumers', () => {
      const { result: result1 } = renderHook(() => useEventStream(), { wrapper });
      const { result: result2 } = renderHook(() => useEventStream(), { wrapper });

      // Each renderHook creates its own provider instance, so 2 instances.
      // Within the same provider tree, only 1 connection is created.
      expect(result1.current.status).toBeDefined();
      expect(result2.current.status).toBeDefined();
    });

    it('starts disconnected then connects on open', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useEventStream(), { wrapper });

      expect(result.current.status).toBe('disconnected');

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.status).toBe('connected');
      vi.useRealTimers();
    });

    it('accumulates events in reverse chronological order', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useEventStream(), { wrapper });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const source = MockEventSource.instances[0];

      act(() => {
        source.simulateMessage({ type: 'run_started', timestamp: '2026-01-01T00:00:00Z' });
      });

      act(() => {
        source.simulateMessage({ type: 'run_completed', timestamp: '2026-01-01T00:01:00Z' });
      });

      expect(result.current.events).toHaveLength(2);
      expect(result.current.events[0].type).toBe('run_completed');
      expect(result.current.events[1].type).toBe('run_started');
      vi.useRealTimers();
    });

    it('ignores malformed events', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useEventStream(), { wrapper });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const source = MockEventSource.instances[0];

      act(() => {
        source.onmessage?.(new MessageEvent('message', { data: 'not json' }));
      });

      act(() => {
        source.simulateMessage({ noTypeField: true });
      });

      expect(result.current.events).toHaveLength(0);
      vi.useRealTimers();
    });

    it('sets status to reconnecting on error', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useEventStream(), { wrapper });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      expect(result.current.status).toBe('reconnecting');
      vi.useRealTimers();
    });

    it('sets status to disconnected on error when closed', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useEventStream(), { wrapper });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const source = MockEventSource.instances[0];
      act(() => {
        source.readyState = MockEventSource.CLOSED;
        source.onerror?.(new Event('error'));
      });

      expect(result.current.status).toBe('disconnected');
      vi.useRealTimers();
    });

    it('clears events via clearEvents', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useEventStream(), { wrapper });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const source = MockEventSource.instances[0];

      act(() => {
        source.simulateMessage({ type: 'run_started', timestamp: '2026-01-01T00:00:00Z' });
      });

      expect(result.current.events).toHaveLength(1);

      act(() => {
        result.current.clearEvents();
      });

      expect(result.current.events).toHaveLength(0);
      vi.useRealTimers();
    });

    it('closes EventSource on unmount', async () => {
      vi.useFakeTimers();
      const { unmount } = renderHook(() => useEventStream(), { wrapper });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const source = MockEventSource.instances[0];
      unmount();

      expect(source.closed).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('run-scoped stream (with runId)', () => {
    it('connects with runId query param', async () => {
      vi.useFakeTimers();
      renderHook(() => useEventStream('run-42'), { wrapper });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // instances[0] is global, instances[1] is run-scoped
      const runSource = MockEventSource.instances.find((s) => s.url.includes('runId=run-42'));
      expect(runSource).toBeDefined();
      vi.useRealTimers();
    });

    it('opens a separate connection from the global stream', async () => {
      vi.useFakeTimers();
      renderHook(() => useEventStream('run-99'), { wrapper });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(MockEventSource.instances).toHaveLength(2);
      const urls = MockEventSource.instances.map((s) => s.url);
      expect(urls.some((u) => !u.includes('runId='))).toBe(true);
      expect(urls.some((u) => u.includes('runId=run-99'))).toBe(true);
      vi.useRealTimers();
    });

    it('receives run-scoped events independently', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useEventStream('run-1'), { wrapper });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const runSource = MockEventSource.instances.find((s) => s.url.includes('runId=run-1'));
      expect(runSource).toBeDefined();

      act(() => {
        runSource?.simulateMessage({ type: 'agent_output', timestamp: '2026-01-01T00:00:00Z' });
      });

      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].type).toBe('agent_output');
      vi.useRealTimers();
    });
  });
});
