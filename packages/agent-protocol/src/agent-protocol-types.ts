import type {
  ConfidenceReport,
  PermissionAction,
  ThreeTierSeverity,
} from '@ai-orchestrator/schemas';

// --- Protocol version and capabilities ---

export const PROTOCOL_VERSION = 'ado/agent/v1' as const;

export const KNOWN_CAPABILITIES = [
  'permission_request',
  'clarification_request',
  'streaming_artifact',
  'structured_log',
] as const;

export type KnownCapability = (typeof KNOWN_CAPABILITIES)[number];

// --- Message type enums ---

export type AgentToOrchestratorType =
  | 'handshake'
  | 'progress'
  | 'permission_request'
  | 'clarification_request'
  | 'artifact'
  | 'log'
  | 'done'
  | 'error';

export type OrchestratorToAgentType =
  'handshake_ack' | 'permission_response' | 'clarification_response' | 'abort';

export type ProtocolMessageType = AgentToOrchestratorType | OrchestratorToAgentType;

// --- Message envelope ---

export interface ProtocolMessage<T extends ProtocolMessageType = ProtocolMessageType, P = unknown> {
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly messageId: string;
  readonly timestamp: string;
  readonly type: T;
  readonly payload: P;
  readonly replyTo?: string;
}

// --- Agent → Orchestrator payloads ---

export interface HandshakePayload {
  readonly capabilities: readonly string[];
}

export interface ProgressPayload {
  readonly phase: string;
  readonly detail: string;
  readonly percent?: number;
}

export interface PermissionRequestPayload {
  readonly action: PermissionAction;
  readonly resource: string;
  readonly detail: string;
  readonly riskLevel: ThreeTierSeverity;
  readonly externalRequestId?: string;
  readonly toolInput?: Record<string, unknown>;
}

export interface ClarificationRequestPayload {
  readonly question: string;
  readonly context: string;
  readonly options?: readonly string[];
}

export interface ArtifactPayload {
  readonly artifactType: string;
  readonly content: string;
  readonly isFinal: boolean;
}

export interface LogPayload {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface DonePayload {
  readonly summary: string;
  readonly confidence?: ConfidenceReport;
}

export interface ErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

// --- Orchestrator → Agent payloads ---

export interface HandshakeAckPayload {
  readonly sessionId: string;
  readonly permissionHints?: readonly PermissionAction[];
}

export interface PermissionResponsePayload {
  readonly granted: boolean;
  readonly reason?: string;
}

export interface ClarificationResponsePayload {
  readonly answer: string;
}

export interface AbortPayload {
  readonly reason: string;
}

// --- Typed message aliases ---

export type HandshakeMessage = ProtocolMessage<'handshake', HandshakePayload>;
export type ProgressMessage = ProtocolMessage<'progress', ProgressPayload>;
export type PermissionRequestMessage = ProtocolMessage<
  'permission_request',
  PermissionRequestPayload
>;
export type ClarificationRequestMessage = ProtocolMessage<
  'clarification_request',
  ClarificationRequestPayload
>;
export type ArtifactMessage = ProtocolMessage<'artifact', ArtifactPayload>;
export type LogMessage = ProtocolMessage<'log', LogPayload>;
export type DoneMessage = ProtocolMessage<'done', DonePayload>;
export type ErrorMessage = ProtocolMessage<'error', ErrorPayload>;

export type HandshakeAckMessage = ProtocolMessage<'handshake_ack', HandshakeAckPayload>;
export type PermissionResponseMessage = ProtocolMessage<
  'permission_response',
  PermissionResponsePayload
>;
export type ClarificationResponseMessage = ProtocolMessage<
  'clarification_response',
  ClarificationResponsePayload
>;
export type AbortMessage = ProtocolMessage<'abort', AbortPayload>;

export type AgentToOrchestratorMessage =
  | HandshakeMessage
  | ProgressMessage
  | PermissionRequestMessage
  | ClarificationRequestMessage
  | ArtifactMessage
  | LogMessage
  | DoneMessage
  | ErrorMessage;

export type OrchestratorToAgentMessage =
  HandshakeAckMessage | PermissionResponseMessage | ClarificationResponseMessage | AbortMessage;

export type TypedProtocolMessage = AgentToOrchestratorMessage | OrchestratorToAgentMessage;

export type PayloadMap = {
  [K in TypedProtocolMessage['type']]: Extract<TypedProtocolMessage, { type: K }>['payload'];
};

// --- All known message type strings ---

export const AGENT_TO_ORCHESTRATOR_TYPES: readonly AgentToOrchestratorType[] = [
  'handshake',
  'progress',
  'permission_request',
  'clarification_request',
  'artifact',
  'log',
  'done',
  'error',
];

export const ORCHESTRATOR_TO_AGENT_TYPES: readonly OrchestratorToAgentType[] = [
  'handshake_ack',
  'permission_response',
  'clarification_response',
  'abort',
];

export const ALL_MESSAGE_TYPES: readonly ProtocolMessageType[] = [
  ...AGENT_TO_ORCHESTRATOR_TYPES,
  ...ORCHESTRATOR_TO_AGENT_TYPES,
];

// --- Factory helper ---

let messageCounter = 0;

export function createProtocolMessage<T extends ProtocolMessageType, P>(
  type: T,
  payload: P,
  replyTo?: string,
): ProtocolMessage<T, P> {
  return {
    protocol: PROTOCOL_VERSION,
    messageId: `msg-${String(++messageCounter)}-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    type,
    payload,
    ...(replyTo !== undefined ? { replyTo } : {}),
  };
}

export function resetMessageCounter(): void {
  messageCounter = 0;
}

export function payloadToRecord(payload: object): Readonly<Record<string, unknown>> {
  return payload as Readonly<Record<string, unknown>>;
}
