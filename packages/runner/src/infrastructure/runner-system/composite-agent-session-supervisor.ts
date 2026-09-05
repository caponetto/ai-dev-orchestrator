import type {
  AgentOutputStreamEvent,
  AgentSessionSupervisor,
  SessionAdvanceResult,
  SessionResponsePayload,
} from '@ai-dev-orchestrator/ports';
import type {
  AgentSessionHandle,
  AgentSessionRef,
  AgentSessionSnapshot,
  AgentSessionState,
} from '@ai-dev-orchestrator/schemas';
/**
 * Composite supervisor that delegates to multiple underlying supervisors.
 * Lookup operations try each delegate in order and return the first match.
 * Each runner registers sessions with its own typed supervisor directly;
 * `createSession` on the composite throws to prevent misuse.
 */
export class CompositeAgentSessionSupervisor implements AgentSessionSupervisor {
  private readonly delegates: readonly AgentSessionSupervisor[];

  constructor(delegates: readonly AgentSessionSupervisor[]) {
    this.delegates = delegates;
  }

  createSession(
    _ref: AgentSessionRef,
    _onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentSessionHandle> {
    throw new Error('createSession must be called on a specific supervisor, not the composite');
  }

  async attach(
    sessionId: string,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentSessionHandle | null> {
    for (const d of this.delegates) {
      const handle = await d.attach(sessionId, onStreamEvent);
      if (handle) {
        return handle;
      }
    }
    return null;
  }

  async sendHumanResponse(
    sessionId: string,
    requestId: string,
    response: SessionResponsePayload,
  ): Promise<boolean> {
    for (const d of this.delegates) {
      const sent = await d.sendHumanResponse(sessionId, requestId, response);
      if (sent) {
        return true;
      }
    }
    return false;
  }

  async waitForAdvance(sessionId: string): Promise<SessionAdvanceResult> {
    for (const d of this.delegates) {
      const state = d.getState(sessionId);
      if (state !== null) {
        return d.waitForAdvance(sessionId);
      }
    }
    return { kind: 'failed', error: `Session ${sessionId} not found in any supervisor` };
  }

  async pause(sessionId: string): Promise<boolean> {
    for (const d of this.delegates) {
      const result = await d.pause(sessionId);
      if (result) {
        return true;
      }
    }
    return false;
  }

  async abort(sessionId: string, reason: string): Promise<boolean> {
    for (const d of this.delegates) {
      const result = await d.abort(sessionId, reason);
      if (result) {
        return true;
      }
    }
    return false;
  }

  async finalize(sessionId: string): Promise<void> {
    for (const d of this.delegates) {
      const state = d.getState(sessionId);
      if (state !== null) {
        await d.finalize(sessionId);
        return;
      }
    }
  }

  async getSnapshot(sessionId: string): Promise<AgentSessionSnapshot | null> {
    for (const d of this.delegates) {
      const snapshot = await d.getSnapshot(sessionId);
      if (snapshot) {
        return snapshot;
      }
    }
    return null;
  }

  getState(sessionId: string): AgentSessionState | null {
    for (const d of this.delegates) {
      const state = d.getState(sessionId);
      if (state !== null) {
        return state;
      }
    }
    return null;
  }

  async listByRun(runId: string): Promise<readonly AgentSessionSnapshot[]> {
    const seen = new Set<string>();
    const result: AgentSessionSnapshot[] = [];
    for (const d of this.delegates) {
      const snapshots = await d.listByRun(runId);
      for (const snap of snapshots) {
        if (!seen.has(snap.ref.sessionId)) {
          seen.add(snap.ref.sessionId);
          result.push(snap);
        }
      }
    }
    return result;
  }
}
