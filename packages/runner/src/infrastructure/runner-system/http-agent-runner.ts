import type {
  AgentToOrchestratorMessage,
  ClarificationRequestMessage,
  PermissionRequestMessage,
  ProtocolMessage,
} from '@ai-orchestrator/agent-protocol';
import { createProtocolMessage, payloadToRecord } from '@ai-orchestrator/agent-protocol';
import { safeJsonParse } from '@ai-orchestrator/artifacts';
import type {
  AgentDispatchResult,
  AgentOutputStreamEvent,
  PermissionContext,
  PermissionPolicy,
  SessionCapableRunner,
} from '@ai-orchestrator/ports';
import type {
  AgentResult,
  AgentSessionRef,
  AgentTask,
  RemoteReconnectMeta,
} from '@ai-orchestrator/schemas';
import {
  liveClarificationResponsePayloadSchema,
  livePermissionResponsePayloadSchema,
  pollResponseSchema,
  submitResponseSchema,
} from '@ai-orchestrator/schemas';
import { getErrorMessage, raceWithTimeout, sleep } from '@ai-orchestrator/utils';
import { z } from 'zod';

import {
  parseSubmitResponse,
  shouldUseProtocolMode,
} from '../../domain/runner-system/http-session-contract';
import type { AgentSessionDescriptor } from '../../domain/runner-system/http-session-contract';

import type { LiveRequestStore } from './file-backed-live-request-store';
import type { RemoteAgentSessionSupervisor } from './remote-agent-session-supervisor';
import { WebSocketProtocolTransport } from './websocket-protocol-transport';
import type { WebSocketLike } from './websocket-protocol-transport';

interface HttpAgentRunnerConfig {
  readonly endpoint: string;
  readonly authHeader?: string;
  readonly pollIntervalMs?: number;
  readonly defaultTimeoutMs?: number;
  readonly liveRequestTimeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_LIVE_REQUEST_TIMEOUT_MS = 300_000;

interface SseStreamEvent {
  readonly type: 'stdout' | 'stderr' | 'status' | 'result';
  readonly content?: string;
  readonly result?: AgentResult;
  readonly timestamp?: string;
}

const sseStreamEventSchema = z
  .object({
    type: z.enum(['stdout', 'stderr', 'status', 'result']),
    content: z.string().optional(),
    result: z
      .object({
        status: z.enum(['success', 'failure', 'timeout']),
        artifactContent: z.string().optional(),
      })
      .loose()
      .optional(),
    timestamp: z.string().optional(),
  })
  .loose();

export class HttpAgentRunner implements SessionCapableRunner {
  private readonly config: HttpAgentRunnerConfig;
  private permissionPolicy?: PermissionPolicy;
  private liveRequestStore?: LiveRequestStore;
  private sessionSupervisor?: RemoteAgentSessionSupervisor;

  constructor(config: HttpAgentRunnerConfig) {
    this.config = config;
  }

  setPermissionPolicy(policy: PermissionPolicy): void {
    this.permissionPolicy = policy;
  }

  setLiveRequestStore(store: LiveRequestStore): void {
    this.liveRequestStore = store;
  }

  setSessionSupervisor(supervisor: RemoteAgentSessionSupervisor): void {
    this.sessionSupervisor = supervisor;
  }

  readonly supportsResumableSessions = true;

  async dispatchWithSession(
    task: AgentTask,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentDispatchResult> {
    if (!this.sessionSupervisor) {
      const result = await this.dispatch(task, onStreamEvent);
      return { kind: 'terminal', result };
    }

    const endpoint = task.agentConfig?.endpoint ?? this.config.endpoint;
    const authHeader = task.agentConfig?.authHeader ?? this.config.authHeader;
    const headers = this.buildHeaders(authHeader);

    let submitRes: Response;
    try {
      submitRes = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(task),
      });
      if (!submitRes.ok) {
        const result = await this.dispatch(task, onStreamEvent);
        return { kind: 'terminal', result };
      }
    } catch {
      const result = await this.dispatch(task, onStreamEvent);
      return { kind: 'terminal', result };
    }

