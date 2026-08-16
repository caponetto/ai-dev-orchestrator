import type {
  AgentResult,
  AgentSessionHandle,
  AgentStreamEventType,
  AgentTask,
} from '@ai-orchestrator/schemas';

export interface AgentOutputStreamEvent {
  readonly timestamp: string;
  readonly type: AgentStreamEventType;
  readonly content: string;
  readonly structuredData?: Record<string, unknown>;
  readonly requestMessageId?: string;
}

/** Result of a dispatch that may be terminal or session-backed. */
export type AgentDispatchResult =
  | { readonly kind: 'terminal'; readonly result: AgentResult }
  | { readonly kind: 'session'; readonly handle: AgentSessionHandle };

export interface AgentRunner {
  dispatch(
    task: AgentTask,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentResult>;
}

export interface SessionCapableRunner extends AgentRunner {
  readonly supportsResumableSessions: true;
  dispatchWithSession(
    task: AgentTask,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentDispatchResult>;
}
