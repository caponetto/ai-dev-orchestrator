import { useCallback, useEffect, useRef, useState } from 'react';

import { useEventStream } from './use-event-stream';

interface UseFetchOptions {
  pollMs?: number;
  sseFilter?: (eventType: string) => boolean;
  runId?: string;
}

interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useFetch<T>(
  fetcher: () => Promise<T>,
  options?: UseFetchOptions,
): UseFetchResult<T> {
  const { pollMs, sseFilter, runId } = options ?? {};
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { events: liveEvents } = useEventStream(runId);
  const lastProcessedRef = useRef('');

  const refresh = useCallback(() => {
    fetcher()
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [fetcher]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pollMs) {
      return;
    }
    let timer = setInterval(refresh, pollMs);
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(timer);
      } else {
        refresh();
        timer = setInterval(refresh, pollMs);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh, pollMs]);

  useEffect(() => {
    if (!sseFilter || liveEvents.length === 0) {
      return;
    }
    const latest = liveEvents[0];
    const eventKey = `${latest.type}-${latest.timestamp}`;
    if (eventKey === lastProcessedRef.current) {
      return;
    }
    lastProcessedRef.current = eventKey;
    if (sseFilter(latest.type)) {
      refresh();
    }
  }, [liveEvents, refresh, sseFilter]);

  return { data, loading, error, refresh };
}
