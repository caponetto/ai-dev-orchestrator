import type { ChildProcess } from 'node:child_process';

import type {
  AgentToOrchestratorMessage,
  ClarificationRequestMessage,
  PermissionRequestMessage,
  ProgressMessage,
  ProtocolMessage,
} from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage, payloadToRecord } from '@ai-dev-orchestrator/agent-protocol';
import type { AgentOutputStreamEvent } from '@ai-dev-orchestrator/ports';
import type {
  AgentSessionRef,
  AgentSessionState,
  ClarificationPayload,
  PermissionPayload,
  SessionPendingRequest,
  AgentResult as AgentResultSchema,
} from '@ai-dev-orchestrator/schemas';

import { extractUsageFromRawLine } from './cli-agent-runner';
import type { StdioProtocolTransport } from './stdio-protocol-transport';

interface LocalSessionResult {
  readonly status: AgentResultSchema['status'];
  readonly artifactContent?: string;
  readonly error?: string;
  readonly durationMs: number;
  readonly tokenUsage?: { readonly inputTokens: number; readonly outputTokens: number };
}

type LocalSessionAdvanceResult =
  | {
      readonly kind: 'completed';
      readonly artifactContent?: string;
      readonly durationMs: number;
      readonly tokenUsage?: { readonly inputTokens: number; readonly outputTokens: number };
    }
  | { readonly kind: 'awaiting_human'; readonly pendingRequest: SessionPendingRequest }
  | { readonly kind: 'failed'; readonly error: string };

/**
 * Owns a local subprocess and its protocol transport for a single session.
 * Tracks pending requests, collects artifacts, and can outlive the workflow loop.
 */
export class LocalAgentSessionHost {
  readonly ref: AgentSessionRef;
  private _state: AgentSessionState = 'running';
  private readonly _pendingRequests = new Map<string, SessionPendingRequest>();
  private _lastProtocolTimestamp: string;
  private _finalArtifact: string | undefined;
  private readonly _process: ChildProcess;
  private readonly _transport: StdioProtocolTransport;
  private readonly _startTime: number;
  private readonly _streamHandlers: ((event: AgentOutputStreamEvent) => void)[] = [];
  private _resultResolve?: (result: LocalSessionResult) => void;
  private _resultPromise: Promise<LocalSessionResult>;
  private _overallTimer?: ReturnType<typeof setTimeout>;
  private _advanceResolve?: (result: LocalSessionAdvanceResult) => void;
  private _accInputTokens = 0;
  private _accOutputTokens = 0;
  private _finalTokenUsage?: { inputTokens: number; outputTokens: number };

  constructor(
    ref: AgentSessionRef,
    process: ChildProcess,
    transport: StdioProtocolTransport,
    startTime: number,
  ) {
    this.ref = ref;
    this._process = process;
    this._transport = transport;
    this._startTime = startTime;
    this._lastProtocolTimestamp = new Date().toISOString();
    this._resultPromise = new Promise<LocalSessionResult>((resolve) => {
      this._resultResolve = resolve;
    });

    this.setupMessageHandling();
    this.setupProcessHandling();
  }

  get state(): AgentSessionState {
    return this._state;
  }

  get pendingRequests(): readonly SessionPendingRequest[] {
    return [...this._pendingRequests.values()];
  }

  get lastProtocolTimestamp(): string {
    return this._lastProtocolTimestamp;
  }

  get pid(): number | undefined {
    return this._process.pid;
  }

  get resultPromise(): Promise<LocalSessionResult> {
    return this._resultPromise;
  }

  addStreamHandler(handler: (event: AgentOutputStreamEvent) => void): void {
    this._streamHandlers.push(handler);
  }

  removeStreamHandler(handler: (event: AgentOutputStreamEvent) => void): void {
    const idx = this._streamHandlers.indexOf(handler);
    if (idx >= 0) {
      this._streamHandlers.splice(idx, 1);
    }
  }

