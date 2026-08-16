import type { AgentStreamEventType } from '@ai-orchestrator/schemas';
import { useEffect, useRef, useState } from 'react';

import type { SseStatus } from './use-event-stream';

interface ParsedProtocolMessage {
  readonly messageType:
    | 'progress'
    | 'log'
    | 'permission_request'
    | 'permission_response'
    | 'permission_resolved'
    | 'clarification_request'
    | 'clarification_response'
    | 'done'
    | 'error'
    | 'artifact'
    | 'task_prompt';
  readonly payload: Record<string, unknown>;
}

export interface DashboardAgentStreamEvent {
  readonly runId: string;
  readonly stateId: string;
  readonly roleId: string;
  readonly dispatchId: string;
  readonly timestamp: string;
  readonly type: AgentStreamEventType;
  readonly content: string;
  readonly structuredData?: Record<string, unknown>;
  readonly requestMessageId?: string;
  readonly protocolMessage?: ParsedProtocolMessage;
}

const KNOWN_MESSAGE_TYPES = new Set([
  'progress',
  'log',
  'permission_request',
  'permission_response',
  'permission_resolved',
  'clarification_request',
  'clarification_response',
  'done',
  'error',
  'artifact',
  'task_prompt',
]);

function tryParseProtocol(content: string): ParsedProtocolMessage | undefined {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.protocol !== 'string' || typeof parsed.type !== 'string') {
      return undefined;
    }
    if (!KNOWN_MESSAGE_TYPES.has(parsed.type)) {
      return undefined;
    }
    return {
      messageType: parsed.type as ParsedProtocolMessage['messageType'],
      payload: (parsed.payload ?? {}) as Record<string, unknown>,
    };
  } catch {
    return undefined;
  }
}

function tryFromStructuredData(
  data: Record<string, unknown> | undefined,
): ParsedProtocolMessage | undefined {
  if (!data || typeof data.messageType !== 'string') {
    return undefined;
  }
  if (!KNOWN_MESSAGE_TYPES.has(data.messageType)) {
    return undefined;
  }
  const { messageType, ...rest } = data;
  return {
    messageType: messageType as ParsedProtocolMessage['messageType'],
    payload: rest,
  };
}

export interface DispatchGroup {
  readonly dispatchId: string;
  readonly roleId: string;
  readonly stateId: string;
  readonly lines: readonly DashboardAgentStreamEvent[];
}

const MAX_LINES_PER_DISPATCH = 500;

function getAgentStreamBaseUrl(): string {
  return '';
}

export function useAgentStream(runId?: string, active = true) {
  const [status, setStatus] = useState<SseStatus>('disconnected');
  const [groups, setGroups] = useState<Map<string, DispatchGroup>>(new Map());
  const sourceRef = useRef<EventSource | null>(null);
  const activeStateRef = useRef<string | null>(null);
  const seenKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    setGroups(new Map());
    activeStateRef.current = null;
    seenKeys.current = new Set();

    if (!runId || !active) {
      setStatus('disconnected');
      return;
    }

    const base = getAgentStreamBaseUrl();
    const url = `${base}/api/runs/${runId}/agent-stream`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      setStatus('connected');
    };

    source.onmessage = (e: MessageEvent) => {
      try {
        const rawJson: unknown = JSON.parse(e.data as string);
        if (!rawJson || typeof rawJson !== 'object' || !('dispatchId' in rawJson)) {
          return;
        }
        const raw = rawJson as DashboardAgentStreamEvent;
        const dedupKey = `${raw.dispatchId}:${raw.timestamp}:${raw.type}:${raw.content.slice(0, 80)}`;
        if (seenKeys.current.has(dedupKey)) {
          return;
        }
        seenKeys.current.add(dedupKey);

        const proto = tryParseProtocol(raw.content) ?? tryFromStructuredData(raw.structuredData);
        const event: DashboardAgentStreamEvent = proto ? { ...raw, protocolMessage: proto } : raw;

        activeStateRef.current = event.stateId;

        setGroups((prev) => {
          const next = new Map(prev);
          const existing = next.get(event.dispatchId);
          const lines = existing
            ? [...existing.lines, event].slice(-MAX_LINES_PER_DISPATCH)
            : [event];
          next.set(event.dispatchId, {
            dispatchId: event.dispatchId,
            roleId: event.roleId,
            stateId: event.stateId,
            lines,
          });
          return next;
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
  }, [runId, active]);

  return { status, groups };
}
