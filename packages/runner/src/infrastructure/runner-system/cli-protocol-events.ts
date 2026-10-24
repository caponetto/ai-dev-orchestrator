import type {
  ArtifactMessage,
  LogMessage,
  ProgressMessage,
} from '@ai-dev-orchestrator/agent-protocol';
import type { AgentOutputStreamEvent } from '@ai-dev-orchestrator/ports';

export function handleCliProgress(
  message: ProgressMessage,
  onStreamEvent?: (event: AgentOutputStreamEvent) => void,
): void {
  const percentStr =
    typeof message.payload.percent === 'number' ? ` (${String(message.payload.percent)}%)` : '';
  onStreamEvent?.({
    timestamp: message.timestamp,
    type: 'status',
    content: `${message.payload.detail}${percentStr}`,
    structuredData: {
      messageType: 'progress',
      phase: message.payload.phase,
      detail: message.payload.detail,
      percent: message.payload.percent,
    },
  });
}

export function handleCliLog(
  message: LogMessage,
  onStreamEvent?: (event: AgentOutputStreamEvent) => void,
): void {
  const streamType =
    message.payload.level === 'error' || message.payload.level === 'warn' ? 'stderr' : 'stdout';
  onStreamEvent?.({
    timestamp: message.timestamp,
    type: streamType,
    content: `[${message.payload.level}] ${message.payload.message}`,
    structuredData: {
      messageType: 'log',
      level: message.payload.level,
      message: message.payload.message,
    },
  });
}

export function handleCliArtifact(
  message: ArtifactMessage,
  currentArtifact: string | undefined,
): string {
  if (message.payload.isFinal) {
    return message.payload.content;
  }
  return currentArtifact ?? message.payload.content;
}
