import type {
  AgentToOrchestratorMessage,
  ClarificationRequestMessage,
  PermissionRequestMessage,
  ProgressMessage,
  ProtocolMessage,
} from '@ai-orchestrator/agent-protocol';
import { createProtocolMessage, payloadToRecord } from '@ai-orchestrator/agent-protocol';
import type {
  AgentOutputStreamEvent,
  AgentSessionSupervisor,
  SessionAdvanceResult,
  SessionResponsePayload,
} from '@ai-orchestrator/ports';
import type {
  AgentResult,
  AgentSessionHandle,
  AgentSessionRef,
  AgentSessionSnapshot,
  AgentSessionState,
  ClarificationPayload,
  PermissionPayload,
  RemoteReconnectMeta,
  SessionPendingRequest,
} from '@ai-orchestrator/schemas';

import type { AgentSessionRegistry } from './agent-session-registry';
import type { WebSocketProtocolTransport } from './websocket-protocol-transport';

interface RemoteSessionResult {
  readonly status: AgentResult['status'];
  readonly artifactContent?: string;
  readonly error?: string;
  readonly durationMs: number;
}

interface RemoteSessionHost {
  readonly ref: AgentSessionRef;
  readonly reconnectMeta: RemoteReconnectMeta;
  state: AgentSessionState;
  pendingRequests: Map<string, SessionPendingRequest>;
  transport: WebSocketProtocolTransport | null;
  lastProtocolTimestamp: string;
  finalArtifact?: string;
  startTime: number;
  streamHandlers: ((event: AgentOutputStreamEvent) => void)[];
  resultResolve?: (result: RemoteSessionResult) => void;
  resultPromise: Promise<RemoteSessionResult>;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  advanceResolve?: (result: SessionAdvanceResult) => void;
}

type RemoteTransportFactory = (
  ref: AgentSessionRef,
  reconnectMeta: RemoteReconnectMeta,
) => Promise<WebSocketProtocolTransport>;

/**
 * Supervisor for remote HTTP/WebSocket agent sessions. Manages session lifecycle,
 * persistence, and reconnection for remote protocol agents that advertise
 * durable session support.
 */
export class RemoteAgentSessionSupervisor implements AgentSessionSupervisor {
  private readonly hosts = new Map<string, RemoteSessionHost>();
  private readonly registry: AgentSessionRegistry;
  private transportFactory?: RemoteTransportFactory;

  constructor(registry: AgentSessionRegistry) {
    this.registry = registry;
  }

  setTransportFactory(factory: RemoteTransportFactory): void {
    this.transportFactory = factory;
  }

  async createSession(
    ref: AgentSessionRef,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
    reconnectMeta?: RemoteReconnectMeta,
    transport?: WebSocketProtocolTransport,
  ): Promise<AgentSessionHandle> {
    if (!reconnectMeta) {
      throw new Error('Remote sessions require reconnect metadata');
    }

    const host = this.createHost(ref, reconnectMeta, transport ?? null, onStreamEvent);
    this.hosts.set(ref.sessionId, host);

    if (transport) {
      this.wireTransport(host, transport);
    }

    await this.persistSnapshot(host);

    return {
      ref: host.ref,
      state: host.state,
      pendingRequests: [...host.pendingRequests.values()],
    };
  }

