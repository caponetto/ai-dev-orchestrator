import type {
  HandshakeAckPayload,
  HandshakePayload,
  ProtocolMessage,
} from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import type { PermissionAction } from '@ai-dev-orchestrator/schemas';

import { serializeMessage, deserializeMessage } from './protocol-serializer';

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(event: 'message', handler: (ev: { data: unknown }) => void): void;
  addEventListener(event: 'close', handler: () => void): void;
  addEventListener(event: 'error', handler: (ev: unknown) => void): void;
  removeEventListener(event: string, handler: (...args: unknown[]) => void): void;
  readonly readyState: number;
}

export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export class WebSocketProtocolTransport {
  private readonly ws: WebSocketLike;
  private readonly messageHandlers: ((message: ProtocolMessage) => void)[] = [];
  private readonly errorHandlers: ((error: unknown) => void)[] = [];
  private readonly outboundIds = new Set<string>();
  private closed = false;
  private readonly negotiations = new Set<() => void>();

  constructor(ws: WebSocketLike) {
    this.ws = ws;
    this.setupListeners();
  }

  send(message: ProtocolMessage): boolean {
    if (this.closed || this.ws.readyState !== WS_READY_STATE.OPEN) {
      return false;
    }
    this.outboundIds.add(message.messageId);
    try {
      this.ws.send(serializeMessage(message));
      return true;
    } catch {
      // WebSocket may be closing
      this.outboundIds.delete(message.messageId);
      return false;
    }
  }

  onMessage(handler: (message: ProtocolMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onError(handler: (error: unknown) => void): void {
    this.errorHandlers.push(handler);
  }

  async negotiate(
    sessionId: string,
    permissionHints?: readonly string[],
    timeoutMs: number = DEFAULT_HANDSHAKE_TIMEOUT_MS,
  ): Promise<string[] | null> {
    if (this.closed) {
      return null;
    }
    return new Promise<string[] | null>((resolve) => {
      let settled = false;
      const finish = (capabilities: string[] | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.negotiations.delete(cancel);
        const idx = this.messageHandlers.indexOf(handshakeHandler);
        if (idx >= 0) {
          this.messageHandlers.splice(idx, 1);
        }
        resolve(capabilities);
      };
      const cancel = () => {
        finish(null);
      };
      const timer = setTimeout(cancel, timeoutMs);
      const handshakeHandler = (message: ProtocolMessage) => {
        if (settled || message.type !== 'handshake') {
          return;
        }
        const capabilities = (message.payload as HandshakePayload).capabilities;
        const ackPayload: HandshakeAckPayload = {
          sessionId,
          ...(permissionHints
            ? { permissionHints: permissionHints as readonly PermissionAction[] }
            : {}),
        };
        const sent = this.send(
          createProtocolMessage('handshake_ack', ackPayload, message.messageId),
        );
        finish(sent ? [...capabilities] : null);
      };
      this.negotiations.add(cancel);
      this.messageHandlers.push(handshakeHandler);
    });
  }

  private cancelNegotiations(): void {
    for (const cancel of this.negotiations) {
      cancel();
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.cancelNegotiations();
    this.messageHandlers.length = 0;
    this.errorHandlers.length = 0;
    try {
      this.ws.close();
    } catch {
      // may already be closed
    }
  }

  private setupListeners(): void {
    this.ws.addEventListener('message', (ev: { data: unknown }) => {
      if (this.closed) {
        return;
      }
      const line = typeof ev.data === 'string' ? ev.data : String(ev.data);
      const result = deserializeMessage(line, this.outboundIds);
      if (result.status === 'ok') {
        const msg = result.message;
        for (const handler of [...this.messageHandlers]) {
          try {
            handler(msg);
          } catch {
            // swallow handler errors
          }
        }
      }
      // invalid_reply messages are silently dropped
    });

    this.ws.addEventListener('close', () => {
      if (this.closed) {
        return;
      }
      this.closed = true;
      this.cancelNegotiations();
      const handlers = [...this.errorHandlers];
      this.messageHandlers.length = 0;
      this.errorHandlers.length = 0;
      for (const handler of handlers) {
        try {
          handler(new Error('Remote WebSocket closed'));
        } catch {
          // One observer must not prevent the others from seeing connection loss.
        }
      }
    });

    this.ws.addEventListener('error', (ev: unknown) => {
      this.cancelNegotiations();
      for (const handler of [...this.errorHandlers]) {
        try {
          handler(ev);
        } catch {
          // swallow handler errors
        }
      }
    });
  }
}