    const contentType = submitRes.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      let body: unknown;
      try {
        body = await submitRes.json();
      } catch {
        body = null;
      }

      if (body) {
        const parseResult = parseSubmitResponse(body);
        if (parseResult.ok && parseResult.parsed.session) {
          const session = parseResult.parsed.session;
          if (shouldUseProtocolMode(session) && session.reconnect) {
            const ref: AgentSessionRef = {
              sessionId: session.sessionId,
              runId: task.runId,
              stateId: task.stateId,
              role: task.role,
              transport: 'remote',
            };

            const reconnectMeta: RemoteReconnectMeta = {
              type: 'remote',
              remoteSessionId: session.sessionId,
              reconnectUrl: session.reconnect.url,
              websocketUrl:
                session.transport?.type === 'websocket' ? session.transport.url : undefined,
              leaseExpiresAt: session.reconnect.leaseExpiresAt,
              heartbeatIntervalMs: session.reconnect.heartbeatIntervalMs,
              authHeader: authHeader,
            };

            let transport: WebSocketProtocolTransport | undefined;
            if (session.transport?.type === 'websocket') {
              const WS = (
                globalThis as unknown as {
                  WebSocket: new (url: string, protocols?: string[]) => WebSocketLike;
                }
              ).WebSocket;
              const authValue = headers['Authorization'];
              const wsUrlWithAuth = authValue
                ? `${session.transport.url}${session.transport.url.includes('?') ? '&' : '?'}auth=${encodeURIComponent(authValue)}`
                : session.transport.url;
              const ws = new WS(wsUrlWithAuth);
              transport = new WebSocketProtocolTransport(ws);
            }

            const handle = await this.sessionSupervisor.createSession(
              ref,
              onStreamEvent,
              reconnectMeta,
              transport,
            );

            return { kind: 'session', handle };
          }
        }
      }
    }