  sendHumanResponse(requestId: string, payload: Record<string, unknown>): boolean {
    const pending = this._pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    if (pending.kind === 'permission') {
      this._transport.send(
        createProtocolMessage(
          'permission_response',
          { granted: payload['granted'] === true, reason: payload['reason'] as string | undefined },
          requestId,
        ),
      );
    } else {
      this._transport.send(
        createProtocolMessage(
          'clarification_response',
          { answer: (payload['answer'] as string | undefined) ?? '' },
          requestId,
        ),
      );
    }

    this._pendingRequests.delete(requestId);
    if (this._pendingRequests.size === 0 && this._state === 'awaiting_human') {
      this._state = 'running';
    }
    return true;
  }

  waitForAdvance(): Promise<LocalSessionAdvanceResult> {
    if (this._state === 'completed') {
      return Promise.resolve({
        kind: 'completed',
        artifactContent: this._finalArtifact,
        durationMs: Date.now() - this._startTime,
        tokenUsage: this.getTokenUsage(),
      });
    }
    if (this._state === 'failed' || this._state === 'aborted') {
      return Promise.resolve({ kind: 'failed', error: 'Session already terminated' });
    }
    if (this._state === 'awaiting_human' && this._pendingRequests.size > 0) {
      const first = [...this._pendingRequests.values()][0];
      return Promise.resolve({ kind: 'awaiting_human', pendingRequest: first });
    }
    return new Promise<LocalSessionAdvanceResult>((resolve) => {
      this._advanceResolve = resolve;
    });
  }

  abort(reason: string): void {
    if (this._state === 'completed' || this._state === 'failed' || this._state === 'aborted') {
      return;
    }
    this._state = 'aborted';
    this._transport.send(createProtocolMessage('abort', { reason }));
    const errMsg = `Session aborted: ${reason}`;
    this.finishResult({
      status: 'failure',
      error: errMsg,
      durationMs: Date.now() - this._startTime,
    });
    this.resolveAdvance({ kind: 'failed', error: errMsg });
    this.cleanup();
  }

  setTimeout(timeoutMs: number): void {
    this._overallTimer = setTimeout(() => {
      if (this._state !== 'completed' && this._state !== 'failed' && this._state !== 'aborted') {
        this.finishResult({
          status: 'timeout',
          error: `Session timed out after ${String(timeoutMs)}ms`,
          durationMs: Date.now() - this._startTime,
        });
        this._state = 'failed';
        try {
          this._process.kill('SIGTERM');
        } catch {
          /* already exited */
        }
      }
    }, timeoutMs);
  }

  isAlive(): boolean {
    return this._process.exitCode === null && this._process.signalCode === null;
  }

