import type {
  OrchestratorToAgentMessage,
  ProtocolMessage,
  ProtocolMessageType,
} from '@ai-orchestrator/agent-protocol';
import { PROTOCOL_VERSION, createProtocolMessage } from '@ai-orchestrator/agent-protocol';
import type { ThreeTierSeverity } from '@ai-orchestrator/schemas';

import type { AgentAdapter, AgentAdapterCapabilities } from './adapter-types';
import type {
  ClaudeAssistantEvent,
  ClaudeClarificationEvent,
  ClaudeCodeStreamEvent,
  ClaudeControlRequestEvent,
  ClaudeErrorEvent,
  ClaudePermissionEvent,
  ClaudeResultEvent,
  ClaudeToolUseEvent,
  ClaudeToolResultEvent,
  VendorAssistantMessage,
} from './external-event-types';
import { narrowClaudeCodeEvent } from './external-event-types';

type ClaudeCodeMode = 'native' | 'experimental' | 'text-only';

interface ClaudeCodeAdapterConfig {
  readonly mode: ClaudeCodeMode;
  readonly capabilities: AgentAdapterCapabilities;
}

const NATIVE_ARGS = [
  '--verbose',
  '--output-format',
  'stream-json',
  '--input-format',
  'stream-json',
  '--permission-prompt-tool',
  'stdio',
] as const;
const EXPERIMENTAL_ARGS = ['--print', '--verbose', '--output-format', 'stream-json'] as const;
const TEXT_ONLY_ARGS = ['--print'] as const;

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  readonly command = 'claude';
  readonly args: readonly string[];
  readonly promptViaStdin: boolean;

  private readonly mode: ClaudeCodeMode;
  private readonly capabilities: AgentAdapterCapabilities | undefined;

  constructor(config?: Partial<ClaudeCodeAdapterConfig>) {
    this.mode = config?.mode ?? 'experimental';
    this.capabilities = config?.capabilities;
    this.promptViaStdin = this.mode === 'native';

    if (this.mode === 'native') {
      this.args = [...NATIVE_ARGS];
    } else if (this.mode === 'text-only') {
      this.args = [...TEXT_ONLY_ARGS];
    } else {
      this.args = [...EXPERIMENTAL_ARGS];
    }
  }

  getMode(): ClaudeCodeMode {
    return this.mode;
  }

  sendPrompt(prompt: string): string | null {
    if (this.mode !== 'native') {
      return null;
    }
    return JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt },
    });
  }

  translateOutput(line: string): ProtocolMessage | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      return null;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }

    if (parsed['protocol'] === PROTOCOL_VERSION) {
      if (parsed['type'] === 'clarification_request' && !this.capabilities?.clarificationEvents) {
        return null;
      }
      return parsed as unknown as ProtocolMessage;
    }

    const event = narrowClaudeCodeEvent(parsed);
    if (!event) {
      return null;
    }
    return this.mapClaudeCodeEvent(event);
  }

  translateInput(message: ProtocolMessage): string | null {
    const msg = message as OrchestratorToAgentMessage;
    if (this.mode === 'native') {
      return this.translateInputNative(msg);
    }

    if (this.mode === 'text-only') {
      return null;
    }

    if (msg.type === 'permission_response') {
      return JSON.stringify({ type: 'permission_response', granted: msg.payload.granted });
    }

    if (msg.type === 'clarification_response') {
      if (!this.capabilities?.clarificationEvents) {
        return null;
      }
      return JSON.stringify({ type: 'clarification_response', answer: msg.payload.answer });
    }

    if (msg.type === 'abort') {
      return JSON.stringify({ type: 'abort' });
    }

    return null;
  }

  private translateInputNative(message: OrchestratorToAgentMessage): string | null {
    if (message.type === 'permission_response') {
      const extra = message.payload as unknown as {
        externalRequestId?: string;
        toolInput?: Record<string, unknown>;
      };
      const requestId = extra.externalRequestId ?? message.replyTo ?? '';
      const decision: Record<string, unknown> = message.payload.granted
        ? { behavior: 'allow', updatedInput: extra.toolInput ?? {} }
        : { behavior: 'deny', message: message.payload.reason ?? 'Denied by orchestrator' };
      return JSON.stringify({
        type: 'control_response',
        request_id: requestId,
        response: {
          subtype: 'success',
          request_id: requestId,
          response: decision,
        },
      });
    }
    if (message.type === 'clarification_response' && !this.capabilities?.clarificationEvents) {
      return null;
    }
    if (message.type === 'abort') {
      return JSON.stringify({ type: 'abort' });
    }
    return JSON.stringify(message);
  }

  private mapClaudeCodeEvent(event: ClaudeCodeStreamEvent): ProtocolMessage | null {
    switch (event.type) {
      case 'assistant':
        return mapAssistantEvent(event);
      case 'result':
        return mapResultEvent(event);
      case 'error':
        return mapErrorEvent(event);
      case 'tool_use':
      case 'tool_result':
        return mapToolEvent(event);
      case 'permission_request':
      case 'permission':
        return mapPermissionEvent(event);
      case 'control_request':
      case 'sdk_control_request':
        return mapControlRequestEvent(event);
      case 'clarification_request':
      case 'clarification':
      case 'input_request':
        return this.mapClarificationEvent(event);
      default:
        return null;
    }
  }

  private mapClarificationEvent(event: ClaudeClarificationEvent): ProtocolMessage | null {
    if (!this.capabilities?.clarificationEvents) {
      return null;
    }
    const question = event.question ?? event.message ?? '';
    const context = event.context ?? '';
    return createProtocolMessage('clarification_request', {
      question,
      context,
    });
  }
}

