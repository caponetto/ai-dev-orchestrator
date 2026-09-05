import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import type {
  HandshakeAckPayload,
  HandshakePayload,
  ProtocolMessage,
} from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import type { PermissionAction } from '@ai-dev-orchestrator/schemas';

import { serializeMessage, deserializeMessage } from './protocol-serializer';

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;

interface StdioTransportStreams {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr?: Readable;
}

export class StdioProtocolTransport {
  private readonly streams: StdioTransportStreams;
  private readonly messageHandlers: ((message: ProtocolMessage) => void)[] = [];
  private readonly stderrHandlers: ((data: string) => void)[] = [];
  private readonly rawLineHandlers: ((line: string) => void)[] = [];
  private readonly outboundIds = new Set<string>();
  private closed = false;
  private lineReader: ReturnType<typeof createInterface> | null = null;

  constructor(streams: StdioTransportStreams) {
    this.streams = streams;
    this.setupStdoutReader();
    this.setupStderrReader();
  }

  send(message: ProtocolMessage): void {
    if (this.closed) {
      return;
    }
    this.outboundIds.add(message.messageId);
    const line = serializeMessage(message) + '\n';
    try {
      this.streams.stdin.write(line);
    } catch {
      // stdin may be closed if subprocess exited
    }
  }

  writeRaw(line: string): void {
    if (this.closed) {
      return;
    }
    try {
      this.streams.stdin.write(line.endsWith('\n') ? line : line + '\n');
    } catch {
      // stdin may be closed if subprocess exited
    }
  }

  onMessage(handler: (message: ProtocolMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onStderr(handler: (data: string) => void): void {
    this.stderrHandlers.push(handler);
  }

  onRawLine(handler: (line: string) => void): void {
    this.rawLineHandlers.push(handler);
  }

  async negotiate(
    sessionId: string,
    permissionHints?: readonly string[],
    timeoutMs: number = DEFAULT_HANDSHAKE_TIMEOUT_MS,
  ): Promise<string[] | null> {
    return new Promise<string[] | null>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, timeoutMs);

      const handshakeHandler = (message: ProtocolMessage) => {
        if (settled) {
          return;
        }
        if (message.type === 'handshake') {
          settled = true;
          clearTimeout(timer);

          const capabilities = (message.payload as HandshakePayload).capabilities;

          const ackPayload: HandshakeAckPayload = {
            sessionId,
            ...(permissionHints
              ? { permissionHints: permissionHints as readonly PermissionAction[] }
              : {}),
          };
          const ack = createProtocolMessage('handshake_ack', ackPayload, message.messageId);

          this.send(ack);

          const idx = this.messageHandlers.indexOf(handshakeHandler);
          if (idx >= 0) {
            this.messageHandlers.splice(idx, 1);
          }

          resolve([...capabilities]);
        }
      };

      this.messageHandlers.push(handshakeHandler);
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.lineReader) {
      this.lineReader.close();
      this.lineReader = null;
    }
    this.messageHandlers.length = 0;
    this.stderrHandlers.length = 0;
    this.rawLineHandlers.length = 0;
  }

  private setupStdoutReader(): void {
    this.lineReader = createInterface({
      input: this.streams.stdout,
      crlfDelay: Infinity,
    });

    this.lineReader.on('line', (line: string) => {
      if (this.closed) {
        return;
      }

      const result = deserializeMessage(line, this.outboundIds);
      if (result.status === 'ok') {
        const msg = result.message;
        for (const handler of this.messageHandlers) {
          try {
            handler(msg);
          } catch {
            // swallow handler errors
          }
        }
      } else {
        for (const handler of this.rawLineHandlers) {
          try {
            handler(line);
          } catch {
            // swallow handler errors
          }
        }
      }
    });
  }

  private setupStderrReader(): void {
    if (!this.streams.stderr) {
      return;
    }
    this.streams.stderr.on('data', (chunk: Buffer) => {
      if (this.closed) {
        return;
      }
      const data = chunk.toString();
      for (const handler of this.stderrHandlers) {
        try {
          handler(data);
        } catch {
          // swallow handler errors
        }
      }
    });
  }
}