    const result = await this.dispatch(task, onStreamEvent);
    return { kind: 'terminal', result };
  }

  async dispatch(
    task: AgentTask,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const timeoutMs =
      task.constraints.timeout || this.config.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;
    const endpoint = task.agentConfig?.endpoint ?? this.config.endpoint;
    const authHeader = task.agentConfig?.authHeader ?? this.config.authHeader;
    const headers = this.buildHeaders(authHeader);

    let submitRes: Response;
    try {
      submitRes = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(task),
      });

      if (!submitRes.ok) {
        return {
          taskId: task.taskId,
          status: 'failure',
          error: `Submit failed with HTTP ${String(submitRes.status)}: ${await submitRes.text()}`,
          durationMs: Date.now() - startTime,
        };
      }
    } catch (error: unknown) {
      return {
        taskId: task.taskId,
        status: 'failure',
        error: `Submit request failed: ${getErrorMessage(error)}`,
        durationMs: Date.now() - startTime,
      };
    }

    // Try to parse session descriptor for protocol mode
    const contentType = submitRes.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      let body: unknown;
      try {
        body = await submitRes.json();
      } catch {
        body = null;
      }

      if (body) {
        const parseResult = parseSubmitResponse(body);
        if (parseResult.ok && parseResult.parsed.session) {
          const session = parseResult.parsed.session;
          if (shouldUseProtocolMode(session)) {
            return this.runWebSocketProtocolMode(
              task,
              session,
              headers,
              startTime,
              timeoutMs,
              onStreamEvent,
            );
          }
        }

        // Non-protocol JSON response → poll using already-parsed taskId
        if (parseResult.ok) {
          return this.pollForResult(
            task,
            parseResult.parsed.taskId,
            endpoint,
            headers,
            startTime,
            timeoutMs,
            onStreamEvent,
          );
        }

        // Malformed session descriptor — try to extract taskId from raw body
        const taskIdResult = submitResponseSchema.safeParse(body);
        if (taskIdResult.success) {
          return this.pollForResult(
            task,
            taskIdResult.data.taskId,
            endpoint,
            headers,
            startTime,
            timeoutMs,
            onStreamEvent,
          );
        }
      }
    }

    if (contentType.includes('text/event-stream')) {
      return this.consumeSseStream(
        task,
        submitRes,
        endpoint,
        headers,
        startTime,
        timeoutMs,
        onStreamEvent,
      );
    }

    // Non-JSON, non-SSE response — body not yet consumed
    return this.pollForResult(
      task,
      submitRes,
      endpoint,
      headers,
      startTime,
      timeoutMs,
      onStreamEvent,
    );
  }

  private async consumeSseStream(
    task: AgentTask,
    response: Response,
    endpoint: string,
    headers: Record<string, string>,
    startTime: number,
    timeoutMs: number,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentResult> {
    const body = response.body;
    if (!body) {
      return {
        taskId: task.taskId,
        status: 'failure',
        error: 'SSE response has no body',
        durationMs: Date.now() - startTime,
      };
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: AgentResult | null = null;
    let timedOut = false;

    try {
      for (;;) {
        const remainingMs = timeoutMs - (Date.now() - startTime);
        if (remainingMs <= 0) {
          timedOut = true;
          break;
        }

        const readResult = await raceWithTimeout(reader.read(), remainingMs);
        if (readResult === null) {
          timedOut = true;
          break;
        }

        const { done, value } = readResult;
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            continue;
          }
          const payload = line.slice(5).trim();
          if (!payload) {
            continue;
          }

          let parsed: SseStreamEvent;
          try {
            const parseResult = safeJsonParse(payload, sseStreamEventSchema);
            if (!parseResult.success) {
              continue;
            }
            parsed = parseResult.data as SseStreamEvent;
          } catch {
            continue;
          }

          if (parsed.type === 'result' && parsed.result) {
            finalResult = {
              ...parsed.result,
              taskId: task.taskId,
              durationMs: Date.now() - startTime,
            };
          } else if (parsed.content !== undefined) {
            onStreamEvent?.({
              timestamp: parsed.timestamp ?? new Date().toISOString(),
              type: parsed.type as 'stdout' | 'stderr' | 'status',
              content: parsed.content,
            });
          }
        }

        if (finalResult) {
          break;
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    if (finalResult) {
      return finalResult;
    }

    if (timedOut) {
      try {
        await fetch(`${endpoint}/cancel`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ taskId: task.taskId }),
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // best-effort cancel
      }

      return {
        taskId: task.taskId,
        status: 'timeout',
        error: `Agent SSE stream timed out after ${String(timeoutMs)}ms`,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      taskId: task.taskId,
      status: 'failure',
      error: 'SSE stream ended without producing a result',
      durationMs: Date.now() - startTime,
    };
  }

  private async pollForResult(
    task: AgentTask,
    submitResOrTaskId: Response | string,
    endpoint: string,
    headers: Record<string, string>,
    startTime: number,
    timeoutMs: number,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentResult> {
    const pollInterval =
      task.agentConfig?.pollIntervalMs ?? this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    let remoteTaskId: string;
    if (typeof submitResOrTaskId === 'string') {
      remoteTaskId = submitResOrTaskId;
    } else {
      try {
        const submitBodyRaw: unknown = await submitResOrTaskId.json();
        const submitParsed = submitResponseSchema.safeParse(submitBodyRaw);
        if (!submitParsed.success) {
          return {
            taskId: task.taskId,
            status: 'failure',
            error: 'Failed to parse submit response: invalid format',
            durationMs: Date.now() - startTime,
          };
        }
        remoteTaskId = submitParsed.data.taskId;
      } catch (error: unknown) {
        return {
          taskId: task.taskId,
          status: 'failure',
          error: `Failed to parse submit response: ${getErrorMessage(error)}`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    onStreamEvent?.({
      timestamp: new Date().toISOString(),
      type: 'status',
      content: `Task submitted as ${remoteTaskId}`,
    });

    while (Date.now() - startTime < timeoutMs) {
      await sleep(pollInterval);

      try {
        const pollRes = await fetch(`${endpoint}/tasks/${remoteTaskId}`, { headers });

        if (!pollRes.ok) {
          return {
            taskId: task.taskId,
            status: 'failure',
            error: `Poll failed with HTTP ${String(pollRes.status)}: ${await pollRes.text()}`,
            durationMs: Date.now() - startTime,
          };
        }

        const pollBodyRaw: unknown = await pollRes.json();
        const pollParsed = pollResponseSchema.safeParse(pollBodyRaw);
        if (!pollParsed.success) {
          return {
            taskId: task.taskId,
            status: 'failure',
            error: 'Failed to parse poll response: invalid format',
            durationMs: Date.now() - startTime,
          };
        }

        onStreamEvent?.({
          timestamp: new Date().toISOString(),
          type: 'status',
          content: `Poll status: ${pollParsed.data.status}`,
        });

        if (pollParsed.data.status === 'completed' && pollParsed.data.result) {
          return {
            ...pollParsed.data.result,
            taskId: task.taskId,
            durationMs: Date.now() - startTime,
          };
        }

        if (pollParsed.data.status === 'failed') {
          return {
            taskId: task.taskId,
            status: 'failure',
            error: pollParsed.data.error ?? 'Agent task failed',
            durationMs: Date.now() - startTime,
          };
        }
      } catch (error: unknown) {
        return {
          taskId: task.taskId,
          status: 'failure',
          error: `Poll request failed: ${getErrorMessage(error)}`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    try {
      await fetch(`${endpoint}/tasks/${remoteTaskId}/cancel`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // best-effort cancel
    }

    return {
      taskId: task.taskId,
      status: 'timeout',
      error: `Agent timed out after ${String(timeoutMs)}ms`,
      durationMs: Date.now() - startTime,
    };
  }

  private async runWebSocketProtocolMode(
    task: AgentTask,
    session: AgentSessionDescriptor,
    headers: Record<string, string>,
    startTime: number,
    timeoutMs: number,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentResult> {
    const sessionTransport = session.transport;
    const wsUrl = sessionTransport?.type === 'websocket' ? sessionTransport.url : '';

    let ws: WebSocketLike;
    try {
      const WebSocket = (
        globalThis as unknown as {
          WebSocket: new (url: string, protocols?: string[]) => WebSocketLike;
        }
      ).WebSocket;
      const authValue = headers['Authorization'];
      const wsUrlWithAuth = authValue
        ? `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}auth=${encodeURIComponent(authValue)}`
        : wsUrl;
      ws = new WebSocket(wsUrlWithAuth);
    } catch (error: unknown) {
      return {
        taskId: task.taskId,
        status: 'failure',
        error: `WebSocket connection failed: ${getErrorMessage(error)}`,
        durationMs: Date.now() - startTime,
      };
    }

    const transport = new WebSocketProtocolTransport(ws);

    return new Promise<AgentResult>((resolve) => {
      let finalArtifact: string | undefined;
      let resolved = false;

      const finish = (result: AgentResult) => {
        if (resolved) {
          return;
        }
        resolved = true;
        transport.close();
        resolve(result);
      };

      const overallTimer = setTimeout(
        () => {
          finish({
            taskId: task.taskId,
            status: 'timeout',
            error: `Agent timed out after ${String(timeoutMs)}ms`,
            durationMs: Date.now() - startTime,
          });
        },
        timeoutMs - (Date.now() - startTime),
      );

      transport.onMessage((rawMessage: ProtocolMessage) => {
        if (resolved) {
          return;
        }
        if (rawMessage.type === 'handshake_ack') {
          return;
        }
        const message = rawMessage as AgentToOrchestratorMessage;

        switch (message.type) {
          case 'handshake':
            break;
          case 'progress': {
            const p = message.payload;
            const pctStr = p.percent === undefined ? '' : ` (${String(p.percent)}%)`;
            onStreamEvent?.({
              timestamp: message.timestamp,
              type: 'status',
              content: `[${p.phase}] ${p.detail}${pctStr}`,
              structuredData: {
                messageType: 'progress',
                phase: p.phase,
                detail: p.detail,
                percent: p.percent,
              },
            });
            break;
          }
          case 'log': {
            const l = message.payload;
            onStreamEvent?.({
              timestamp: message.timestamp,
              type: l.level === 'error' || l.level === 'warn' ? 'stderr' : 'stdout',
              content: `[${l.level}] ${l.message}`,
              structuredData: {
                messageType: 'log',
                level: l.level,
                message: l.message,
              },
            });
            break;
          }
          case 'artifact': {
            const a = message.payload;
            if (a.isFinal) {
              finalArtifact = a.content;
            } else {
              finalArtifact ??= a.content;
            }
            break;
          }
          case 'permission_request':
            void this.handleHttpPermissionRequest(message, task, transport, onStreamEvent);
            break;
          case 'clarification_request':
            void this.handleHttpClarificationRequest(message, task, transport, onStreamEvent);
            break;
          case 'done': {
            clearTimeout(overallTimer);
            const d = message.payload;
            finish({
              taskId: task.taskId,
              status: 'success',
              artifactContent: finalArtifact ?? JSON.stringify({ summary: d.summary }),
              durationMs: Date.now() - startTime,
            });
            break;
          }
          case 'error': {
            clearTimeout(overallTimer);
            const e = message.payload;
            finish({
              taskId: task.taskId,
              status: 'failure',
              error: `Agent error [${e.code}]: ${e.message}`,
              durationMs: Date.now() - startTime,
            });
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
        clearTimeout(overallTimer);
        finish({
          taskId: task.taskId,
          status: 'failure',
          error: 'WebSocket connection error',
          durationMs: Date.now() - startTime,
        });
      });

      const handshakeTimeoutMs = Math.min(DEFAULT_HANDSHAKE_TIMEOUT_MS, timeoutMs);
      transport
        .negotiate(session.sessionId, undefined, handshakeTimeoutMs)
        .then((capabilities) => {
          if (capabilities === null && !resolved) {
            finish({
              taskId: task.taskId,
              status: 'failure',
              error: 'WebSocket protocol handshake failed — agent did not send handshake message',
              durationMs: Date.now() - startTime,
            });
          }
        })
        .catch(() => {
          // negotiate timeout handled by overall timer
        });
    });
  }

  private async handleHttpPermissionRequest(
    message: PermissionRequestMessage,
    task: AgentTask,
    transport: WebSocketProtocolTransport,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<void> {
    const payload = message.payload;

    if (this.permissionPolicy) {
      const context: PermissionContext = {
        role: task.role,
        runId: task.runId,
        stateId: task.stateId,
        repoRoot: task.repoRoot,
      };
      const decision = this.permissionPolicy.evaluate(payload, context);

      if (decision.action === 'grant') {
        onStreamEvent?.({
          timestamp: message.timestamp,
          type: 'permission_request',
          content: `Permission auto-granted: ${payload.action} ${payload.resource}`,
          structuredData: {
            messageType: 'permission_resolved',
            resolved: 'granted',
            reason: decision.reason,
            ...payloadToRecord(payload),
          },
          requestMessageId: message.messageId,
        });
        transport.send(
          createProtocolMessage(
            'permission_response',
            { granted: true, reason: decision.reason },
            message.messageId,
          ),
        );
        return;
      }

      if (decision.action === 'deny') {
        onStreamEvent?.({
          timestamp: message.timestamp,
          type: 'permission_request',
          content: `Permission denied: ${payload.action} ${payload.resource}`,
          structuredData: {
            messageType: 'permission_resolved',
            resolved: 'denied',
            reason: decision.reason,
            ...payloadToRecord(payload),
          },
          requestMessageId: message.messageId,
        });
        transport.send(
          createProtocolMessage(
            'permission_response',
            { granted: false, reason: decision.reason },
            message.messageId,
          ),
        );
        return;
      }
    }

    onStreamEvent?.({
      timestamp: message.timestamp,
      type: 'permission_request',
      content: `Permission request: ${payload.action} ${payload.resource} (${payload.riskLevel} risk)`,
      structuredData: {
        messageType: 'permission_request',
        ...payloadToRecord(payload),
      },
      requestMessageId: message.messageId,
    });

    if (this.liveRequestStore) {
      const liveTimeout =
        task.agentConfig?.['liveRequestTimeoutMs'] ??
        this.config.liveRequestTimeoutMs ??
        DEFAULT_LIVE_REQUEST_TIMEOUT_MS;
      const now = new Date();
      await this.liveRequestStore.writeRequest({
        runId: task.runId,
        messageId: message.messageId,
        kind: 'permission',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + liveTimeout).toISOString(),
        payload: payloadToRecord(payload),
      });
      const response = await this.liveRequestStore.awaitResponse(
        task.runId,
        message.messageId,
        liveTimeout,
      );
      if (response) {
        const permPayload = livePermissionResponsePayloadSchema.safeParse(response.payload);
        const granted = permPayload.success && permPayload.data.granted === true;
        const reason = permPayload.success ? permPayload.data.reason : undefined;
        transport.send(
          createProtocolMessage('permission_response', { granted, reason }, message.messageId),
        );
      } else {
        await this.liveRequestStore.writeResponse({
          runId: task.runId,
          messageId: message.messageId,
          respondedAt: new Date().toISOString(),
          payload: { timedOut: true, granted: false },
        });
        transport.send(
          createProtocolMessage(
            'permission_response',
            { granted: false, reason: 'Live request timed out' },
            message.messageId,
          ),
        );
      }
      return;
    }

    transport.send(
      createProtocolMessage(
        'permission_response',
        { granted: false, reason: 'No permission policy configured' },
        message.messageId,
      ),
    );
  }

  private async handleHttpClarificationRequest(
    message: ClarificationRequestMessage,
    task: AgentTask,
    transport: WebSocketProtocolTransport,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<void> {
    const payload = message.payload;

    onStreamEvent?.({
      timestamp: message.timestamp,
      type: 'clarification_request',
      content: `Clarification needed: ${payload.question}`,
      structuredData: payloadToRecord(payload),
      requestMessageId: message.messageId,
    });

    if (this.liveRequestStore) {
      const liveTimeout =
        task.agentConfig?.['liveRequestTimeoutMs'] ??
        this.config.liveRequestTimeoutMs ??
        DEFAULT_LIVE_REQUEST_TIMEOUT_MS;
      const now = new Date();
      await this.liveRequestStore.writeRequest({
        runId: task.runId,
        messageId: message.messageId,
        kind: 'clarification',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + liveTimeout).toISOString(),
        payload: payloadToRecord(payload),
      });
      const response = await this.liveRequestStore.awaitResponse(
        task.runId,
        message.messageId,
        liveTimeout,
      );
      if (response) {
        const clarPayload = liveClarificationResponsePayloadSchema.safeParse(response.payload);
        const answer = clarPayload.success ? (clarPayload.data.answer ?? '') : '';
        transport.send(
          createProtocolMessage('clarification_response', { answer }, message.messageId),
        );
      } else {
        await this.liveRequestStore.writeResponse({
          runId: task.runId,
          messageId: message.messageId,
          respondedAt: new Date().toISOString(),
          payload: { timedOut: true, aborted: true },
        });
        transport.send(
          createProtocolMessage('abort', { reason: 'Clarification request timed out' }),
        );
      }
      return;
    }

    transport.send(createProtocolMessage('abort', { reason: 'No live request store configured' }));
  }

  private buildHeaders(authHeaderValue?: string): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeaderValue) {
      const [key, ...rest] = authHeaderValue.split(':');
      if (key && rest.length > 0) {
        headers[key.trim()] = rest.join(':').trim();
      }
    }
    return headers;
  }
}
