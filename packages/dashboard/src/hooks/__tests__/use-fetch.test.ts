// @vitest-environment jsdom
import type { DashboardEvent } from '@ai-dev-orchestrator/schemas';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseEventStream = vi
  .fn<(runId?: string) => { events: DashboardEvent[] }>()
  .mockReturnValue({ events: [] });

vi.mock('../use-event-stream', () => ({
  useEventStream: (...args: unknown[]) => mockUseEventStream(...(args as [])),
}));

import { useFetch } from '../use-fetch';

describe('useFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseEventStream.mockReturnValue({ events: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches data on mount', async () => {
    const fetcher = vi.fn().mockResolvedValue({ count: 42 });
    const { result } = renderHook(() => useFetch(fetcher));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({ count: 42 });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error when fetcher throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useFetch(fetcher));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Network error');
  });

  it('stringifies non-Error rejections', async () => {
    const fetcher = vi.fn().mockRejectedValue('string error');
    const { result } = renderHook(() => useFetch(fetcher));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.error).toBe('string error');
  });

  it('polls at the given interval', async () => {
    const fetcher = vi.fn().mockResolvedValue('ok');
    renderHook(() => useFetch(fetcher, { pollMs: 5000 }));

    // Initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // First poll tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Second poll tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('clears poll interval on unmount', async () => {
    const fetcher = vi.fn().mockResolvedValue('ok');
    const { unmount } = renderHook(() => useFetch(fetcher, { pollMs: 5000 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // Should not have been called again after unmount
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refreshes when SSE filter matches', async () => {
    const fetcher = vi.fn().mockResolvedValue('data');

    const { rerender } = renderHook(() =>
      useFetch(fetcher, {
        sseFilter: (type) => type === 'state_changed',
        runId: 'r1',
      }),
    );

    // Initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Simulate matching SSE event
    mockUseEventStream.mockReturnValue({
      events: [{ type: 'state_changed', timestamp: '2026-01-01T00:00:01Z' }],
    });

    await act(async () => {
      rerender();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not refresh when SSE filter does not match', async () => {
    const fetcher = vi.fn().mockResolvedValue('data');

    const { rerender } = renderHook(() =>
      useFetch(fetcher, {
        sseFilter: (type) => type === 'state_changed',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Non-matching event
    mockUseEventStream.mockReturnValue({
      events: [{ type: 'run_started', timestamp: '2026-01-01T00:00:01Z' }],
    });

    await act(async () => {
      rerender();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('deduplicates SSE events with the same key', async () => {
    const fetcher = vi.fn().mockResolvedValue('data');

    const event = {
      type: 'state_changed',
      timestamp: '2026-01-01T00:00:01Z',
    } as DashboardEvent;

    const { rerender } = renderHook(() =>
      useFetch(fetcher, {
        sseFilter: (type) => type === 'state_changed',
      }),
    );

    // Initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // First event triggers refresh
    mockUseEventStream.mockReturnValue({ events: [event] });
    await act(async () => {
      rerender();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Same event re-rendered should NOT trigger another refresh
    await act(async () => {
      rerender();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('allows manual refresh via returned callback', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1');
    const { result } = renderHook(() => useFetch(fetcher));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockResolvedValue('v2');

    await act(async () => {
      result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe('v2');
  });

  it('does not poll when pollMs is not provided', async () => {
    const fetcher = vi.fn().mockResolvedValue('ok');
    renderHook(() => useFetch(fetcher));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when sseFilter is undefined', async () => {
    const fetcher = vi.fn().mockResolvedValue('data');

    const { rerender } = renderHook(() => useFetch(fetcher));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    mockUseEventStream.mockReturnValue({
      events: [{ type: 'state_changed', timestamp: '2026-01-01T00:00:01Z' }],
    });

    await act(async () => {
      rerender();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Without sseFilter, SSE events should not trigger refresh
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