function extractAssistantContent(msg: VendorAssistantMessage): string | null {
  const { content } = msg;
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

function mapAssistantEvent(event: ClaudeAssistantEvent): ProtocolMessage | null {
  if (!event.message) {
    return null;
  }
  const content = extractAssistantContent(event.message);
  if (!content) {
    return null;
  }
  return createProtocolMessage('progress', {
    phase: 'generating',
    detail: content,
  });
}

function mapResultEvent(event: ClaudeResultEvent): ProtocolMessage {
  return createProtocolMessage('done', {
    summary: event.result ?? 'completed',
  });
}

function mapErrorEvent(event: ClaudeErrorEvent): ProtocolMessage {
  const errorMsg = event.error ?? event.message ?? 'unknown error';
  return createProtocolMessage('error', {
    code: 'CLAUDE_CODE_ERROR',
    message: errorMsg,
    recoverable: false,
  });
}

function mapToolEvent(event: ClaudeToolUseEvent | ClaudeToolResultEvent): ProtocolMessage {
  const toolName = event.name ?? event.tool ?? 'unknown';
  return createProtocolMessage('progress', {
    phase: event.type === 'tool_use' ? 'tool_call' : 'tool_result',
    detail: toolName,
  });
}

function mapPermissionEvent(event: ClaudePermissionEvent): ProtocolMessage {
  const tool = event.tool ?? event.action ?? 'unknown';
  const resource = event.resource ?? event.path ?? '';
  return createProtocolMessage('permission_request', {
    action: categorizeAction(tool) as ProtocolMessageType,
    resource,
    detail: `${tool}: ${resource}`,
    riskLevel: 'medium' as const,
  });
}

function mapControlRequestEvent(event: ClaudeControlRequestEvent): ProtocolMessage | null {
  const { request } = event;
  const requestId = event.request_id ?? request?.request_id ?? '';
  const subtype = request?.subtype ?? request?.type;
  if (subtype !== 'can_use_tool') {
    return null;
  }
  const toolName = request?.tool_name ?? 'unknown';
  const toolInput = request?.tool_input ?? request?.input ?? {};
  const resource = extractResource(toolInput);
  const detail = buildPermissionDetail(toolName, toolInput);
  return createProtocolMessage('permission_request', {
    action: categorizeAction(toolName),
    resource,
    detail,
    riskLevel: categorizeRisk(toolName),
    externalRequestId: requestId,
    toolInput,
  });
}

function extractResource(toolInput: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'path', 'file', 'url', 'directory']) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return '';
}

function buildPermissionDetail(toolName: string, toolInput: Record<string, unknown>): string {
  const parts: string[] = [toolName];
  const resource = extractResource(toolInput);
  if (resource) {
    parts.push(resource);
  }
  const relevantKeys = Object.entries(toolInput).filter(
    ([key, val]) =>
      typeof val === 'string' &&
      val.length > 0 &&
      val.length <= 200 &&
      !['content', 'new_string', 'old_string'].includes(key),
  );
  if (relevantKeys.length > 0 && !resource) {
    const summary = relevantKeys
      .slice(0, 3)
      .map(([k, v]) => `${k}=${v as string}`)
      .join(', ');
    parts.push(summary);
  }
  return parts.join(': ');
}

function categorizeRisk(tool: string): ThreeTierSeverity {
  const lower = tool.toLowerCase();
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('exec')) {
    return 'high';
  }
  if (lower.includes('write') || lower.includes('edit') || lower.includes('delete')) {
    return 'medium';
  }
  return 'low';
}

function categorizeAction(tool: string): string {
  const lower = tool.toLowerCase();
  if (lower.includes('read') || lower.includes('view') || lower.includes('cat')) {
    return 'file_read';
  }
  if (lower.includes('write') || lower.includes('edit') || lower.includes('create')) {
    return 'file_write';
  }
  if (lower.includes('delete') || lower.includes('rm') || lower.includes('remove')) {
    return 'file_delete';
  }
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('exec')) {
    return 'shell_execute';
  }
  if (lower.includes('fetch') || lower.includes('curl') || lower.includes('http')) {
    return 'network_request';
  }
  if (lower.includes('git')) {
    return 'git_operation';
  }
  return 'custom';
}

export function createClaudeCodeAdapter(capabilities: AgentAdapterCapabilities): ClaudeCodeAdapter {
  let mode: ClaudeCodeMode;
  if (capabilities.structuredIO && capabilities.stdinResponses && capabilities.permissionEvents) {
    mode = 'native';
  } else if (capabilities.structuredIO) {
    mode = 'experimental';
  } else {
    mode = 'text-only';
  }
  return new ClaudeCodeAdapter({ mode, capabilities });
}
