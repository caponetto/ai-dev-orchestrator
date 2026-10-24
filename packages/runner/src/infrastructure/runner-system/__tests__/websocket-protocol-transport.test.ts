import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { serializeMessage } from '../protocol-serializer';
import { WebSocketProtocolTransport, WS_READY_STATE } from '../websocket-protocol-transport';
import type { WebSocketLike } from '../websocket-protocol-transport';

interface MockWebSocket extends WebSocketLike {
  simulateMessage: (data: string) => void;
  simulateClose: () => void;
  simulateError: (err: unknown) => void;
  sentMessages: string[];
}

function createMockWebSocket(): MockWebSocket {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const sentMessages: string[] = [];
  let readyState: number = WS_READY_STATE.OPEN;

  const mock = {
    get readyState() {
      return readyState;
    },
    send(data: string) {
      sentMessages.push(data);
    },
    close() {
      readyState = WS_READY_STATE.CLOSED;
    },
    addEventListener(event: string, handler: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(handler);
    },
    removeEventListener(event: string, handler: (...args: unknown[]) => void) {
      const arr = listeners[event];
      const idx = arr.indexOf(handler);
      if (idx >= 0) {
        arr.splice(idx, 1);
      }
    },
    simulateMessage(data: string) {
      for (const h of listeners['message'] ?? []) {
        h({ data });
      }
    },
    simulateClose() {
      readyState = WS_READY_STATE.CLOSED;
      for (const h of listeners['close'] ?? []) {
        h();
      }
    },
    simulateError(err: unknown) {
      for (const h of listeners['error'] ?? []) {
        h(err);
      }
    },
    sentMessages,
  };
  return mock as unknown as MockWebSocket;
}

