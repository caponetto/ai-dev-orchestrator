import type { DashboardEvent } from '@ai-dev-orchestrator/schemas';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getApiBaseUrl } from '../lib/api-base';

import { useGlobalEventStream } from './event-stream-context';

export type SseStatus = 'connected' | 'reconnecting' | 'disconnected';

const MAX_EVENTS = 200;

interface EventStreamResult {
  readonly status: SseStatus;
  readonly events: readonly DashboardEvent[];
  readonly clearEvents: () => void;
}

/**
 * When called without a runId, returns the shared global SSE stream from context.
 * When called with a runId, opens a dedicated run-scoped connection.
 */
export function useEventStream(runId?: string): EventStreamResult {
  const globalStream = useGlobalEventStream();
  const runStream = useRunEventStream(runId);

  if (runId) {
    return runStream;
  }
  return globalStream;
}

function useRunEventStream(runId?: string): EventStreamResult {
  const [status, setStatus] = useState<SseStatus>('disconnected');
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  useEffect(() => {
    if (!runId) {
      return;
    }

    const params = new URLSearchParams();
    params.set('runId', runId);
    const qs = params.toString();
    const base = getApiBaseUrl();
    const url = `${base}/events?${qs}`;

    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      setStatus('connected');
    };

    source.onmessage = (e: MessageEvent) => {
      try {
        const rawJson: unknown = JSON.parse(e.data as string);
        if (!rawJson || typeof rawJson !== 'object' || !('type' in rawJson)) {
          return;
        }
        const event = rawJson as DashboardEvent;
        setEvents((prev) => {
          const next = [event, ...prev];
          return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
        });
      } catch {
        // ignore malformed events
      }
    };

    source.onerror = () => {
      if (source.readyState === EventSource.CONNECTING) {
        setStatus('reconnecting');
      } else {
        setStatus('disconnected');
      }
    };

    return () => {
      source.close();
      sourceRef.current = null;
      setStatus('disconnected');
    };
  }, [runId]);

  return { status, events, clearEvents };
}
