import type {
  AgentOutputStreamEvent,
  AgentSessionSupervisor,
  SessionAdvanceResult,
  SessionResponsePayload,
} from '@ai-orchestrator/ports';
import type {
  AgentSessionHandle,
  AgentSessionRef,
  AgentSessionSnapshot,
  AgentSessionState,
} from '@ai-orchestrator/schemas';

import type { AgentSessionRegistry } from './agent-session-registry';
import type { LocalAgentSessionHost } from './local-agent-session-host';

/**
 * Supervisor for local CLI agent sessions. Manages session lifecycle,
 * persistence, and reattachment for stdio-based protocol agents.
 *
 * Ownership model: the supervisor holds a reference to the session host
 * (which owns the child process). The workflow loop can exit without killing
 * the child process — the supervisor keeps the host alive.
 */
export class LocalAgentSessionSupervisor implements AgentSessionSupervisor {
  private readonly hosts = new Map<string, LocalAgentSessionHost>();
  private readonly createdAtMap = new Map<string, string>();
  private readonly registry: AgentSessionRegistry;
  private hostFactory?: (
    ref: AgentSessionRef,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ) => Promise<LocalAgentSessionHost>;

  constructor(registry: AgentSessionRegistry) {
    this.registry = registry;
  }

  setHostFactory(
    factory: (
      ref: AgentSessionRef,
      onStreamEvent?: (event: AgentOutputStreamEvent) => void,
    ) => Promise<LocalAgentSessionHost>,
  ): void {
    this.hostFactory = factory;
  }

  async registerHost(host: LocalAgentSessionHost): Promise<void> {
    this.hosts.set(host.ref.sessionId, host);
    this.createdAtMap.set(host.ref.sessionId, new Date().toISOString());
    await this.persistSnapshot(host);
  }

  async createSession(
    ref: AgentSessionRef,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentSessionHandle> {
    if (!this.hostFactory) {
      throw new Error('No host factory configured for local session supervisor');
    }

    const host = await this.hostFactory(ref, onStreamEvent);
    this.hosts.set(ref.sessionId, host);
    this.createdAtMap.set(ref.sessionId, new Date().toISOString());

    await this.persistSnapshot(host);

    return {
      ref: host.ref,
      state: host.state,
      pendingRequests: host.pendingRequests,
    };
  }

  attach(
    sessionId: string,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentSessionHandle | null> {
    const host = this.hosts.get(sessionId);
    if (!host) {
      return Promise.resolve(null);
    }

    if (onStreamEvent) {
      host.addStreamHandler(onStreamEvent);
    }

    return Promise.resolve({
      ref: host.ref,
      state: host.state,
      pendingRequests: host.pendingRequests,
    });
  }

  async sendHumanResponse(
    sessionId: string,
    requestId: string,
    response: SessionResponsePayload,
  ): Promise<boolean> {
    const host = this.hosts.get(sessionId);
    if (!host) {
      return false;
    }

    const payload: Record<string, unknown> = {};
    if (response.granted !== undefined) {
      payload['granted'] = response.granted;
    }
    if (response.answer !== undefined) {
      payload['answer'] = response.answer;
    }
    if (response.reason !== undefined) {
      payload['reason'] = response.reason;
    }

    const sent = host.sendHumanResponse(requestId, payload);
    if (sent) {
      await this.persistSnapshot(host);
    }
    return sent;
  }

  async pause(sessionId: string): Promise<boolean> {
    const host = this.hosts.get(sessionId);
    if (
      !host ||
      host.state === 'completed' ||
      host.state === 'failed' ||
      host.state === 'aborted'
    ) {
      return false;
    }
    await this.persistSnapshot(host);
    return true;
  }

  async abort(sessionId: string, reason: string): Promise<boolean> {
    const host = this.hosts.get(sessionId);
    if (!host) {
      return false;
    }
    host.abort(reason);
    await this.persistSnapshot(host);
    return true;
  }

  async finalize(sessionId: string): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (host) {
      await this.persistSnapshot(host);
      this.hosts.delete(sessionId);
    }
  }

  getSnapshot(sessionId: string): Promise<AgentSessionSnapshot | null> {
    const host = this.hosts.get(sessionId);
    if (host) {
      return Promise.resolve(this.buildSnapshot(host));
    }
    return Promise.resolve(this.registry.get(sessionId));
  }

  getState(sessionId: string): AgentSessionState | null {
    const host = this.hosts.get(sessionId);
    if (host) {
      return host.state;
    }
    const snap = this.registry.get(sessionId);
    return snap?.state ?? null;
  }

  listByRun(runId: string): Promise<readonly AgentSessionSnapshot[]> {
    const fromRegistry = this.registry.listByRun(runId);
    const result = new Map<string, AgentSessionSnapshot>();

    for (const snap of fromRegistry) {
      result.set(snap.ref.sessionId, snap);
    }

    for (const host of this.hosts.values()) {
      if (host.ref.runId === runId) {
        result.set(host.ref.sessionId, this.buildSnapshot(host));
      }
    }

    return Promise.resolve([...result.values()]);
  }

  async waitForAdvance(sessionId: string): Promise<SessionAdvanceResult> {
    const host = this.hosts.get(sessionId);
    if (!host) {
      return { kind: 'failed', error: `Session ${sessionId} not found` };
    }
    const result = await host.waitForAdvance();
    await this.persistSnapshot(host);
    return result;
  }

  getHost(sessionId: string): LocalAgentSessionHost | undefined {
    return this.hosts.get(sessionId);
  }

  private async persistSnapshot(host: LocalAgentSessionHost): Promise<void> {
    const snapshot = this.buildSnapshot(host);
    await this.registry.register(snapshot);
  }

  private buildSnapshot(host: LocalAgentSessionHost): AgentSessionSnapshot {
    return {
      ref: host.ref,
      state: host.state,
      pendingRequests: host.pendingRequests,
      lastProtocolTimestamp: host.lastProtocolTimestamp,
      reconnect: host.pid !== undefined ? { type: 'stdio', pid: host.pid } : undefined,
      createdAt: this.createdAtMap.get(host.ref.sessionId) ?? host.lastProtocolTimestamp,
      updatedAt: new Date().toISOString(),
      workerId: host.ref.sessionId,
    };
  }
}