describe('WebSocketProtocolTransport', () => {
  let ws: ReturnType<typeof createMockWebSocket>;
  let transport: WebSocketProtocolTransport;

  beforeEach(() => {
    ws = createMockWebSocket();
    transport = new WebSocketProtocolTransport(ws);
  });

  describe('send', () => {
    it('sends serialized protocol message', () => {
      const msg = createProtocolMessage('done', { summary: 'All done' });
      expect(transport.send(msg)).toBe(true);
      expect(ws.sentMessages).toHaveLength(1);
      expect(ws.sentMessages[0]).toContain('"type":"done"');
    });

    it('does not send after close', () => {
      transport.close();
      const msg = createProtocolMessage('done', { summary: 'Done' });
      expect(transport.send(msg)).toBe(false);
      expect(ws.sentMessages).toHaveLength(0);
    });

    it('does not send when readyState is not OPEN', () => {
      ws.simulateClose(); // sets readyState to CLOSED
      const closedWs = createMockWebSocket();
      // Simulate CONNECTING state by creating a transport before open
      const connectingWs = {
        ...closedWs,
        get readyState() {
          return WS_READY_STATE.CONNECTING;
        },
      } as unknown as MockWebSocket;
      const connectingTransport = new WebSocketProtocolTransport(connectingWs);

      const msg = createProtocolMessage('done', { summary: 'Done' });
      expect(connectingTransport.send(msg)).toBe(false);
      expect(closedWs.sentMessages).toHaveLength(0);
    });

    it('swallows error when ws.send throws', () => {
      const throwingWs = createMockWebSocket();
      // Override send to throw
      throwingWs.send = () => {
        throw new Error('send failed');
      };
      const throwingTransport = new WebSocketProtocolTransport(throwingWs);

      // Should not throw
      expect(() => {
        expect(throwingTransport.send(createProtocolMessage('done', { summary: 'ok' }))).toBe(
          false,
        );
      }).not.toThrow();
    });
  });

  describe('onMessage', () => {
    it('dispatches parsed protocol messages to handlers', () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      const serialized = serializeMessage(
        createProtocolMessage('progress', { phase: 'coding', detail: 'Writing' }),
      );
      ws.simulateMessage(serialized);

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('progress');
    });

    it('ignores non-protocol messages', () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      ws.simulateMessage('not a protocol message');
      expect(received).toHaveLength(0);
    });

    it('does not dispatch after close', () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));
      transport.close();

      const serialized = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
      ws.simulateMessage(serialized);
      expect(received).toHaveLength(0);
    });
  });

  describe('negotiate', () => {
    it('completes handshake and returns capabilities', async () => {
      const negotiatePromise = transport.negotiate('sess-1');

      const handshake = serializeMessage(
        createProtocolMessage('handshake', {
          capabilities: ['permission_request', 'clarification_request'],
        }),
      );
      ws.simulateMessage(handshake);

      const capabilities = await negotiatePromise;
      expect(capabilities).toEqual(['permission_request', 'clarification_request']);
      expect(ws.sentMessages).toHaveLength(1);
      expect(ws.sentMessages[0]).toContain('handshake_ack');
      expect(ws.sentMessages[0]).toContain('sess-1');
    });

    it('returns null on timeout', async () => {
      const capabilities = await transport.negotiate('sess-1', undefined, 100);
      expect(capabilities).toBeNull();
    });

    it('ignores handshake arriving after negotiate timed out (settled guard)', async () => {
      // Negotiate with a very short timeout so it times out
      const capabilities = await transport.negotiate('sess-1', undefined, 50);
      expect(capabilities).toBeNull();

      // Timed-out negotiation must not acknowledge a later handshake.
      ws.simulateMessage(
        serializeMessage(
          createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
        ),
      );

      // No ack should have been sent because negotiate was already settled
      expect(ws.sentMessages).toHaveLength(0);
    });

    it('does not resolve on non-handshake messages during negotiation', async () => {
      const negotiatePromise = transport.negotiate('sess-1', undefined, 200);

      // Send a non-handshake message - should not resolve negotiate
      ws.simulateMessage(
        serializeMessage(createProtocolMessage('progress', { phase: 'a', detail: 'b' })),
      );

      // No ack should have been sent yet
      expect(ws.sentMessages).toHaveLength(0);

      // Now send actual handshake to complete negotiation
      ws.simulateMessage(
        serializeMessage(createProtocolMessage('handshake', { capabilities: [] })),
      );

      const capabilities = await negotiatePromise;
      expect(capabilities).toEqual([]);
    });

    it('includes permissionHints in handshake_ack when provided', async () => {
      const negotiatePromise = transport.negotiate('sess-1', ['file_write', 'shell_execute']);

      ws.simulateMessage(
        serializeMessage(createProtocolMessage('handshake', { capabilities: [] })),
      );

      await negotiatePromise;

      const ack = JSON.parse(ws.sentMessages[0]) as ProtocolMessage;
      expect(ack.type).toBe('handshake_ack');
      expect((ack.payload as Record<string, unknown>)['permissionHints']).toEqual([
        'file_write',
        'shell_execute',
      ]);
    });
  });

  describe('negotiation resource cleanup', () => {
    it.each(['local close', 'remote close', 'error'])(
      'settles immediately on %s',
      async (event) => {
        vi.useFakeTimers();
        try {
          const resolved = vi.fn();
          const pending = transport.negotiate('session').then(resolved);
          if (event === 'local close') {
            transport.close();
          } else if (event === 'remote close') {
            ws.simulateClose();
          } else {
            ws.simulateError(new Error('offline'));
          }
          await vi.advanceTimersByTimeAsync(0);
          expect(resolved).toHaveBeenCalledWith(null);
          expect(vi.getTimerCount()).toBe(0);
          await pending;
        } finally {
          vi.useRealTimers();
        }
      },
    );
    it('does not allocate a timer after closure', async () => {
      vi.useFakeTimers();
      try {
        transport.close();
        const resolved = vi.fn();
        void transport.negotiate('session').then(resolved);
        await vi.advanceTimersByTimeAsync(0);
        expect(resolved).toHaveBeenCalledWith(null);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
    it('does not acknowledge success when sending the acknowledgement fails', async () => {
      ws.send = () => {
        throw new Error('offline');
      };
      const pending = transport.negotiate('session');
      ws.simulateMessage(
        serializeMessage(createProtocolMessage('handshake', { capabilities: [] })),
      );
      expect(await pending).toBeNull();
    });
    it('keeps cancellation terminal if acknowledgement triggers a connection error', async () => {
      ws.send = () => {
        ws.simulateError(new Error('offline'));
      };
      const pending = transport.negotiate('session');
      ws.simulateMessage(
        serializeMessage(createProtocolMessage('handshake', { capabilities: [] })),
      );
      expect(await pending).toBeNull();
    });
    it('ignores a negotiation callback captured before another observer closed the transport', async () => {
      transport.onMessage(() => {
        transport.close();
      });
      const pending = transport.negotiate('session');
      ws.simulateMessage(
        serializeMessage(createProtocolMessage('handshake', { capabilities: [] })),
      );
      expect(await pending).toBeNull();
      expect(ws.sentMessages).toHaveLength(0);
    });
    it('settles all concurrent negotiations and leaves no timers', async () => {
      vi.useFakeTimers();
      try {
        const first = transport.negotiate('first');
        const second = transport.negotiate('second');
        transport.close();
        expect(await Promise.all([first, second])).toEqual([null, null]);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
    it('does not skip observers registered after a negotiation handler', async () => {
      const pending = transport.negotiate('session');
      const observed = vi.fn();
      transport.onMessage(observed);
      ws.simulateMessage(
        serializeMessage(createProtocolMessage('handshake', { capabilities: [] })),
      );
      await pending;
      expect(observed).toHaveBeenCalledOnce();
    });
  });

  describe('reply correlation', () => {
    it('handshake_ack includes replyTo matching the handshake messageId', async () => {
      const negotiatePromise = transport.negotiate('sess-1');

      const handshake = createProtocolMessage('handshake', { capabilities: [] });
      ws.simulateMessage(serializeMessage(handshake));

      await negotiatePromise;

      const ack = JSON.parse(ws.sentMessages[0]) as ProtocolMessage;
      expect(ack.replyTo).toBe(handshake.messageId);
    });

    it('drops inbound message with invalid replyTo', () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      // Send outbound to register a known ID
      transport.send(createProtocolMessage('permission_response', { granted: true }, 'req-1'));

      // Inbound with replyTo referencing unknown outbound ID
      const bad = createProtocolMessage('done', { summary: 'ok' }, 'unknown-outbound-id');
      ws.simulateMessage(serializeMessage(bad));

      expect(received).toHaveLength(0);
    });

    it('delivers inbound message without replyTo normally', () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      ws.simulateMessage(
        serializeMessage(createProtocolMessage('progress', { phase: 'a', detail: 'b' })),
      );

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('progress');
    });
  });

  describe('handler error resilience', () => {
    it('swallows message handler errors and continues dispatching', () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage(() => {
        throw new Error('handler boom');
      });
      transport.onMessage((msg) => received.push(msg));

      ws.simulateMessage(
        serializeMessage(createProtocolMessage('progress', { phase: 'x', detail: 'y' })),
      );

      // Second handler still received the message despite first throwing
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('progress');
    });

    it('notifies later error observers even when an earlier observer closes the transport', () => {
      const observed = vi.fn();
      transport.onError(() => {
        transport.close();
      });
      transport.onError(observed);
      ws.simulateError(new Error('offline'));
      expect(observed).toHaveBeenCalledOnce();
    });

    it('swallows error handler errors and continues dispatching', () => {
      const errors: unknown[] = [];
      transport.onError(() => {
        throw new Error('error handler boom');
      });
      transport.onError((err) => errors.push(err));

      ws.simulateError(new Error('connection lost'));

      // Second handler still received the error despite first throwing
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe('connection lost');
    });
  });

  describe('non-string WebSocket data', () => {
    it('converts non-string data to string via String()', () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      // simulateMessage always passes a string - we need to invoke the
      // raw message listener with non-string data
      const msg = createProtocolMessage('progress', { phase: 'a', detail: 'b' });
      const serialized = serializeMessage(msg);

      // Create a Buffer-like object that converts to the serialized string
      const bufferLike = {
        toString() {
          return serialized;
        },
      };

      // Access the internal message listener directly through the mock
      // by simulating with non-string data
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const ws2 = {
        get readyState() {
          return WS_READY_STATE.OPEN;
        },
        send: () => {},
        close: () => {},
        addEventListener(event: string, handler: (...args: unknown[]) => void) {
          (listeners[event] ??= []).push(handler);
        },
        removeEventListener: () => {},
      } as unknown as WebSocketLike;
      const transport2 = new WebSocketProtocolTransport(ws2);
      const received2: ProtocolMessage[] = [];
      transport2.onMessage((m) => received2.push(m));

      // Trigger message with non-string data (simulating a Buffer)
      for (const h of listeners['message'] ?? []) {
        h({ data: bufferLike });
      }

      expect(received2).toHaveLength(1);
      expect(received2[0].type).toBe('progress');
    });
  });

  describe('onError', () => {
    it('dispatches errors to handlers', () => {
      const errors: unknown[] = [];
      transport.onError((err) => errors.push(err));

      ws.simulateError(new Error('connection lost'));
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe('connection lost');
    });
  });

  describe('close', () => {
    it('marks transport as closed and closes underlying WebSocket', () => {
      transport.close();
      expect(ws.readyState).toBe(WS_READY_STATE.CLOSED);
    });

    it('is idempotent', () => {
      transport.close();
      transport.close();
      expect(ws.readyState).toBe(WS_READY_STATE.CLOSED);
    });
  });

  describe('WebSocket close event', () => {
    it('notifies all observers once on remote close and ignores deliberate closure', () => {
      const error = vi.fn<(error: unknown) => void>();
      transport.onError(() => {
        throw new Error('observer failed');
      });
      transport.onError(error);
      ws.simulateClose();
      ws.simulateClose();
      expect(error).toHaveBeenCalledOnce();
      expect(error.mock.calls[0][0]).toMatchObject({ message: 'Remote WebSocket closed' });
    });

    it('does not report a locally closed socket as remote failure', () => {
      const error = vi.fn<(error: unknown) => void>();
      transport.onError(error);
      transport.close();
      ws.simulateClose();
      expect(error).not.toHaveBeenCalled();
    });
    it('marks transport as closed on remote close', () => {
      ws.simulateClose();
      const msg = createProtocolMessage('done', { summary: 'Done' });
      transport.send(msg);
      expect(ws.sentMessages).toHaveLength(0);
    });
  });
});
