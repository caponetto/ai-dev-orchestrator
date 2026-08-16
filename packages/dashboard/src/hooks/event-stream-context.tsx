import type { DashboardEvent } from '@ai-orchestrator/schemas';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { getApiBaseUrl } from '../lib/api-base';

import type { SseStatus } from './use-event-stream';

const MAX_EVENTS = 200;

interface EventStreamContextValue {
  readonly status: SseStatus;
  readonly events: readonly DashboardEvent[];
  readonly clearEvents: () => void;
}

const EventStreamContext = createContext<EventStreamContextValue | null>(null);

export function EventStreamProvider({ children }: { readonly children: ReactNode }) {
  const [status, setStatus] = useState<SseStatus>('disconnected');
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  useEffect(() => {
    const base = getApiBaseUrl();
    const url = `${base}/events`;

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
  }, []);

  return (
    <EventStreamContext.Provider value={{ status, events, clearEvents }}>
      {children}
    </EventStreamContext.Provider>
  );
}

export function useGlobalEventStream(): EventStreamContextValue {
  const ctx = useContext(EventStreamContext);
  if (!ctx) {
    throw new Error('useGlobalEventStream must be used within an EventStreamProvider');
  }
  return ctx;
}
