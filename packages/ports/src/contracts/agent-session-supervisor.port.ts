import type {
  AgentSessionHandle,
  AgentSessionRef,
  AgentSessionSnapshot,
  AgentSessionState,
  SessionPendingRequest,
} from '@ai-orchestrator/schemas';

import type { AgentOutputStreamEvent } from './agent-runner.port';

/** Response payload delivered to a pending session request. */
export interface SessionResponsePayload {
  readonly granted?: boolean;
  readonly answer?: string;
  readonly reason?: string;
}

/** Result of waiting for a session to advance after delivering a human response. */
export type SessionAdvanceResult =
  | {
      readonly kind: 'completed';
      readonly artifactContent?: string;
      readonly durationMs: number;
      readonly tokenUsage?: { readonly inputTokens: number; readonly outputTokens: number };
    }
  | { readonly kind: 'awaiting_human'; readonly pendingRequest: SessionPendingRequest }
  | { readonly kind: 'failed'; readonly error: string };

/** Port for managing the lifecycle of durable agent sessions. */
export interface AgentSessionSupervisor {
  /** Create a new supervised session for a protocol-capable dispatch. */
  createSession(
    ref: AgentSessionRef,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentSessionHandle>;

  /** Attach to an existing session by sessionId. */
  attach(
    sessionId: string,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentSessionHandle | null>;

  /** Deliver a human response to a pending request within a session. */
  sendHumanResponse(
    sessionId: string,
    requestId: string,
    response: SessionResponsePayload,
  ): Promise<boolean>;

  /** Logically pause a session (protocol-level, not OS signal). */
  pause(sessionId: string): Promise<boolean>;

  /** Abort a session with a reason. */
  abort(sessionId: string, reason: string): Promise<boolean>;

  /** Finalize a completed session and clean up resources. */
  finalize(sessionId: string): Promise<void>;

  /** Get current snapshot for a session. */
  getSnapshot(sessionId: string): Promise<AgentSessionSnapshot | null>;

  /** Get current state for a session. */
  getState(sessionId: string): AgentSessionState | null;

  /** List all sessions for a run. */
  listByRun(runId: string): Promise<readonly AgentSessionSnapshot[]>;

  /** Wait for a session to advance after delivering a human response. */
  waitForAdvance(sessionId: string): Promise<SessionAdvanceResult>;
}
