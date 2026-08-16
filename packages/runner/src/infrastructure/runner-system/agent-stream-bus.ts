import type { AgentStreamEvent, HistoryCapableStreamBus } from '@ai-orchestrator/ports';

export class InMemoryAgentStreamBus implements HistoryCapableStreamBus {
  private readonly clients = new Map<string, (event: AgentStreamEvent) => void>();
  private readonly historyByRun = new Map<string, AgentStreamEvent[]>();
  private nextId = 1;

  subscribe(callback: (event: AgentStreamEvent) => void): string {
    const clientId = `agent-stream-${String(this.nextId++)}`;
    this.clients.set(clientId, callback);
    return clientId;
  }

  unsubscribe(clientId: string): void {
    this.clients.delete(clientId);
  }

  publish(event: AgentStreamEvent): void {
    const history = this.historyByRun.get(event.runId) ?? [];
    history.push(event);
    this.historyByRun.set(event.runId, history);
    for (const [, callback] of this.clients) {
      try {
        callback(event);
      } catch {
        // Swallow individual client errors so one bad client
        // does not prevent delivery to the remaining clients.
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getRunHistory(runId: string): readonly AgentStreamEvent[] {
    return this.historyByRun.get(runId) ?? [];
  }
}
