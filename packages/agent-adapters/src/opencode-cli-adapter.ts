import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

import type { AgentAdapter } from './adapter-types';
import type {
  OpenCodeErrorEvent,
  OpenCodeStepFinishEvent,
  OpenCodeStepStartEvent,
  OpenCodeStreamEvent,
  OpenCodeTextEvent,
  OpenCodeToolUseEvent,
} from './external-event-types';
import { parseOpenCodeEvent } from './external-event-types';

const OPENCODE_RUN_ARGS = ['run', '--format', 'json', '--auto'] as const;

/** Adapter for OpenCode CLI's non-interactive `opencode run --format json --auto` protocol. */
export class OpencodeCliAdapter implements AgentAdapter {
  readonly name = BUILT_IN_CODING_RUNNER_ID.OPENCODE;
  readonly command = 'opencode';
  readonly args = [...OPENCODE_RUN_ARGS];
  readonly supportsProtocolHandshake = false;

  translateOutput(line: string): ProtocolMessage | null {
    const event = parseOpenCodeEvent(line);
    return event ? mapOpenCodeEvent(event) : null;
  }

  translateInput(_message: ProtocolMessage): string | null {
    return null;
  }
}

function mapOpenCodeEvent(event: OpenCodeStreamEvent): ProtocolMessage | null {
  switch (event.type) {
    case 'step_start':
      return mapStepStartEvent(event);
    case 'text':
      return mapTextEvent(event);
    case 'tool_use':
      return mapToolUseEvent(event);
    case 'step_finish':
      return mapStepFinishEvent(event);
    case 'error':
      return mapErrorEvent(event);
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled: ${String(_exhaustive)}`);
    }
  }
}

function mapStepStartEvent(_event: OpenCodeStepStartEvent): ProtocolMessage {
  return createProtocolMessage('progress', {
    phase: 'init',
    detail: 'OpenCode step started',
  });
}

function mapTextEvent(event: OpenCodeTextEvent): ProtocolMessage | null {
  const text = event.part?.text;
  if (!text) {
    return null;
  }
  return createProtocolMessage('progress', {
    phase: 'generating',
    detail: text,
  });
}

function mapToolUseEvent(event: OpenCodeToolUseEvent): ProtocolMessage | null {
  const toolName = event.part?.tool ?? 'unknown';
  const isCompleted = event.part?.state?.status === 'completed';
  return createProtocolMessage('progress', {
    phase: isCompleted ? 'tool_result' : 'tool_call',
    detail: toolName,
  });
}

function mapStepFinishEvent(event: OpenCodeStepFinishEvent): ProtocolMessage | null {
  if (event.part?.reason === 'stop') {
    return createProtocolMessage('done', { summary: 'completed' });
  }
  return null;
}

function mapErrorEvent(event: OpenCodeErrorEvent): ProtocolMessage {
  return createProtocolMessage('error', {
    code: 'OPENCODE_CLI_ERROR',
    message: event.error?.data?.message ?? event.error?.message ?? 'OpenCode CLI failed',
    recoverable: false,
  });
}

export function createOpencodeCliAdapter(): OpencodeCliAdapter {
  return new OpencodeCliAdapter();
}
