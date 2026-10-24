import type {
  AgentToOrchestratorMessage,
  ClarificationRequestMessage,
  PermissionRequestMessage,
  ProgressMessage,
  ProtocolMessage,
} from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage, payloadToRecord } from '@ai-dev-orchestrator/agent-protocol';
import type {
  AgentOutputStreamEvent,
  AgentSessionSupervisor,
  SessionAdvanceResult,
  SessionResponsePayload,
} from '@ai-dev-orchestrator/ports';
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
} from '@ai-dev-orchestrator/schemas';
import { agentSessionSnapshotSchema } from '@ai-dev-orchestrator/schemas';

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
  completion?: NonNullable<AgentSessionSnapshot['completion']>;
  completionWrite?: Promise<void>;
  startTime: number;
  streamHandlers: ((event: AgentOutputStreamEvent) => void)[];
  resultResolve?: (result: RemoteSessionResult) => void;
  resultPromise: Promise<RemoteSessionResult>;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  leaseTimer?: ReturnType<typeof setTimeout>;
  reconnectEpoch: number;
  finalizing: boolean;
  reconnectAttempt?: Promise<AgentSessionHandle | null>;
  cancelReconnect?: () => void;
  advanceResolve?: (result: SessionAdvanceResult) => void;
}

type RemoteTransportFactory = (
  ref: AgentSessionRef,
  reconnectMeta: RemoteReconnectMeta,
  signal: AbortSignal,
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

    const previous = this.hosts.get(ref.sessionId);
    if (previous) {
      this.invalidateReconnect(previous);
      this.stopTimers(previous);
      this.disconnect(previous);
      this.resolveAdvance(previous, { kind: 'failed', error: 'Session replaced' });
      previous.resultResolve?.({
        status: 'failure',
        error: 'Session replaced',
        durationMs: Date.now() - previous.startTime,
      });
      previous.resultResolve = undefined;
    }
    const host = this.createHost(ref, reconnectMeta, transport ?? null, onStreamEvent);
    this.hosts.set(ref.sessionId, host);

    if (transport) {
      this.wireTransport(host, transport);
    }

    try {
      await this.persistSnapshot(host);
    } catch (error: unknown) {
      if (this.hosts.get(ref.sessionId) === host) {
        this.invalidateReconnect(host);
        this.stopTimers(host);
        this.disconnect(host);
        if (!isTerminal(host.state)) {
          host.state = 'failed';
          const message = 'Failed to persist remote session setup';
          host.resultResolve?.({
            status: 'failure',
            error: message,
            durationMs: Date.now() - host.startTime,
          });
          host.resultResolve = undefined;
          this.resolveAdvance(host, { kind: 'failed', error: message });
        }
      }
      throw error;
    }

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
    if (host?.finalizing) {
      return null;
    }
    if (host && this.expireHost(host)) {
      await this.persistSnapshot(host);
      return null;
    }
    if (
      host &&
      (isTerminal(host.state) ||
        !this.transportFactory ||
        (host.transport && !host.reconnectAttempt))
    ) {
      if (onStreamEvent) {
        host.streamHandlers.push(onStreamEvent);
      }
      return {
        ref: host.ref,
        state: host.state,
        pendingRequests: [...host.pendingRequests.values()],
      };
    }

    const snapshot = this.registry.get(sessionId);
    if (
      snapshot?.ref.transport === 'remote' &&
      snapshot.state === 'completed' &&
      snapshot.completion
    ) {
      return { ref: snapshot.ref, state: 'completed', pendingRequests: [] };
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
    let host = this.hosts.get(sessionId);
    if (!host) {
      const snapshot = this.registry.get(sessionId);
      if (
        !snapshot ||
        snapshot.reconnect?.type !== 'remote' ||
        isTerminal(snapshot.state) ||
        !this.transportFactory
      ) {
        return null;
      }
      host = this.createHost(snapshot.ref, snapshot.reconnect, null);
      for (const request of snapshot.pendingRequests) {
        host.pendingRequests.set(request.requestId, request);
      }
      host.state = snapshot.state;
      host.startTime = new Date(snapshot.createdAt).getTime();
      host.lastProtocolTimestamp = snapshot.lastProtocolTimestamp;
      // Publish ownership before awaiting the factory so abort/finalize can fence restored sessions.
      this.hosts.set(sessionId, host);
    }
    if (host.finalizing || isTerminal(host.state)) {
      return null;
    }
    if (this.expireHost(host)) {
      await this.persistSnapshot(host);
      return null;
    }
    if (host.reconnectAttempt) {
      return host.reconnectAttempt;
    }
    if (host.transport) {
      return this.handle(host);
    }
    const factory = this.transportFactory;
    if (!factory) {
      return null;
    }

    const owned = host;
    const epoch = ++owned.reconnectEpoch;
    const previousState = owned.state;
    owned.state = 'reconnecting';
    const controller = new AbortController();
    const cancellation = new Promise<null>((resolve) => {
      owned.cancelReconnect = () => {
        resolve(null);
        controller.abort();
      };
    });
    // Start in a microtask so even reentrant factories see the registered attempt.
    const work = Promise.resolve().then(async () => {
      let transport: WebSocketProtocolTransport | undefined;
      try {
        if (!this.ownsAttempt(owned, epoch)) {
          return null;
        }
        transport = await factory(owned.ref, owned.reconnectMeta, controller.signal);
        if (!this.ownsAttempt(owned, epoch) || this.expireHost(owned)) {
          transport.close();
          return null;
        }
        owned.transport = transport;
        owned.state = owned.pendingRequests.size > 0 ? 'awaiting_human' : 'running';
        this.wireTransport(owned, transport);
        await this.persistSnapshot(owned);
        if (
          !this.ownsAttempt(owned, epoch) ||
          owned.transport !== transport ||
          this.expireHost(owned)
        ) {
          return null;
        }
        return this.handle(owned);
      } catch (error: unknown) {
        transport?.close();
        if (!this.ownsAttempt(owned, epoch)) {
          return null;
        }
        owned.transport = null;
        owned.state = previousState;
        throw error;
      }
    });
    // Release callers even if a custom factory ignores cancellation; dispose any late result.
    const attempt = Promise.race([work, cancellation]).finally(() => {
      if (owned.reconnectAttempt === attempt) {
        owned.reconnectAttempt = undefined;
        owned.cancelReconnect = undefined;
      }
    });
    owned.reconnectAttempt = attempt;
    return attempt;
  }

  private handle(host: RemoteSessionHost): AgentSessionHandle {
    return {
      ref: host.ref,
      state: host.state,
      pendingRequests: [...host.pendingRequests.values()],
    };
  }

  private ownsAttempt(host: RemoteSessionHost, epoch: number): boolean {
    return (
      this.hosts.get(host.ref.sessionId) === host &&
      host.reconnectEpoch === epoch &&
      !host.finalizing &&
      !isTerminal(host.state)
    );
  }

  private invalidateReconnect(host: RemoteSessionHost): void {
    host.reconnectEpoch += 1;
    host.cancelReconnect?.();
    host.cancelReconnect = undefined;
    host.reconnectAttempt = undefined;
  }

  private disconnect(host: RemoteSessionHost): void {
    const transport = host.transport;
    host.transport = null;
    transport?.close();
  }

  async sendHumanResponse(
    sessionId: string,
    requestId: string,
    response: SessionResponsePayload,
  ): Promise<boolean> {
    const host = this.hosts.get(sessionId);
    if (!host?.transport || isTerminal(host.state)) {
      return false;
    }

    if (this.expireHost(host)) {
      await this.persistSnapshot(host);
      return false;
    }
    const pending = host.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }
    if (
      pending.kind === 'permission'
        ? typeof response.granted !== 'boolean' || response.answer !== undefined
        : typeof response.answer !== 'string' || response.granted !== undefined
    ) {
      return false;
    }

    let sent: boolean;
    if (pending.kind === 'permission') {
      sent = host.transport.send(
        createProtocolMessage(
          'permission_response',
          { granted: response.granted === true, reason: response.reason },
          requestId,
        ),
      );
    } else {
      sent = host.transport.send(
        createProtocolMessage(
          'clarification_response',
          { answer: response.answer ?? '' },
          requestId,
        ),
      );
    }

    if (!sent) {
      return false;
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
    this.invalidateReconnect(host);
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
    this.invalidateReconnect(host);
    host.state = 'aborted';
    host.pendingRequests.clear();
    this.stopTimers(host);
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
      host.finalizing = true;
      this.invalidateReconnect(host);
      this.stopTimers(host);
      if (host.transport) {
        host.transport.close();
        host.transport = null;
      }
      if (host.completion) {
        await this.persistCompletion(host, host.completion);
      } else {
        await this.persistSnapshot(host);
      }
      if (this.hosts.get(sessionId) === host) {
        this.hosts.delete(sessionId);
      }
    }
  }

  getSnapshot(sessionId: string): Promise<AgentSessionSnapshot | null> {
    const host = this.hosts.get(sessionId);
    if (host) {
      return Promise.resolve(this.buildSnapshot(host));
    }
    const snapshot = this.registry.get(sessionId);
    return Promise.resolve(snapshot?.ref.transport === 'remote' ? snapshot : null);
  }

  getState(sessionId: string): AgentSessionState | null {
    const host = this.hosts.get(sessionId);
    if (host) {
      return host.state;
    }
    const snap = this.registry.get(sessionId);
    return snap?.ref.transport === 'remote' ? snap.state : null;
  }

  listByRun(runId: string): Promise<readonly AgentSessionSnapshot[]> {
    const fromRegistry = this.registry.listByRun(runId);
    const result = new Map<string, AgentSessionSnapshot>();

    for (const snap of fromRegistry) {
      if (snap.ref.transport === 'remote') {
        result.set(snap.ref.sessionId, snap);
      }
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
      const snapshot = this.registry.get(sessionId);
      if (
        snapshot?.ref.transport === 'remote' &&
        snapshot.state === 'completed' &&
        snapshot.completion
      ) {
        return { kind: 'completed', ...snapshot.completion };
      }
      return { kind: 'failed', error: `Session ${sessionId} not found` };
    }

    if (isTerminal(host.state)) {
      if (host.state === 'completed') {
        return host.completion
          ? this.persistCompletion(host, host.completion)
          : { kind: 'failed', error: 'Session completion receipt is unavailable' };
      }
      await this.persistSnapshot(host);
      return { kind: 'failed', error: 'Session already terminated' };
    }

    if (host.state === 'awaiting_human' && host.pendingRequests.size > 0) {
      const first = [...host.pendingRequests.values()][0];
      await this.persistSnapshot(host);
      return { kind: 'awaiting_human', pendingRequest: first };
    }

    const result = await new Promise<SessionAdvanceResult>((resolve) => {
      host.advanceResolve = resolve;
    });
    if (result.kind === 'completed' && host.completion) {
      return this.persistCompletion(host, host.completion);
    }
    await this.persistSnapshot(host);
    return result;
  }

  isLeaseExpired(sessionId: string): boolean {
    const host = this.hosts.get(sessionId);
    const meta = host?.reconnectMeta;
    if (meta?.leaseExpiresAt === undefined) {
      return false;
    }
    const deadline = Date.parse(meta.leaseExpiresAt);
    return !Number.isFinite(deadline) || deadline <= Date.now();
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
      reconnectEpoch: 0,
      finalizing: false,
    };

    if (reconnectMeta.heartbeatIntervalMs && reconnectMeta.heartbeatIntervalMs > 0) {
      this.startHeartbeat(host, reconnectMeta.heartbeatIntervalMs);
    }

    this.scheduleLease(host);
    return host;
  }

  private wireTransport(host: RemoteSessionHost, transport: WebSocketProtocolTransport): void {
    transport.onMessage((_msg: ProtocolMessage) => {
      if (isTerminal(host.state) || host.transport !== transport) {
        return;
      }
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
          host.pendingRequests.clear();
          this.stopTimers(host);
          const doneArtifact =
            host.finalArtifact ?? JSON.stringify({ summary: message.payload.summary });
          host.completion = {
            artifactContent: doneArtifact,
            durationMs: Math.max(0, Date.now() - host.startTime),
            tokenUsage: message.payload.tokenUsage,
          };
          // The transport callback cannot await I/O. Port observers await this same write;
          // rejection is observed there, and an in-memory receipt remains retryable.
          void this.persistCompletion(host, host.completion).catch(() => undefined);
          this.resolveAdvance(host, {
            kind: 'completed',
            ...host.completion,
          });
          break;
        }
        case 'error': {
          host.state = 'failed';
          host.pendingRequests.clear();
          this.stopTimers(host);
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
      if (host.transport === transport && !isTerminal(host.state)) {
        this.invalidateReconnect(host);
        host.state = 'reconnecting';
        this.disconnect(host);
        void this.persistSnapshot(host).catch(() => undefined);
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
      this.expireHost(host);
    }, intervalMs);
  }

  private scheduleLease(host: RemoteSessionHost): void {
    const expiry = host.reconnectMeta.leaseExpiresAt;
    if (expiry === undefined) {
      return;
    }
    const remaining = Date.parse(expiry) - Date.now();
    const delay = Number.isFinite(remaining) ? Math.min(0x7fff_ffff, Math.max(0, remaining)) : 0;
    host.leaseTimer = setTimeout(() => {
      if (
        this.hosts.get(host.ref.sessionId) !== host ||
        host.finalizing ||
        isTerminal(host.state)
      ) {
        return;
      }
      if (!this.expireHost(host)) {
        this.scheduleLease(host);
      }
    }, delay);
  }

  private expireHost(host: RemoteSessionHost): boolean {
    if (isTerminal(host.state) || host.finalizing || !this.isLeaseExpired(host.ref.sessionId)) {
      return false;
    }
    this.invalidateReconnect(host);
    host.state = 'failed';
    host.pendingRequests.clear();
    this.stopTimers(host);
    this.disconnect(host);
    const error = 'Remote session lease expired';
    host.resultResolve?.({
      status: 'failure',
      error,
      durationMs: Math.max(0, Date.now() - host.startTime),
    });
    host.resultResolve = undefined;
    this.resolveAdvance(host, { kind: 'failed', error });
    // Timers cannot await persistence. Port observations retry a failed write explicitly.
    void this.persistSnapshot(host).catch(() => undefined);
    return true;
  }

  private stopTimers(host: RemoteSessionHost): void {
    this.stopHeartbeat(host);
    clearTimeout(host.leaseTimer);
    host.leaseTimer = undefined;
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

  private async persistCompletion(
    host: RemoteSessionHost,
    completion: NonNullable<AgentSessionSnapshot['completion']>,
  ): Promise<SessionAdvanceResult> {
    const receipt = agentSessionSnapshotSchema.shape.completion.unwrap().parse(completion);
    host.completion = receipt;
    const write = host.completionWrite ?? this.persistSnapshot(host);
    host.completionWrite = write;
    try {
      await write;
      if (host.state !== 'completed') {
        return { kind: 'failed', error: 'Session already terminated' };
      }
      host.resultResolve?.({ status: 'success', ...receipt });
      host.resultResolve = undefined;
      return { kind: 'completed', ...receipt };
    } finally {
      if (host.completionWrite === write) {
        host.completionWrite = undefined;
      }
    }
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
      completion: host.completion,
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
