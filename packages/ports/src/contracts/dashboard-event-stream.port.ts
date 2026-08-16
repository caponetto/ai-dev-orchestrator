import type { DashboardEvent } from '@ai-orchestrator/schemas';

export interface DashboardEventStream {
  subscribe(callback: (event: DashboardEvent) => void): string;
  unsubscribe(clientId: string): void;
  publish(event: DashboardEvent): void;
  getClientCount(): number;
}
