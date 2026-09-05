import type { ProtocolMessage, ProtocolMessageType } from '@ai-dev-orchestrator/agent-protocol';
import { ALL_MESSAGE_TYPES, PROTOCOL_VERSION } from '@ai-dev-orchestrator/agent-protocol';

type ParseResultStatus =
  | 'ok'
  | 'unknown_type'
  | 'invalid_envelope'
  | 'version_mismatch'
  | 'invalid_json'
  | 'invalid_reply';

export interface ParseSuccess {
  readonly status: 'ok';
  readonly message: ProtocolMessage;
}

export interface ParseFailure {
  readonly status: Exclude<ParseResultStatus, 'ok'>;
  readonly raw: string;
  readonly detail: string;
}

type ParseResult = ParseSuccess | ParseFailure;

const KNOWN_TYPE_SET: ReadonlySet<string> = new Set(ALL_MESSAGE_TYPES);

export function serializeMessage(message: ProtocolMessage): string {
  return JSON.stringify(message);
}

export function deserializeMessage(
  line: string,
  knownOutboundIds?: ReadonlySet<string>,
): ParseResult {
  const trimmed = line.trim();
  if (!trimmed) {
    return { status: 'invalid_json', raw: line, detail: 'Empty line' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e: unknown) {
    return {
      status: 'invalid_json',
      raw: line,
      detail: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'invalid_envelope', raw: line, detail: 'Not a JSON object' };
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['protocol'] !== 'string') {
    return { status: 'invalid_envelope', raw: line, detail: 'Missing or invalid "protocol" field' };
  }

  if (obj['protocol'] !== PROTOCOL_VERSION) {
    return {
      status: 'version_mismatch',
      raw: line,
      detail: `Expected protocol "${PROTOCOL_VERSION}", got "${obj['protocol']}"`,
    };
  }

  if (typeof obj['messageId'] !== 'string' || !obj['messageId']) {
    return {
      status: 'invalid_envelope',
      raw: line,
      detail: 'Missing or empty "messageId" field',
    };
  }

  if (typeof obj['timestamp'] !== 'string' || !obj['timestamp']) {
    return {
      status: 'invalid_envelope',
      raw: line,
      detail: 'Missing or empty "timestamp" field',
    };
  }

  if (typeof obj['type'] !== 'string') {
    return { status: 'invalid_envelope', raw: line, detail: 'Missing or invalid "type" field' };
  }

  if (!KNOWN_TYPE_SET.has(obj['type'])) {
    return {
      status: 'unknown_type',
      raw: line,
      detail: `Unknown message type: "${obj['type']}"`,
    };
  }

  if (
    typeof obj['payload'] !== 'object' ||
    obj['payload'] === null ||
    Array.isArray(obj['payload'])
  ) {
    return { status: 'invalid_envelope', raw: line, detail: 'Missing or invalid "payload" field' };
  }

  if (obj['replyTo'] !== undefined && typeof obj['replyTo'] !== 'string') {
    return {
      status: 'invalid_envelope',
      raw: line,
      detail: '"replyTo" must be a string if present',
    };
  }

  if (
    typeof obj['replyTo'] === 'string' &&
    knownOutboundIds &&
    !knownOutboundIds.has(obj['replyTo'])
  ) {
    return {
      status: 'invalid_reply',
      raw: line,
      detail: `"replyTo" references unknown outbound message ID: "${obj['replyTo']}"`,
    };
  }

  const message: ProtocolMessage = {
    protocol: obj['protocol'],
    messageId: obj['messageId'],
    timestamp: obj['timestamp'],
    type: obj['type'] as ProtocolMessageType,
    payload: obj['payload'],
    ...(typeof obj['replyTo'] === 'string' ? { replyTo: obj['replyTo'] } : {}),
  };

  return { status: 'ok', message };
}
