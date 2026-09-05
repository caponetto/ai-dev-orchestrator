import type { AgentSessionStore } from '@ai-dev-orchestrator/ports';
import type { AgentSessionSnapshot, AgentSessionState } from '@ai-dev-orchestrator/schemas';
const TERMINAL_STATES: ReadonlySet<AgentSessionState> = new Set(['completed', 'failed', 'aborted']);

export interface ReaperPolicy {
  readonly retentionMs: number;
  readonly reapOrphans: boolean;
  readonly reapTerminal: boolean;
}

interface ReaperResult {
  readonly scanned: number;
  readonly orphaned: number;
  readonly reaped: number;
  readonly errors: readonly string[];
}

export class AgentSessionReaper {
  private readonly store: AgentSessionStore;
  private readonly policy: ReaperPolicy;
  private readonly isProcessAlive: (pid: number) => boolean;

  constructor(
    store: AgentSessionStore,
    policy: ReaperPolicy,
    isProcessAlive?: (pid: number) => boolean,
  ) {
    this.store = store;
    this.policy = policy;
    this.isProcessAlive = isProcessAlive ?? defaultIsProcessAlive;
  }

  async scanAndMark(runId: string): Promise<ReaperResult> {
    const snapshots = await this.store.listByRun(runId);
    let orphaned = 0;
    const errors: string[] = [];

    for (const snapshot of snapshots) {
      if (TERMINAL_STATES.has(snapshot.state) || snapshot.state === 'orphaned') {
        continue;
      }

      const alive = this.isHostAlive(snapshot);
      if (!alive) {
        orphaned += 1;
        try {
          await this.store.saveSnapshot({
            ...snapshot,
            state: 'orphaned',
            updatedAt: new Date().toISOString(),
            error: snapshot.error ?? 'Host process/connection no longer available',
          });
        } catch (err: unknown) {
          errors.push(
            `Failed to mark ${snapshot.ref.sessionId} as orphaned: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return { scanned: snapshots.length, orphaned, reaped: 0, errors };
  }

  async reap(runId: string): Promise<ReaperResult> {
    const scanResult = await this.scanAndMark(runId);
    const snapshots = await this.store.listByRun(runId);
    let reaped = 0;
    const errors = [...scanResult.errors];
    const now = Date.now();

    for (const snapshot of snapshots) {
      let shouldReap = false;

      if (this.policy.reapTerminal && TERMINAL_STATES.has(snapshot.state)) {
        const updatedAt = new Date(snapshot.updatedAt).getTime();
        if (now - updatedAt > this.policy.retentionMs) {
          shouldReap = true;
        }
      }

      if (this.policy.reapOrphans && snapshot.state === 'orphaned') {
        shouldReap = true;
      }

      if (snapshot.expiresAt) {
        const expiresAt = new Date(snapshot.expiresAt).getTime();
        if (now > expiresAt) {
          shouldReap = true;
        }
      }

      if (shouldReap) {
        try {
          const removed = await this.store.removeSnapshot(
            snapshot.ref.sessionId,
            snapshot.ref.runId,
          );
          if (removed) {
            reaped += 1;
          }
        } catch (err: unknown) {
          errors.push(
            `Failed to reap ${snapshot.ref.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return {
      scanned: scanResult.scanned,
      orphaned: scanResult.orphaned,
      reaped,
      errors,
    };
  }

  private isHostAlive(snapshot: AgentSessionSnapshot): boolean {
    if (!snapshot.reconnect) {
      return false;
    }

    if (snapshot.reconnect.type === 'stdio') {
      return this.isProcessAlive(snapshot.reconnect.pid);
    }

    if (snapshot.reconnect.leaseExpiresAt) {
      return new Date(snapshot.reconnect.leaseExpiresAt).getTime() > Date.now();
    }
    return true;
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
