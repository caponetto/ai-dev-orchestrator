import type { AgentSessionStore } from '@ai-orchestrator/ports';
import type { AgentSessionSnapshot, AgentSessionState } from '@ai-orchestrator/schemas';
/**
 * In-memory index over persisted session snapshots.
 * Provides fast lookups by sessionId, runId, and state while the
 * on-disk store remains the durable source of truth.
 */
export class AgentSessionRegistry {
  private readonly bySessionId = new Map<string, AgentSessionSnapshot>();
  private readonly byRunId = new Map<string, Set<string>>();
  private readonly store: AgentSessionStore;

  constructor(store: AgentSessionStore) {
    this.store = store;
  }

  /** Rebuild the in-memory index from the durable store. */
  async rebuild(): Promise<void> {
    this.bySessionId.clear();
    this.byRunId.clear();
    const all = await this.store.listAll();
    for (const snapshot of all) {
      this.index(snapshot);
    }
  }

  /** Register or update a session in both the store and the index. */
  async register(snapshot: AgentSessionSnapshot): Promise<void> {
    await this.store.saveSnapshot(snapshot);
    this.index(snapshot);
  }

  /** Get a session snapshot by sessionId. */
  get(sessionId: string): AgentSessionSnapshot | null {
    return this.bySessionId.get(sessionId) ?? null;
  }

  /** List all sessions for a run. */
  listByRun(runId: string): readonly AgentSessionSnapshot[] {
    const ids = this.byRunId.get(runId);
    if (!ids) {
      return [];
    }
    const result: AgentSessionSnapshot[] = [];
    for (const id of ids) {
      const snap = this.bySessionId.get(id);
      if (snap) {
        result.push(snap);
      }
    }
    return result;
  }

  /** List sessions matching a specific state. */
  listByState(state: AgentSessionState): readonly AgentSessionSnapshot[] {
    const result: AgentSessionSnapshot[] = [];
    for (const snap of this.bySessionId.values()) {
      if (snap.state === state) {
        result.push(snap);
      }
    }
    return result;
  }

  /** List active (non-terminal) sessions for a run. */
  listActiveByRun(runId: string): readonly AgentSessionSnapshot[] {
    return this.listByRun(runId).filter((s) => !isTerminalState(s.state));
  }

  /** Remove a session from both the store and the index. */
  async remove(sessionId: string, runId: string): Promise<boolean> {
    const removed = await this.store.removeSnapshot(sessionId, runId);
    this.bySessionId.delete(sessionId);
    const runSet = this.byRunId.get(runId);
    if (runSet) {
      runSet.delete(sessionId);
      if (runSet.size === 0) {
        this.byRunId.delete(runId);
      }
    }
    return removed;
  }

  private index(snapshot: AgentSessionSnapshot): void {
    this.bySessionId.set(snapshot.ref.sessionId, snapshot);
    let runSet = this.byRunId.get(snapshot.ref.runId);
    if (!runSet) {
      runSet = new Set();
      this.byRunId.set(snapshot.ref.runId, runSet);
    }
    runSet.add(snapshot.ref.sessionId);
  }
}

function isTerminalState(state: AgentSessionState): boolean {
  return state === 'completed' || state === 'failed' || state === 'aborted';
}
