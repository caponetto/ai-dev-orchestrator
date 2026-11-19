import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

import type { AgentAdapter } from './adapter-types';
import type {
  PiAgentSettledEvent,
  PiAutoRetryEndEvent,
  PiCompactionEndEvent,
  PiMessageEndEvent,
  PiMessageUpdateEvent,
  PiStreamEvent,
  PiToolExecutionEndEvent,
  PiToolExecutionStartEvent,
} from './external-event-types';
import { parsePiEvent } from './external-event-types';
import { isTransientCliError } from './transient-cli-error';

const PI_JSON_ARGS = ['--mode', 'json'] as const;

/** Adapter for Pi CLI's one-shot `pi --mode json` JSONL protocol. */
export class PiCliAdapter implements AgentAdapter {
  readonly name = BUILT_IN_CODING_RUNNER_ID.PI;
  readonly command = 'pi';
  readonly args = [...PI_JSON_ARGS];
  readonly supportsProtocolHandshake = false;

  translateOutput(line: string): ProtocolMessage | null {
    const event = parsePiEvent(line);
    return event ? mapPiEvent(event) : null;
  }

  translateInput(_message: ProtocolMessage): string | null {
    return null;
  }
}

function mapPiEvent(event: PiStreamEvent): ProtocolMessage | null {
  switch (event.type) {
    case 'agent_start':
      return createProtocolMessage('progress', { phase: 'init', detail: 'Pi agent started' });
    case 'message_update':
      return mapMessageUpdateEvent(event);
    case 'message_end':
      return mapMessageEndEvent(event);
    case 'tool_execution_start':
      return mapToolExecutionStartEvent(event);
    case 'tool_execution_end':
      return mapToolExecutionEndEvent(event);
    case 'compaction_start':
      return createProtocolMessage('progress', {
        phase: 'generating',
        detail: `Pi compaction started (${event.reason ?? 'unknown reason'})`,
      });
    case 'compaction_end':
      return mapCompactionEndEvent(event);
    case 'auto_retry_end':
      return mapAutoRetryEndEvent(event);
    case 'agent_settled':
      return mapAgentSettledEvent(event);
    default:
      // session, agent_end, turn_start, turn_end, message_start, tool_execution_update
      // and the delta-only message_update records carry no orchestrator-relevant signal
      // beyond what the mapped events provide.
      return null;
  }
}

function mapMessageUpdateEvent(event: PiMessageUpdateEvent): ProtocolMessage | null {
  const nested = event.assistantMessageEvent;
  if (!nested) {
    return null;
  }
  // Text and tool-call deltas are intentionally not mapped: they arrive per token,
  // fragmenting the stream. The complete assistant text arrives on message_end and
  // tool activity arrives on tool_execution_start/end with richer detail.
  if (nested.type === 'error') {
    return createError(nested.error ?? nested.reason ?? 'Pi stream error');
  }
  return null;
}

function mapMessageEndEvent(event: PiMessageEndEvent): ProtocolMessage | null {
  const message = event.message;
  if (!message || message.role !== 'assistant') {
    // User and system messages are echoed by the event stream; only assistant
    // output is agent progress.
    return null;
  }
  const stopReason = message.stopReason;
  if (stopReason === 'error' || stopReason === 'aborted') {
    return createError(
      message.errorMessage ?? `Pi response ended with stop reason "${stopReason}"`,
    );
  }
  const text = extractText(message);
  if (!text) {
    return null;
  }
  return createProtocolMessage('progress', { phase: 'generating', detail: text });
}

function extractText(message: PiMessageEndEvent['message']): string | null {
  const { content } = message ?? {};
  if (typeof content === 'string' && content.length > 0) {
    return content;
  }
  if (content && typeof content !== 'string') {
    const text = content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('');
    return text.length > 0 ? text : null;
  }
  return null;
}

function mapToolExecutionStartEvent(event: PiToolExecutionStartEvent): ProtocolMessage | null {
  const toolName = event.toolName ?? 'unknown';
  return createProtocolMessage('progress', {
    phase: 'tool_call',
    detail: formatToolDetail(toolName, event.args),
  });
}

function mapToolExecutionEndEvent(event: PiToolExecutionEndEvent): ProtocolMessage | null {
  const toolName = event.toolName ?? 'unknown';
  const failed = event.isError === true;
  const resultText = event.result?.content
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  const detail = failed
    ? `${toolName} failed${resultText ? `: ${resultText.slice(0, 200)}` : ''}`
    : resultText
      ? `${toolName}: ${resultText.slice(0, 200)}`
      : toolName;
  return createProtocolMessage('progress', { phase: 'tool_result', detail });
}

function mapCompactionEndEvent(event: PiCompactionEndEvent): ProtocolMessage | null {
  if (event.errorMessage) {
    return createError(`Pi compaction failed: ${event.errorMessage}`);
  }
  if (event.aborted) {
    return createProtocolMessage('progress', {
      phase: 'generating',
      detail: 'Pi compaction aborted',
    });
  }
  return createProtocolMessage('progress', {
    phase: 'generating',
    detail: 'Pi compaction completed',
  });
}

function mapAutoRetryEndEvent(event: PiAutoRetryEndEvent): ProtocolMessage | null {
  if (event.success === false && event.finalError) {
    return createError(event.finalError);
  }
  return null;
}

function mapAgentSettledEvent(event: PiAgentSettledEvent): ProtocolMessage {
  if (event.aborted) {
    return createError('Pi run aborted');
  }
  return createProtocolMessage('done', { summary: 'completed' });
}

function formatToolDetail(toolName: string, args?: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') {
    return toolName;
  }
  for (const key of [
    'file_path',
    'filePath',
    'path',
    'file',
    'pattern',
    'query',
    'command',
    'description',
    'directory',
    'dir',
    'url',
  ]) {
    const val = args[key];
    if (typeof val === 'string' && val.trim()) {
      return `${toolName} ${val.trim()}`;
    }
  }
  return toolName;
}

function createError(message: string): ProtocolMessage {
  return createProtocolMessage('error', {
    code: 'PI_CLI_ERROR',
    message,
    recoverable: isTransientCliError(message),
  });
}

export function createPiCliAdapter(): PiCliAdapter {
  return new PiCliAdapter();
}
