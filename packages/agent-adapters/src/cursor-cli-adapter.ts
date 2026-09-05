import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

import type { AgentAdapter, AgentAdapterCapabilities } from './adapter-types';
import type {
  CursorAssistantEvent,
  CursorResultEvent,
  CursorStreamEvent,
  CursorSystemEvent,
  CursorToolCallEvent,
  CursorToolCallPayload,
} from './external-event-types';
import { parseCursorEvent } from './external-event-types';

type CursorCliMode = 'streaming' | 'text-only';

interface CursorCliAdapterConfig {
  readonly mode: CursorCliMode;
  readonly capabilities: AgentAdapterCapabilities;
}

const STREAMING_ARGS = [
  '--print',
  '--force',
  '--trust',
  '--approve-mcps',
  '--output-format',
  'stream-json',
] as const;
const TEXT_ONLY_ARGS = ['--print', '--force', '--trust', '--approve-mcps'] as const;

/**
 * Adapter for the Cursor CLI (`cursor` / `agent`).
 *
 * The Cursor CLI streaming JSON format emits events with these top-level types:
 *   system, assistant, tool_call, result
 *
 * This is structurally identical to Claude Code's stream-json format,
 * so the translation logic mirrors ClaudeCodeAdapter closely.
 */
export class CursorCliAdapter implements AgentAdapter {
  readonly name = BUILT_IN_CODING_RUNNER_ID.CURSOR;
  readonly command = 'agent';
  readonly args: readonly string[];

  private readonly mode: CursorCliMode;

  constructor(config?: Partial<CursorCliAdapterConfig>) {
    this.mode = config?.mode ?? 'streaming';

    if (this.mode === 'streaming') {
      this.args = [...STREAMING_ARGS];
    } else {
      this.args = [...TEXT_ONLY_ARGS];
    }
  }

  getMode(): CursorCliMode {
    return this.mode;
  }

  translateOutput(line: string): ProtocolMessage | null {
    const event = parseCursorEvent(line);
    if (!event) {
      return null;
    }
    return this.mapCursorEvent(event);
  }

  translateInput(_message: ProtocolMessage): string | null {
    return null;
  }

  private mapCursorEvent(event: CursorStreamEvent): ProtocolMessage | null {
    switch (event.type) {
      case 'system':
        return mapSystemEvent(event);
      case 'assistant':
        return mapAssistantEvent(event);
      case 'tool_call':
        return mapToolCallEvent(event);
      case 'result':
        return mapResultEvent(event);
      default:
        return null;
    }
  }
}

function mapSystemEvent(event: CursorSystemEvent): ProtocolMessage | null {
  if (event.subtype === 'init') {
    const model = event.model ?? 'unknown';
    return createProtocolMessage('progress', {
      phase: 'init',
      detail: `Model: ${model}`,
    });
  }
  return null;
}

function extractAssistantContent(event: CursorAssistantEvent): string | null {
  if (!event.message) {
    return null;
  }
  const { content } = event.message;
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

function mapAssistantEvent(event: CursorAssistantEvent): ProtocolMessage | null {
  const content = extractAssistantContent(event);
  if (!content) {
    return null;
  }
  return createProtocolMessage('progress', {
    phase: 'generating',
    detail: content,
  });
}

function mapToolCallEvent(event: CursorToolCallEvent): ProtocolMessage | null {
  if (event.subtype === 'started') {
    const toolName = extractToolName(event.tool_call);
    return createProtocolMessage('progress', {
      phase: 'tool_call',
      detail: toolName,
    });
  }

  if (event.subtype === 'completed') {
    const toolName = extractToolName(event.tool_call);
    return createProtocolMessage('progress', {
      phase: 'tool_result',
      detail: toolName,
    });
  }

  return null;
}

function extractToolName(toolCall: CursorToolCallPayload | undefined): string {
  if (!toolCall) {
    return 'unknown';
  }
  for (const key of Object.keys(toolCall)) {
    if (key.endsWith('ToolCall')) {
      return key.replace('ToolCall', '');
    }
  }
  return toolCall.name ?? 'unknown';
}

function mapResultEvent(event: CursorResultEvent): ProtocolMessage {
  const summary =
    event.duration_ms === undefined ? 'completed' : `completed in ${String(event.duration_ms)}ms`;
  return createProtocolMessage('done', { summary });
}

export function createCursorCliAdapter(capabilities: AgentAdapterCapabilities): CursorCliAdapter {
  const mode: CursorCliMode = capabilities.structuredIO ? 'streaming' : 'text-only';
  return new CursorCliAdapter({ mode, capabilities });
}
