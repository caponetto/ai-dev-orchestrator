import type { AgentOutputStreamEvent } from './agent-runner.port';

export interface AgentStreamEvent extends AgentOutputStreamEvent {
  readonly runId: string;
  readonly stateId: string;
  readonly roleId: string;
  readonly dispatchId: string;
}

export interface AgentStreamBus {
  subscribe(callback: (event: AgentStreamEvent) => void): string;
  unsubscribe(clientId: string): void;
  publish(event: AgentStreamEvent): void;
  getClientCount(): number;
}

export interface HistoryCapableStreamBus extends AgentStreamBus {
  getRunHistory(runId: string): readonly AgentStreamEvent[];
}
