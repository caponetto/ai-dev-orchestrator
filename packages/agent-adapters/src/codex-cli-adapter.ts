import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

import type { AgentAdapter, AgentAdapterCapabilities } from './adapter-types';
import type {
  CodexItemEvent,
  CodexStreamEvent,
  CodexTurnCompletedEvent,
  CodexTurnFailedEvent,
} from './external-event-types';
import { parseCodexEvent } from './external-event-types';

/** Enable outbound network in workspace-write so tools like `gh` can reach api.github.com. */
export const CODEX_WORKSPACE_WRITE_NETWORK_CONFIG =
  'sandbox_workspace_write.network_access=true' as const;

const CODEX_EXEC_ARGS = [
  'exec',
  '--json',
  '--sandbox',
  'workspace-write',
  '-c',
  CODEX_WORKSPACE_WRITE_NETWORK_CONFIG,
] as const;

/** Adapter for Codex CLI's non-interactive `codex exec --json` protocol. */
export class CodexCliAdapter implements AgentAdapter {
  readonly name = BUILT_IN_CODING_RUNNER_ID.CODEX;
  readonly command = 'codex';
  readonly args = [...CODEX_EXEC_ARGS];
  readonly supportsProtocolHandshake = false;

  translateOutput(line: string): ProtocolMessage | null {
    const event = parseCodexEvent(line);
    return event ? mapCodexEvent(event) : null;
  }

  translateInput(_message: ProtocolMessage): string | null {
    return null;
  }
}

function mapCodexEvent(event: CodexStreamEvent): ProtocolMessage | null {
  switch (event.type) {
    case 'thread.started':
      return createProtocolMessage('progress', { phase: 'init', detail: 'Codex session started' });
    case 'turn.started':
      return createProtocolMessage('progress', {
        phase: 'generating',
        detail: 'Codex turn started',
      });
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return mapItemEvent(event);
    case 'turn.completed':
      return mapTurnCompletedEvent(event);
    case 'turn.failed':
    case 'error':
      return mapErrorEvent(event);
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled: ${String(_exhaustive)}`);
    }
  }
}

function mapItemEvent(event: CodexItemEvent): ProtocolMessage | null {
  const item = event.item;
  if (!item) {
    return null;
  }
  if (item.type === 'agent_message' && item.text) {
    return createProtocolMessage('progress', { phase: 'generating', detail: item.text });
  }
  if (item.type === 'reasoning') {
    return null;
  }
  if (item.type !== undefined) {
    return createProtocolMessage('progress', {
      phase: event.type === 'item.started' ? 'tool_call' : 'tool_result',
      detail: item.command ?? item.type,
    });
  }
  return null;
}

function mapTurnCompletedEvent(_event: CodexTurnCompletedEvent): ProtocolMessage {
  return createProtocolMessage('done', { summary: 'completed' });
}

function mapErrorEvent(event: CodexTurnFailedEvent): ProtocolMessage {
  return createProtocolMessage('error', {
    code: 'CODEX_CLI_ERROR',
    message: event.error?.message ?? event.message ?? 'Codex CLI failed',
    recoverable: false,
  });
}

export function createCodexCliAdapter(capabilities: AgentAdapterCapabilities): CodexCliAdapter {
  void capabilities;
  return new CodexCliAdapter();
}