  private setupMessageHandling(): void {
    this._transport.onMessage((_msg: ProtocolMessage) => {
      const message = _msg as AgentToOrchestratorMessage;
      this._lastProtocolTimestamp = message.timestamp;

      switch (message.type) {
        case 'handshake':
          break;
        case 'progress':
          this.emitStream({
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
          this.emitStream({
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
            this._finalArtifact = message.payload.content;
          } else {
            this._finalArtifact ??= message.payload.content;
          }
          break;
        }
        case 'permission_request':
          this.handlePermissionRequest(message);
          break;
        case 'clarification_request':
          this.handleClarificationRequest(message);
          break;
        case 'done': {
          this.clearTimer();
          this._state = 'completed';
          const doneResult = {
            status: 'success' as const,
            artifactContent:
              this._finalArtifact ?? JSON.stringify({ summary: message.payload.summary }),
            durationMs: Date.now() - this._startTime,
          };
          this.finishResult(doneResult);
          this.resolveAdvance({
            kind: 'completed',
            artifactContent: doneResult.artifactContent,
            durationMs: doneResult.durationMs,
            tokenUsage: this.getTokenUsage(),
          });
          break;
        }
        case 'error': {
          this.clearTimer();
          this._state = 'failed';
          const errMsg = `Agent error [${message.payload.code}]: ${message.payload.message}`;
          this.finishResult({
            status: 'failure',
            error: errMsg,
            durationMs: Date.now() - this._startTime,
          });
          this.resolveAdvance({ kind: 'failed', error: errMsg });
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

    this._transport.onRawLine((line: string) => {
      const lineUsage = extractUsageFromRawLine(line);
      if (lineUsage) {
        if (lineUsage.isFinal) {
          this._finalTokenUsage = {
            inputTokens: lineUsage.inputTokens,
            outputTokens: lineUsage.outputTokens,
          };
        } else {
          this._accInputTokens += lineUsage.inputTokens;
          this._accOutputTokens += lineUsage.outputTokens;
        }
      }
      this.emitStream({
        timestamp: new Date().toISOString(),
        type: 'stdout',
        content: line,
      });
    });

    this._transport.onStderr((data: string) => {
      this.emitStream({
        timestamp: new Date().toISOString(),
        type: 'stderr',
        content: data,
      });
    });
  }

  private setupProcessHandling(): void {
    this._process.on('exit', (code: number | null, signal: string | null) => {
      this.clearTimer();
      if (this._state === 'running' || this._state === 'awaiting_human') {
        if (this._finalArtifact) {
          this._state = 'completed';
          const dur = Date.now() - this._startTime;
          this.finishResult({
            status: 'success',
            artifactContent: this._finalArtifact,
            durationMs: dur,
          });
          this.resolveAdvance({
            kind: 'completed',
            artifactContent: this._finalArtifact,
            durationMs: dur,
            tokenUsage: this.getTokenUsage(),
          });
        } else {
          this._state = 'failed';
          const errMsg = `Agent process exited unexpectedly (code=${String(code ?? 'null')}, signal=${signal ?? 'none'})`;
          this.finishResult({
            status: 'failure',
            error: errMsg,
            durationMs: Date.now() - this._startTime,
          });
          this.resolveAdvance({ kind: 'failed', error: errMsg });
        }
      }
    });
  }

  private handlePermissionRequest(message: PermissionRequestMessage): void {
    const pending: SessionPendingRequest = {
      requestId: message.messageId,
      kind: 'permission',
      createdAt: message.timestamp,
      payload: payloadToRecord(message.payload) as PermissionPayload,
    };
    this._pendingRequests.set(message.messageId, pending);
    this._state = 'awaiting_human';
    this.resolveAdvance({ kind: 'awaiting_human', pendingRequest: pending });

    this.emitStream({
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

  private handleClarificationRequest(message: ClarificationRequestMessage): void {
    const pending: SessionPendingRequest = {
      requestId: message.messageId,
      kind: 'clarification',
      createdAt: message.timestamp,
      payload: payloadToRecord(message.payload) as ClarificationPayload,
    };
    this._pendingRequests.set(message.messageId, pending);
    this._state = 'awaiting_human';
    this.resolveAdvance({ kind: 'awaiting_human', pendingRequest: pending });

    this.emitStream({
      timestamp: message.timestamp,
      type: 'clarification_request',
      content: `Clarification needed: ${message.payload.question}`,
      structuredData: payloadToRecord(message.payload),
      requestMessageId: message.messageId,
    });
  }

  private emitStream(event: AgentOutputStreamEvent): void {
    for (const handler of this._streamHandlers) {
      try {
        handler(event);
      } catch {
        // swallow handler errors
      }
    }
  }

  private resolveAdvance(result: LocalSessionAdvanceResult): void {
    if (this._advanceResolve) {
      this._advanceResolve(result);
      this._advanceResolve = undefined;
    }
  }

  private getTokenUsage(): { inputTokens: number; outputTokens: number } | undefined {
    if (this._finalTokenUsage) {
      return this._finalTokenUsage;
    }
    if (this._accInputTokens > 0 || this._accOutputTokens > 0) {
      return { inputTokens: this._accInputTokens, outputTokens: this._accOutputTokens };
    }
    return undefined;
  }

  private finishResult(result: LocalSessionResult): void {
    if (this._resultResolve) {
      const tokenUsage = result.tokenUsage ?? this.getTokenUsage();
      this._resultResolve(tokenUsage ? { ...result, tokenUsage } : result);
      this._resultResolve = undefined;
    }
  }

  private clearTimer(): void {
    if (this._overallTimer) {
      clearTimeout(this._overallTimer);
      this._overallTimer = undefined;
    }
  }

  private cleanup(): void {
    this.clearTimer();
    this._transport.close();
    try {
      this._process.kill('SIGTERM');
    } catch {
      /* already exited */
    }
  }
}

function formatProgress(message: ProgressMessage): string {
  const pct = message.payload.percent === undefined ? '' : ` (${String(message.payload.percent)}%)`;
  return `[${message.payload.phase}] ${message.payload.detail}${pct}`;
}
