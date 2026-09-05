import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import type { BuiltInCodingRunnerId } from '@ai-dev-orchestrator/schemas';

export type BuiltInAdapterName = BuiltInCodingRunnerId | 'gh-cli';

export interface AgentAdapterCapabilities {
  readonly structuredIO: boolean;
  readonly permissionEvents: boolean;
  readonly clarificationEvents: boolean;
  readonly stdinResponses: boolean;
}

export interface AgentAdapter {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly promptViaStdin?: boolean;
  /** When false, the runner skips protocol handshake and resumable session negotiation. */
  readonly supportsProtocolHandshake?: boolean;

  translateOutput?(line: string): ProtocolMessage | null;
  translateInput?(message: ProtocolMessage): string | null;
  sendPrompt?(prompt: string): string | null;
}

export interface CapabilityProbeResult {
  readonly adapterName: BuiltInAdapterName;
  readonly probedAt: string;
  readonly capabilities: AgentAdapterCapabilities;
  readonly rawVersion: string | null;
  readonly notes: string[];
}
