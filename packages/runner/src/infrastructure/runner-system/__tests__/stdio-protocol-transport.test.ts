import { PassThrough } from 'node:stream';

import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage, resetMessageCounter } from '@ai-dev-orchestrator/agent-protocol';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { serializeMessage } from '../protocol-serializer';
import { StdioProtocolTransport } from '../stdio-protocol-transport';

function createMockStreams() {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  const agentStderr = new PassThrough();
  return { toAgent, fromAgent, agentStderr };
}

function writeLine(stream: PassThrough, line: string): void {
  stream.write(line + '\n');
}

function writeMessage(stream: PassThrough, msg: ProtocolMessage): void {
  writeLine(stream, serializeMessage(msg));
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('StdioProtocolTransport', () => {
  let transport: StdioProtocolTransport;
  let streams: ReturnType<typeof createMockStreams>;

  beforeEach(() => {
    resetMessageCounter();
    streams = createMockStreams();
    transport = new StdioProtocolTransport({
      stdin: streams.toAgent,
      stdout: streams.fromAgent,
      stderr: streams.agentStderr,
    });
  });

  afterEach(() => {
    transport.close();
    streams.toAgent.destroy();
    streams.fromAgent.destroy();
    streams.agentStderr.destroy();
  });

  describe('send', () => {
    it('writes JSON lines to stdin', async () => {
      const collected: string[] = [];
      streams.toAgent.on('data', (chunk: Buffer) => {
        collected.push(chunk.toString());
      });

      const msg = createProtocolMessage('abort', { reason: 'test' });
      transport.send(msg);

      await waitMs(10);
      const joined = collected.join('');
      expect(joined).toContain('"type":"abort"');
      expect(joined.endsWith('\n')).toBe(true);
    });

    it('does not write after close', async () => {
      const collected: string[] = [];
      streams.toAgent.on('data', (chunk: Buffer) => {
        collected.push(chunk.toString());
      });

      transport.close();
      transport.send(createProtocolMessage('abort', { reason: 'test' }));

      await waitMs(10);
      expect(collected).toHaveLength(0);
    });
  });

  describe('onMessage', () => {
    it('receives parsed protocol messages from stdout', async () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      const msg = createProtocolMessage('progress', { phase: 'test', detail: 'running' });
      writeMessage(streams.fromAgent, msg);

      await waitMs(20);
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('progress');
      expect(received[0].payload).toEqual({ phase: 'test', detail: 'running' });
    });

    it('receives multiple messages', async () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      writeMessage(
        streams.fromAgent,
        createProtocolMessage('progress', { phase: '1', detail: 'a' }),
      );
      writeMessage(
        streams.fromAgent,
        createProtocolMessage('progress', { phase: '2', detail: 'b' }),
      );

      await waitMs(20);
      expect(received).toHaveLength(2);
    });
  });

  describe('onRawLine', () => {
    it('receives non-protocol lines as raw text', async () => {
      const rawLines: string[] = [];
      transport.onRawLine((line) => rawLines.push(line));

      writeLine(streams.fromAgent, 'Hello, this is plain text output');
      writeLine(streams.fromAgent, 'Another plain line');

      await waitMs(20);
      expect(rawLines).toHaveLength(2);
      expect(rawLines[0]).toBe('Hello, this is plain text output');
    });

    it('does not forward protocol messages as raw lines', async () => {
      const rawLines: string[] = [];
      const messages: ProtocolMessage[] = [];
      transport.onRawLine((line) => rawLines.push(line));
      transport.onMessage((msg) => messages.push(msg));

      writeMessage(streams.fromAgent, createProtocolMessage('done', { summary: 'ok' }));
      writeLine(streams.fromAgent, 'plain text');

      await waitMs(20);
      expect(messages).toHaveLength(1);
      expect(rawLines).toHaveLength(1);
      expect(rawLines[0]).toBe('plain text');
    });
  });

  describe('onStderr', () => {
    it('receives stderr data separately', async () => {
      const stderrData: string[] = [];
      transport.onStderr((data) => stderrData.push(data));

      streams.agentStderr.write('debug output\n');

      await waitMs(20);
      expect(stderrData).toHaveLength(1);
      expect(stderrData[0]).toContain('debug output');
    });
  });

  describe('negotiate', () => {
    it('succeeds when agent sends handshake within timeout', async () => {
      const negotiation = transport.negotiate('session-1', ['file_write'], 2000);

      await waitMs(10);

      const handshake = createProtocolMessage('handshake', {
        capabilities: ['permission_request', 'clarification_request'],
      });
      writeMessage(streams.fromAgent, handshake);

      const capabilities = await negotiation;
      expect(capabilities).toEqual(['permission_request', 'clarification_request']);
    });

    it('sends handshake_ack after receiving handshake', async () => {
      const ackData: string[] = [];
      streams.toAgent.on('data', (chunk: Buffer) => {
        ackData.push(chunk.toString());
      });

      const negotiation = transport.negotiate('session-42');

      await waitMs(10);
      writeMessage(streams.fromAgent, createProtocolMessage('handshake', { capabilities: [] }));

      await negotiation;
      await waitMs(10);

      const combined = ackData.join('');
      expect(combined).toContain('"type":"handshake_ack"');
      expect(combined).toContain('"sessionId":"session-42"');
    });

    it('returns null when handshake times out', async () => {
      const capabilities = await transport.negotiate('session-1', undefined, 50);
      expect(capabilities).toBeNull();
    });

    it('ignores handshake arriving after negotiate timed out (settled guard)', async () => {
      // Negotiate with a very short timeout so it times out
      const capabilities = await transport.negotiate('session-1', undefined, 50);
      expect(capabilities).toBeNull();

      // The handshakeHandler is still in messageHandlers (timeout doesn't remove it).
      // Sending a handshake now should hit the `if (settled) return` guard.
      const ackData: string[] = [];
      streams.toAgent.on('data', (chunk: Buffer) => {
        ackData.push(chunk.toString());
      });

      writeMessage(
        streams.fromAgent,
        createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
      );

      await waitMs(20);
      // No ack should have been sent because negotiate was already settled
      const combined = ackData.join('');
      expect(combined).not.toContain('handshake_ack');
    });

    it('dispatches non-handshake messages to other handlers during negotiation', async () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      const negotiation = transport.negotiate('session-1', undefined, 2000);

      await waitMs(10);

      // Send a non-handshake message during negotiation
      writeMessage(
        streams.fromAgent,
        createProtocolMessage('progress', { phase: 'init', detail: 'setting up' }),
      );

      await waitMs(10);

      // The non-handshake message should be received by regular handlers
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('progress');

      // Now complete the handshake
      writeMessage(streams.fromAgent, createProtocolMessage('handshake', { capabilities: [] }));

      const capabilities = await negotiation;
      expect(capabilities).toEqual([]);
    });

    it('includes permission hints in handshake_ack when provided', async () => {
      const ackData: string[] = [];
      streams.toAgent.on('data', (chunk: Buffer) => {
        ackData.push(chunk.toString());
      });

      const negotiation = transport.negotiate('s1', ['file_write', 'shell_execute']);

      await waitMs(10);
      writeMessage(streams.fromAgent, createProtocolMessage('handshake', { capabilities: [] }));

      await negotiation;
      await waitMs(10);

      const combined = ackData.join('');
      expect(combined).toContain('"permissionHints"');
      expect(combined).toContain('file_write');
    });
  });

  describe('reply correlation', () => {
    it('handshake_ack includes replyTo matching the handshake messageId', async () => {
      const ackData: string[] = [];
      streams.toAgent.on('data', (chunk: Buffer) => {
        ackData.push(chunk.toString());
      });

      const negotiation = transport.negotiate('session-1');
      await waitMs(10);

      const handshake = createProtocolMessage('handshake', { capabilities: [] });
      writeMessage(streams.fromAgent, handshake);

      await negotiation;
      await waitMs(10);

      const combined = ackData.join('');
      const parsed = JSON.parse(combined.trim()) as ProtocolMessage;
      expect(parsed.replyTo).toBe(handshake.messageId);
    });

    it('drops inbound message with invalid replyTo', async () => {
      const received: ProtocolMessage[] = [];
      const rawLines: string[] = [];
      transport.onMessage((msg) => received.push(msg));
      transport.onRawLine((line) => rawLines.push(line));

      // Send a message outbound so we have a known ID
      transport.send(createProtocolMessage('permission_response', { granted: true }, 'req-1'));
      await waitMs(10);

      // Inbound message with replyTo referencing unknown outbound ID
      const bad = createProtocolMessage('done', { summary: 'ok' }, 'unknown-outbound-id');
      writeMessage(streams.fromAgent, bad);
      await waitMs(20);

      expect(received).toHaveLength(0);
      expect(rawLines).toHaveLength(1);
    });

    it('delivers inbound message without replyTo normally', async () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      writeMessage(
        streams.fromAgent,
        createProtocolMessage('progress', { phase: 'a', detail: 'b' }),
      );
      await waitMs(20);

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('progress');
    });
  });

  describe('close', () => {
    it('stops delivering messages after close', async () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      transport.close();

      writeMessage(streams.fromAgent, createProtocolMessage('done', { summary: 'late' }));

      await waitMs(20);
      expect(received).toHaveLength(0);
    });

    it('drops stdout lines arriving after close (line handler early return)', async () => {
      const rawLines: string[] = [];
      const messages: ProtocolMessage[] = [];
      transport.onRawLine((line) => rawLines.push(line));
      transport.onMessage((msg) => messages.push(msg));

      // Let readline attach, then close
      await waitMs(10);
      transport.close();

      // Data still arrives on the stream but should be silently dropped
      writeLine(streams.fromAgent, 'late raw line');
      writeMessage(streams.fromAgent, createProtocolMessage('done', { summary: 'late' }));

      await waitMs(20);
      expect(rawLines).toHaveLength(0);
      expect(messages).toHaveLength(0);
    });

    it('drops stderr data arriving after close', async () => {
      const stderrData: string[] = [];
      transport.onStderr((data) => stderrData.push(data));

      await waitMs(10);
      transport.close();

      streams.agentStderr.write('late stderr data\n');

      await waitMs(20);
      expect(stderrData).toHaveLength(0);
    });
  });

  describe('writeRaw', () => {
    it('writes raw line to stdin with trailing newline', async () => {
      const collected: string[] = [];
      streams.toAgent.on('data', (chunk: Buffer) => {
        collected.push(chunk.toString());
      });

      transport.writeRaw('raw-command --flag');

      await waitMs(10);
      const joined = collected.join('');
      expect(joined).toBe('raw-command --flag\n');
    });

    it('does not double-append newline if line already ends with one', async () => {
      const collected: string[] = [];
      streams.toAgent.on('data', (chunk: Buffer) => {
        collected.push(chunk.toString());
      });

      transport.writeRaw('already-terminated\n');

      await waitMs(10);
      const joined = collected.join('');
      expect(joined).toBe('already-terminated\n');
    });

    it('does not write after close', async () => {
      const collected: string[] = [];
      streams.toAgent.on('data', (chunk: Buffer) => {
        collected.push(chunk.toString());
      });

      transport.close();
      transport.writeRaw('should-not-appear');

      await waitMs(10);
      expect(collected).toHaveLength(0);
    });
  });

  describe('handler error resilience', () => {
    it('swallows message handler errors and continues dispatching', async () => {
      const received: ProtocolMessage[] = [];
      transport.onMessage(() => {
        throw new Error('handler boom');
      });
      transport.onMessage((msg) => received.push(msg));

      writeMessage(
        streams.fromAgent,
        createProtocolMessage('progress', { phase: 'x', detail: 'y' }),
      );

      await waitMs(20);
      // Second handler still received the message despite first throwing
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('progress');
    });

    it('swallows rawLine handler errors and continues dispatching', async () => {
      const rawLines: string[] = [];
      transport.onRawLine(() => {
        throw new Error('raw handler boom');
      });
      transport.onRawLine((line) => rawLines.push(line));

      writeLine(streams.fromAgent, 'some plain text');

      await waitMs(20);
      expect(rawLines).toHaveLength(1);
      expect(rawLines[0]).toBe('some plain text');
    });

    it('swallows stderr handler errors and continues dispatching', async () => {
      const stderrData: string[] = [];
      transport.onStderr(() => {
        throw new Error('stderr handler boom');
      });
      transport.onStderr((data) => stderrData.push(data));

      streams.agentStderr.write('debug info\n');

      await waitMs(20);
      expect(stderrData).toHaveLength(1);
      expect(stderrData[0]).toContain('debug info');
    });
  });

  describe('transport without stderr', () => {
    it('works when no stderr stream is provided', async () => {
      const noStderrTransport = new StdioProtocolTransport({
        stdin: streams.toAgent,
        stdout: streams.fromAgent,
      });

      const received: ProtocolMessage[] = [];
      noStderrTransport.onMessage((msg) => received.push(msg));

      writeMessage(
        streams.fromAgent,
        createProtocolMessage('progress', { phase: 'a', detail: 'b' }),
      );

      await waitMs(20);
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('progress');

      noStderrTransport.close();
    });
  });

  describe('multiple handlers', () => {
    it('dispatches to all registered message handlers', async () => {
      const received1: ProtocolMessage[] = [];
      const received2: ProtocolMessage[] = [];
      transport.onMessage((msg) => received1.push(msg));
      transport.onMessage((msg) => received2.push(msg));

      writeMessage(
        streams.fromAgent,
        createProtocolMessage('progress', { phase: 'a', detail: 'b' }),
      );

      await waitMs(20);
      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('dispatches to all registered rawLine handlers', async () => {
      const lines1: string[] = [];
      const lines2: string[] = [];
      transport.onRawLine((line) => lines1.push(line));
      transport.onRawLine((line) => lines2.push(line));

      writeLine(streams.fromAgent, 'plain text');

      await waitMs(20);
      expect(lines1).toHaveLength(1);
      expect(lines2).toHaveLength(1);
    });

    it('dispatches to all registered stderr handlers', async () => {
      const data1: string[] = [];
      const data2: string[] = [];
      transport.onStderr((d) => data1.push(d));
      transport.onStderr((d) => data2.push(d));

      streams.agentStderr.write('err output\n');

      await waitMs(20);
      expect(data1).toHaveLength(1);
      expect(data2).toHaveLength(1);
    });
  });

  describe('malformed input handling', () => {
    it('forwards malformed JSON as raw line, not crash', async () => {
      const rawLines: string[] = [];
      const messages: ProtocolMessage[] = [];
      transport.onRawLine((line) => rawLines.push(line));
      transport.onMessage((msg) => messages.push(msg));

      writeLine(streams.fromAgent, '{invalid json!!!');
      writeMessage(streams.fromAgent, createProtocolMessage('done', { summary: 'ok' }));

      await waitMs(20);
      expect(rawLines).toHaveLength(1);
      expect(rawLines[0]).toBe('{invalid json!!!');
      expect(messages).toHaveLength(1);
    });

    it('forwards unknown protocol version as raw line', async () => {
      const rawLines: string[] = [];
      transport.onRawLine((line) => rawLines.push(line));

      writeLine(
        streams.fromAgent,
        JSON.stringify({
          protocol: 'wrong/v2',
          messageId: '1',
          timestamp: 't',
          type: 'done',
          payload: {},
        }),
      );

      await waitMs(20);
      expect(rawLines).toHaveLength(1);
    });
  });
});
