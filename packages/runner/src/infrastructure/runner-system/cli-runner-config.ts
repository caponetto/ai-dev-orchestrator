import type { AgentAdapter } from '@ai-dev-orchestrator/agent-adapters';

export interface CliAgentRunnerConfig {
  readonly command: string;
  readonly args?: readonly string[];
  readonly defaultTimeoutMs?: number;
  readonly handshakeTimeoutMs?: number;
  readonly liveRequestTimeoutMs?: number;
  readonly adapter?: AgentAdapter;
  readonly availableModels?: readonly string[];
}

export const DEFAULT_TIMEOUT_MS = 1_800_000;
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
export const KILL_GRACE_MS = 5_000;