  async attach(
    sessionId: string,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentSessionHandle | null> {
    const host = this.hosts.get(sessionId);
    if (host) {
      if (onStreamEvent) {
        host.streamHandlers.push(onStreamEvent);
      }
      return {
        ref: host.ref,
        state: host.state,
        pendingRequests: [...host.pendingRequests.values()],
      };
    }

    const handle = await this.reconnect(sessionId);
    if (handle && onStreamEvent) {
      const restored = this.hosts.get(sessionId);
      if (restored) {
        restored.streamHandlers.push(onStreamEvent);
      }
    }
    return handle;
  }

  async reconnect(sessionId: string): Promise<AgentSessionHandle | null> {
    const host = this.hosts.get(sessionId);
    if (!host) {
      const snap = this.registry.get(sessionId);
      if (!snap || snap.reconnect?.type !== 'remote') {
        return null;
      }

      if (snap.reconnect.leaseExpiresAt && new Date(snap.reconnect.leaseExpiresAt) < new Date()) {
        return null;
      }

      if (!this.transportFactory) {
        return null;
      }

      const ref = snap.ref;
      const meta = snap.reconnect;
      const transport = await this.transportFactory(ref, meta);
      const restored = this.createHost(ref, meta, transport);
      for (const pr of snap.pendingRequests) {
        restored.pendingRequests.set(pr.requestId, pr);
      }
      restored.state = 'reconnecting';
      this.hosts.set(sessionId, restored);
      this.wireTransport(restored, transport);
      restored.state = 'running';

      await this.persistSnapshot(restored);
      return {
        ref: restored.ref,
        state: restored.state,
        pendingRequests: [...restored.pendingRequests.values()],
      };
    }

    if (host.transport) {
      return {
        ref: host.ref,
        state: host.state,
        pendingRequests: [...host.pendingRequests.values()],
      };
    }

    if (!this.transportFactory) {
      return null;
    }

    host.state = 'reconnecting';
    const transport = await this.transportFactory(host.ref, host.reconnectMeta);
    host.transport = transport;
    this.wireTransport(host, transport);
    host.state = 'running';

    await this.persistSnapshot(host);
    return {
      ref: host.ref,
      state: host.state,
      pendingRequests: [...host.pendingRequests.values()],
    };
  }

  async sendHumanResponse(
    sessionId: string,
    requestId: string,
    response: SessionResponsePayload,
  ): Promise<boolean> {
    const host = this.hosts.get(sessionId);
    if (!host?.transport) {
      return false;
    }

    const pending = host.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    if (pending.kind === 'permission') {
      host.transport.send(
        createProtocolMessage(
          'permission_response',
          { granted: response.granted === true, reason: response.reason },
          requestId,
        ),
      );
    } else {
      host.transport.send(
        createProtocolMessage(
          'clarification_response',
          { answer: response.answer ?? '' },
          requestId,
        ),
      );
    }

    host.pendingRequests.delete(requestId);
    if (host.pendingRequests.size === 0 && host.state === 'awaiting_human') {
      host.state = 'running';
    }
    await this.persistSnapshot(host);
    return true;
  }

  async pause(sessionId: string): Promise<boolean> {
    const host = this.hosts.get(sessionId);
    if (!host || isTerminal(host.state)) {
      return false;
    }
    host.state = 'paused';
    this.stopHeartbeat(host);
    if (host.transport) {
      host.transport.close();
      host.transport = null;
    }
    await this.persistSnapshot(host);
    return true;
  }

  async abort(sessionId: string, reason: string): Promise<boolean> {
    const host = this.hosts.get(sessionId);
    if (!host) {
      return false;
    }
    host.state = 'aborted';
    this.stopHeartbeat(host);
    if (host.transport) {
      host.transport.send(createProtocolMessage('abort', { reason }));
      host.transport.close();
      host.transport = null;
    }
    const abortErr = `Session aborted: ${reason}`;
    host.resultResolve?.({
      status: 'failure',
      error: abortErr,
      durationMs: Date.now() - host.startTime,
    });
    host.resultResolve = undefined;
    this.resolveAdvance(host, { kind: 'failed', error: abortErr });
    await this.persistSnapshot(host);
    return true;
  }

  async finalize(sessionId: string): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (host) {
      this.stopHeartbeat(host);
      if (host.transport) {
        host.transport.close();
        host.transport = null;
      }
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

    if (isTerminal(host.state)) {
      if (host.state === 'completed') {
        return {
          kind: 'completed',
          artifactContent: host.finalArtifact,
          durationMs: Date.now() - host.startTime,
        };
      }
      return { kind: 'failed', error: 'Session already terminated' };
    }

    if (host.state === 'awaiting_human' && host.pendingRequests.size > 0) {
      const first = [...host.pendingRequests.values()][0];
      return { kind: 'awaiting_human', pendingRequest: first };
    }

    const result = await new Promise<SessionAdvanceResult>((resolve) => {
      host.advanceResolve = resolve;
    });
    await this.persistSnapshot(host);
    return result;
  }

  isLeaseExpired(sessionId: string): boolean {
    const host = this.hosts.get(sessionId);
    const meta = host?.reconnectMeta;
    if (!meta?.leaseExpiresAt) {
      return false;
    }
    return new Date(meta.leaseExpiresAt) < new Date();
  }

  getHost(sessionId: string): RemoteSessionHost | undefined {
    return this.hosts.get(sessionId);
  }

  private createHost(
    ref: AgentSessionRef,
    reconnectMeta: RemoteReconnectMeta,
    transport: WebSocketProtocolTransport | null,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): RemoteSessionHost {
    let resultResolve: ((result: RemoteSessionResult) => void) | undefined;
    const resultPromise = new Promise<RemoteSessionResult>((resolve) => {
      resultResolve = resolve;
    });

    const host: RemoteSessionHost = {
      ref,
      reconnectMeta,
      state: 'running',
      pendingRequests: new Map(),
      transport,
      lastProtocolTimestamp: new Date().toISOString(),
      startTime: Date.now(),
      streamHandlers: onStreamEvent ? [onStreamEvent] : [],
      resultResolve,
      resultPromise,
    };

    if (reconnectMeta.heartbeatIntervalMs && reconnectMeta.heartbeatIntervalMs > 0) {
      this.startHeartbeat(host, reconnectMeta.heartbeatIntervalMs);
    }

    return host;
  }

  private wireTransport(host: RemoteSessionHost, transport: WebSocketProtocolTransport): void {
    transport.onMessage((_msg: ProtocolMessage) => {
      const message = _msg as AgentToOrchestratorMessage;
      host.lastProtocolTimestamp = message.timestamp;

      switch (message.type) {
        case 'handshake':
          break;
        case 'progress':
          this.emitStream(host, {
            timestamp: message.timestamp,
            type: 'status',
            content: formatProgress(message),
            structuredData: {
              messageType: 'progress',
              phase: message.payload.phase,
              detail: message.payload.detail,
              percent: message.payload.percent,
            },
          });
          break;
        case 'log':
          this.emitStream(host, {
            timestamp: message.timestamp,
            type: message.payload.level === 'error' ? 'stderr' : 'stdout',
            content: `[${message.payload.level}] ${message.payload.message}`,
            structuredData: {
              messageType: 'log',
              level: message.payload.level,
              message: message.payload.message,
            },
          });
          break;
        case 'artifact': {
          if (message.payload.isFinal) {
            host.finalArtifact = message.payload.content;
          } else {
            host.finalArtifact ??= message.payload.content;
          }
          break;
        }
        case 'permission_request':
          this.handlePermissionRequest(host, message);
          break;
        case 'clarification_request':
          this.handleClarificationRequest(host, message);
          break;
        case 'done': {
          host.state = 'completed';
          this.stopHeartbeat(host);
          const doneArtifact =
            host.finalArtifact ?? JSON.stringify({ summary: message.payload.summary });
          const doneDur = Date.now() - host.startTime;
          host.resultResolve?.({
            status: 'success',
            artifactContent: doneArtifact,
            durationMs: doneDur,
          });
          host.resultResolve = undefined;
          this.resolveAdvance(host, {
            kind: 'completed',
            artifactContent: doneArtifact,
            durationMs: doneDur,
          });
          break;
        }
        case 'error': {
          host.state = 'failed';
          this.stopHeartbeat(host);
          const errMsg = `Agent error [${message.payload.code}]: ${message.payload.message}`;
          host.resultResolve?.({
            status: 'failure',
            error: errMsg,
            durationMs: Date.now() - host.startTime,
          });
          host.resultResolve = undefined;
          this.resolveAdvance(host, { kind: 'failed', error: errMsg });
          break;
        }
        default: {
          const _exhaustive: never = message;
          throw new Error(
            `Unhandled message type: ${(_exhaustive as AgentToOrchestratorMessage).type}`,
          );
        }
      }
    });

    transport.onError(() => {
      if (!isTerminal(host.state)) {
        host.state = 'reconnecting';
        host.transport = null;
      }
    });
  }

  private handlePermissionRequest(
    host: RemoteSessionHost,
    message: PermissionRequestMessage,
  ): void {
    const pending: SessionPendingRequest = {
      requestId: message.messageId,
      kind: 'permission',
      createdAt: message.timestamp,
      payload: payloadToRecord(message.payload) as PermissionPayload,
    };
    host.pendingRequests.set(message.messageId, pending);
    host.state = 'awaiting_human';
    this.resolveAdvance(host, { kind: 'awaiting_human', pendingRequest: pending });

    this.emitStream(host, {
      timestamp: message.timestamp,
      type: 'permission_request',
      content: `Permission request: ${message.payload.action} ${message.payload.resource} (${message.payload.riskLevel} risk)`,
      structuredData: {
        messageType: 'permission_request',
        ...payloadToRecord(message.payload),
      },
      requestMessageId: message.messageId,
    });
  }

  private handleClarificationRequest(
    host: RemoteSessionHost,
    message: ClarificationRequestMessage,
  ): void {
    const pending: SessionPendingRequest = {
      requestId: message.messageId,
      kind: 'clarification',
      createdAt: message.timestamp,
      payload: payloadToRecord(message.payload) as ClarificationPayload,
    };
    host.pendingRequests.set(message.messageId, pending);
    host.state = 'awaiting_human';
    this.resolveAdvance(host, { kind: 'awaiting_human', pendingRequest: pending });

    this.emitStream(host, {
      timestamp: message.timestamp,
      type: 'clarification_request',
      content: `Clarification needed: ${message.payload.question}`,
      structuredData: payloadToRecord(message.payload),
      requestMessageId: message.messageId,
    });
  }

  private resolveAdvance(host: RemoteSessionHost, result: SessionAdvanceResult): void {
    if (host.advanceResolve) {
      host.advanceResolve(result);
      host.advanceResolve = undefined;
    }
  }

  private emitStream(host: RemoteSessionHost, event: AgentOutputStreamEvent): void {
    for (const handler of host.streamHandlers) {
      try {
        handler(event);
      } catch {
        // swallow handler errors
      }
    }
  }

  private startHeartbeat(host: RemoteSessionHost, intervalMs: number): void {
    host.heartbeatTimer = setInterval(() => {
      if (isTerminal(host.state)) {
        this.stopHeartbeat(host);
        return;
      }
      if (this.isLeaseExpired(host.ref.sessionId)) {
        host.state = 'failed';
        this.stopHeartbeat(host);
        const leaseErr = 'Remote session lease expired';
        host.resultResolve?.({
          status: 'failure',
          error: leaseErr,
          durationMs: Date.now() - host.startTime,
        });
        host.resultResolve = undefined;
        this.resolveAdvance(host, { kind: 'failed', error: leaseErr });
      }
    }, intervalMs);
  }

  private stopHeartbeat(host: RemoteSessionHost): void {
    if (host.heartbeatTimer) {
      clearInterval(host.heartbeatTimer);
      host.heartbeatTimer = undefined;
    }
  }

  private async persistSnapshot(host: RemoteSessionHost): Promise<void> {
    const snapshot = this.buildSnapshot(host);
    await this.registry.register(snapshot);
  }

  private buildSnapshot(host: RemoteSessionHost): AgentSessionSnapshot {
    return {
      ref: host.ref,
      state: host.state,
      pendingRequests: [...host.pendingRequests.values()],
      lastProtocolTimestamp: host.lastProtocolTimestamp,
      reconnect: host.reconnectMeta,
      createdAt: new Date(host.startTime).toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: host.reconnectMeta.leaseExpiresAt,
      workerId: host.ref.sessionId,
    };
  }
}

function isTerminal(state: AgentSessionState): boolean {
  return state === 'completed' || state === 'failed' || state === 'aborted';
}

function formatProgress(message: ProgressMessage): string {
  const pct = message.payload.percent === undefined ? '' : ` (${String(message.payload.percent)}%)`;
  return `[${message.payload.phase}] ${message.payload.detail}${pct}`;
}
