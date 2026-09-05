import type { AgentSessionSnapshot } from '@ai-dev-orchestrator/schemas';

/** Port for persisting agent session snapshots to durable storage. */
export interface AgentSessionStore {
  /** Save or overwrite a session snapshot. */
  saveSnapshot(snapshot: AgentSessionSnapshot): Promise<void>;

  /** Load a session snapshot by sessionId. */
  loadSnapshot(sessionId: string, runId: string): Promise<AgentSessionSnapshot | null>;

  /** List all session snapshots for a run. */
  listByRun(runId: string): Promise<readonly AgentSessionSnapshot[]>;

  /** List all session snapshots across all runs. */
  listAll(): Promise<readonly AgentSessionSnapshot[]>;

  /** Remove a session snapshot. */
  removeSnapshot(sessionId: string, runId: string): Promise<boolean>;
}
