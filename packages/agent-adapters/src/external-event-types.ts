/**
 * Discriminated union types for vendor CLI stream-json events.
 *
 * Claude Code, Cursor CLI, and Codex CLI emit newline-delimited JSON on stdout.
 * These types capture the event shapes each vendor produces, enabling
 * typed property access in the adapter mapping functions.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

interface VendorContentBlock {
  readonly type: string;
  readonly text?: string;
}

export interface VendorAssistantMessage {
  readonly content?: string | readonly VendorContentBlock[];
}

interface ClaudeTokenUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

interface CursorTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export type VendorTokenUsage = ClaudeTokenUsage & CursorTokenUsage;

// ---------------------------------------------------------------------------
// Claude Code stream events
// ---------------------------------------------------------------------------

export interface ClaudeAssistantEvent {
  readonly type: 'assistant';
  readonly message?: VendorAssistantMessage & { readonly usage?: VendorTokenUsage };
}

export interface ClaudeResultEvent {
  readonly type: 'result';
  readonly result?: string;
  readonly usage?: VendorTokenUsage;
}

export interface ClaudeErrorEvent {
  readonly type: 'error';
  readonly error?: string;
  readonly message?: string;
}

export interface ClaudeToolUseEvent {
  readonly type: 'tool_use';
  readonly name?: string;
  readonly tool?: string;
}

export interface ClaudeToolResultEvent {
  readonly type: 'tool_result';
  readonly name?: string;
  readonly tool?: string;
}

export interface ClaudePermissionEvent {
  readonly type: 'permission_request' | 'permission';
  readonly tool?: string;
  readonly action?: string;
  readonly resource?: string;
  readonly path?: string;
}

interface ClaudeControlRequestPayload {
  readonly subtype?: string;
  readonly type?: string;
  readonly request_id?: string;
  readonly tool_name?: string;
  readonly tool_input?: Record<string, unknown>;
  readonly input?: Record<string, unknown>;
}

export interface ClaudeControlRequestEvent {
  readonly type: 'control_request' | 'sdk_control_request';
  readonly request_id?: string;
  readonly request?: ClaudeControlRequestPayload;
}

export interface ClaudeClarificationEvent {
  readonly type: 'clarification_request' | 'clarification' | 'input_request';
  readonly question?: string;
  readonly message?: string;
  readonly context?: string;
}

export type ClaudeCodeStreamEvent =
  | ClaudeAssistantEvent
  | ClaudeResultEvent
  | ClaudeErrorEvent
  | ClaudeToolUseEvent
  | ClaudeToolResultEvent
  | ClaudePermissionEvent
  | ClaudeControlRequestEvent
  | ClaudeClarificationEvent;

// ---------------------------------------------------------------------------
// Cursor CLI stream events
// ---------------------------------------------------------------------------

export interface CursorSystemEvent {
  readonly type: 'system';
  readonly subtype?: string;
  readonly model?: string;
}

export interface CursorAssistantEvent {
  readonly type: 'assistant';
  readonly message?: VendorAssistantMessage & { readonly usage?: VendorTokenUsage };
}

export interface CursorToolCallPayload {
  readonly name?: string;
  readonly [key: string]: unknown;
}

export interface CursorToolCallEvent {
  readonly type: 'tool_call';
  readonly subtype?: string;
  readonly tool_call?: CursorToolCallPayload;
}

export interface CursorResultEvent {
  readonly type: 'result';
  readonly duration_ms?: number;
  readonly usage?: VendorTokenUsage;
}

export type CursorStreamEvent =
  CursorSystemEvent | CursorAssistantEvent | CursorToolCallEvent | CursorResultEvent;

// ---------------------------------------------------------------------------
// Codex CLI exec --json events
// ---------------------------------------------------------------------------

export interface CodexItem {
  readonly type?: string;
  readonly text?: string;
  readonly command?: string;
}

export interface CodexThreadStartedEvent {
  readonly type: 'thread.started';
  readonly thread_id?: string;
}

export interface CodexTurnStartedEvent {
  readonly type: 'turn.started';
}

export interface CodexItemEvent {
  readonly type: 'item.started' | 'item.updated' | 'item.completed';
  readonly item?: CodexItem;
}

export interface CodexTurnCompletedEvent {
  readonly type: 'turn.completed';
  readonly usage?: VendorTokenUsage;
}

export interface CodexTurnFailedEvent {
  readonly type: 'turn.failed' | 'error';
  readonly error?: { readonly message?: string };
  readonly message?: string;
}

export type CodexStreamEvent =
  | CodexThreadStartedEvent
  | CodexTurnStartedEvent
  | CodexItemEvent
  | CodexTurnCompletedEvent
  | CodexTurnFailedEvent;

// ---------------------------------------------------------------------------
// Parse / narrow helpers
// ---------------------------------------------------------------------------

const CLAUDE_CODE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'assistant',
  'result',
  'error',
  'tool_use',
  'tool_result',
  'permission_request',
  'permission',
  'control_request',
  'sdk_control_request',
  'clarification_request',
  'clarification',
  'input_request',
]);

const CURSOR_EVENT_TYPES: ReadonlySet<string> = new Set([
  'system',
  'assistant',
  'tool_call',
  'result',
]);

const CODEX_EVENT_TYPES: ReadonlySet<string> = new Set([
  'thread.started',
  'turn.started',
  'item.started',
  'item.updated',
  'item.completed',
  'turn.completed',
  'turn.failed',
  'error',
]);

/** Narrow a pre-parsed JSON object to a Claude Code vendor event. */
export function narrowClaudeCodeEvent(raw: Record<string, unknown>): ClaudeCodeStreamEvent | null {
  const type = raw['type'];
  if (typeof type !== 'string' || !CLAUDE_CODE_EVENT_TYPES.has(type)) {
    return null;
  }
  return raw as unknown as ClaudeCodeStreamEvent;
}

/** Narrow a pre-parsed JSON object to a Cursor CLI vendor event. */
function narrowCursorEvent(raw: Record<string, unknown>): CursorStreamEvent | null {
  const type = raw['type'];
  if (typeof type !== 'string' || !CURSOR_EVENT_TYPES.has(type)) {
    return null;
  }
  return raw as unknown as CursorStreamEvent;
}

function narrowCodexEvent(raw: Record<string, unknown>): CodexStreamEvent | null {
  const type = raw['type'];
  if (typeof type !== 'string' || !CODEX_EVENT_TYPES.has(type)) {
    return null;
  }
  return raw as unknown as CodexStreamEvent;
}

/** Parse a raw JSON line into a typed Claude Code stream event. */
export function parseClaudeCodeEvent(line: string): ClaudeCodeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  return narrowClaudeCodeEvent(raw);
}

/** Parse a raw JSON line into a typed Cursor CLI stream event. */
export function parseCursorEvent(line: string): CursorStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  return narrowCursorEvent(raw);
}

/** Parse a raw JSON line emitted by `codex exec --json`. */
export function parseCodexEvent(line: string): CodexStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    return narrowCodexEvent(JSON.parse(trimmed) as Record<string, unknown>);
  } catch {
    return null;
  }
}
