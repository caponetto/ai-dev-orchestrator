import type { ProtocolMessage } from '@ai-orchestrator/agent-protocol';
import type { BuiltInCodingRunnerId } from '@ai-orchestrator/schemas';

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
