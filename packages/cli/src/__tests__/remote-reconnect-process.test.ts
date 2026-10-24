import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const bundle = process.env['REMOTE_RECONNECT_TEST_BUNDLE'];
const fixture =
  bundle ??
  fileURLToPath(new URL('../../test/fixtures/remote-reconnect-process.mjs', import.meta.url));
interface Result {
  pid: number;
  accepted?: boolean;
  handles?: { state: string; pendingRequests: { requestId: string }[] }[];
  attached?: unknown;
  result?: {
    kind?: string;
    status?: string;
    artifactContent?: string;
    tokenUsage?: { inputTokens: number; outputTokens: number };
  };
  snapshot?: { state: string; pendingRequests: { requestId: string }[] };
}
function frame(body: Buffer): Buffer {
  const header = Buffer.alloc(body.length < 126 ? 2 : 4);
  header[0] = 0x81;
  header[1] = body.length < 126 ? body.length : 126;
  if (body.length >= 126) {
    header.writeUInt16BE(body.length, 2);
  }
  return Buffer.concat([header, body]);
}
async function server() {
  const sockets = new Set<Duplex>();
  let connections = 0;
  let current: Duplex | undefined;
  const http = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (request.url === '/emit' && current) {
        current.write(frame(Buffer.concat(chunks)));
        response.end('ok');
      } else {
        response.writeHead(404);
        response.end();
      }
    });
  });
  http.on('upgrade', (request, socket) => {
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key'] ?? ''}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    connections++;
    current = socket;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 2) {
        let size = buffered[1] & 127;
        let header = 2;
        if (size === 126) {
          if (buffered.length < 4) {
            return;
          }
          size = buffered.readUInt16BE(2);
          header = 4;
        }
        if (size === 127) {
          socket.destroy();
          return;
        }
        if (buffered[1] & 128) {
          header += 4;
        }
        if (buffered.length < header + size) {
          return;
        }
        if ((buffered[0] & 15) === 8) {
          socket.end(Buffer.from([0x88, 0]));
        }
        buffered = buffered.subarray(header + size);
      }
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected local TCP server');
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    connections: () => connections,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }),
      );
    },
  };
}
async function run(mode: string, root: string, url: string): Promise<Result> {
  const args = [
    ...(bundle ? [] : ['--import', import.meta.resolve('tsx')]),
    fixture,
    mode,
    root,
    url,
  ];
  try {
    const result = await execute(process.execPath, args, { timeout: 15000 });
    return JSON.parse(result.stdout) as Result;
  } catch (error: unknown) {
    if (
      mode.startsWith('seed') &&
      error instanceof Error &&
      'code' in error &&
      error.code === 73 &&
      'stdout' in error &&
      typeof error.stdout === 'string'
    ) {
      return JSON.parse(error.stdout) as Result;
    }
    throw error;
  }
}
describe('remote sessions over real WebSockets and fresh processes', () => {
  it.each(['complete', 'abort', 'expire'])(
    'preserves ownership and durable state through %s recovery',
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), 'remote-reconnect-'));
      const remote = await server();
      try {
        const seeded = await run(mode === 'expire' ? 'seed-expiry' : 'seed', root, remote.url);
        expect(seeded.snapshot?.state).toBe('awaiting_human');
        expect(seeded.snapshot?.pendingRequests).toHaveLength(1);
        const recovered = await run(mode, root, remote.url);
        expect(recovered.pid).not.toBe(seeded.pid);
        if (mode === 'complete') {
          expect(recovered.accepted).toBe(true);
          expect(recovered.handles?.map((handle) => handle.state)).toEqual([
            'awaiting_human',
            'awaiting_human',
          ]);
          expect(recovered.handles?.[0].pendingRequests[0].requestId).toBe(
            seeded.snapshot?.pendingRequests[0].requestId,
          );
          expect(recovered.result).toMatchObject({
            kind: 'completed',
            tokenUsage: { inputTokens: 7, outputTokens: 3 },
          });
        } else {
          expect(recovered.handles).toEqual([null, null]);
          expect(recovered.snapshot).toMatchObject({
            state: mode === 'abort' ? 'aborted' : 'failed',
            pendingRequests: [],
          });
        }
        const before = remote.connections();
        expect(before).toBe(2);
        const inspected = await run('inspect', root, remote.url);
        expect(inspected.pid).not.toBe(recovered.pid);
        expect(inspected.snapshot?.state).toBe(
          mode === 'complete' ? 'completed' : mode === 'abort' ? 'aborted' : 'failed',
        );
        expect(remote.connections()).toBe(before);
        if (mode === 'complete') {
          expect(inspected.result).toEqual(recovered.result);
        } else {
          expect(inspected.attached).toBeNull();
        }
      } finally {
        await remote.close();
        await rm(root, { recursive: true, force: true });
      }
    },
    30000,
  );
});
