import { PROTOCOL_VERSION } from '@ai-orchestrator/agent-protocol';

export interface AgentSessionDescriptor {
  readonly sessionId: string;
  readonly protocol?: typeof PROTOCOL_VERSION;
  readonly capabilities?: readonly string[];
  readonly transport?:
    { readonly type: 'websocket'; readonly url: string } | { readonly type: 'none' };
  readonly reconnect?: RemoteReconnectDescriptor;
}

interface RemoteReconnectDescriptor {
  readonly url: string;
  readonly leaseExpiresAt?: string;
  readonly heartbeatIntervalMs?: number;
  readonly resultUrl?: string;
}

interface ParsedSubmitResponse {
  readonly taskId: string;
  readonly session?: AgentSessionDescriptor;
}

export type SessionParseResult =
  | { readonly ok: true; readonly parsed: ParsedSubmitResponse }
  | { readonly ok: false; readonly reason: string };

export function parseSubmitResponse(body: unknown): SessionParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, reason: 'Submit response body is not an object' };
  }

  const record = body as Record<string, unknown>;
  const taskId = record['taskId'];
  if (typeof taskId !== 'string' || taskId === '') {
    return { ok: false, reason: 'Submit response missing required taskId string' };
  }

  const session = record['session'];
  if (session === undefined || session === null) {
    return { ok: true, parsed: { taskId } };
  }

  if (typeof session !== 'object') {
    return { ok: false, reason: 'session field is not an object' };
  }

  const sessionRecord = session as Record<string, unknown>;
  const sessionId = sessionRecord['sessionId'];
  if (typeof sessionId !== 'string' || sessionId === '') {
    return { ok: false, reason: 'session.sessionId is missing or empty' };
  }

  const descriptor: AgentSessionDescriptor = {
    sessionId,
    ...(sessionRecord['protocol'] === PROTOCOL_VERSION ? { protocol: PROTOCOL_VERSION } : {}),
    ...(Array.isArray(sessionRecord['capabilities'])
      ? { capabilities: sessionRecord['capabilities'] as string[] }
      : {}),
    ...parseTransportDescriptor(sessionRecord['transport']),
    ...parseReconnectDescriptor(sessionRecord['reconnect']),
  };

  return { ok: true, parsed: { taskId, session: descriptor } };
}

function parseTransportDescriptor(
  transport: unknown,
): { transport: AgentSessionDescriptor['transport'] } | Record<string, never> {
  if (typeof transport !== 'object' || transport === null) {
    return {};
  }

  const t = transport as Record<string, unknown>;
  if (t['type'] === 'websocket' && typeof t['url'] === 'string' && t['url'] !== '') {
    return { transport: { type: 'websocket', url: t['url'] } };
  }

  if (t['type'] === 'none') {
    return { transport: { type: 'none' } };
  }

  return {};
}

export function shouldUseProtocolMode(descriptor: AgentSessionDescriptor): boolean {
  return (
    descriptor.protocol === PROTOCOL_VERSION &&
    descriptor.transport?.type === 'websocket' &&
    descriptor.transport.url !== ''
  );
}

export function isResumableSession(descriptor: AgentSessionDescriptor): boolean {
  return (
    shouldUseProtocolMode(descriptor) &&
    descriptor.reconnect !== undefined &&
    descriptor.reconnect.url !== ''
  );
}

function parseReconnectDescriptor(
  reconnect: unknown,
): { reconnect: RemoteReconnectDescriptor } | Record<string, never> {
  if (typeof reconnect !== 'object' || reconnect === null) {
    return {};
  }

  const r = reconnect as Record<string, unknown>;
  if (typeof r['url'] !== 'string' || r['url'] === '') {
    return {};
  }

  const desc: RemoteReconnectDescriptor = {
    url: r['url'],
    ...(typeof r['leaseExpiresAt'] === 'string' ? { leaseExpiresAt: r['leaseExpiresAt'] } : {}),
    ...(typeof r['heartbeatIntervalMs'] === 'number'
      ? { heartbeatIntervalMs: r['heartbeatIntervalMs'] }
      : {}),
    ...(typeof r['resultUrl'] === 'string' ? { resultUrl: r['resultUrl'] } : {}),
  };

  return { reconnect: desc };
}
