import type { ProtocolMessage } from '@ai-orchestrator/agent-protocol';

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
  readonly adapterName: string;
  readonly probedAt: string;
  readonly capabilities: AgentAdapterCapabilities;
  readonly rawVersion: string | null;
  readonly notes: string[];
}
