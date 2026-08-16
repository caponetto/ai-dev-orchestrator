import type { DashboardEventStream } from '@ai-orchestrator/ports';
import type { DashboardEvent } from '@ai-orchestrator/schemas';

/**
 * In-process SSE event stream that manages connected clients and
 * publishes dashboard events to each registered callback.
 */
export class SseEventStream implements DashboardEventStream {
  private readonly clients = new Map<string, (event: DashboardEvent) => void>();
  private nextId = 1;

  subscribe(callback: (event: DashboardEvent) => void): string {
    const clientId = `sse-client-${String(this.nextId++)}`;
    this.clients.set(clientId, callback);
    return clientId;
  }

  unsubscribe(clientId: string): void {
    this.clients.delete(clientId);
  }

  publish(event: DashboardEvent): void {
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
}
