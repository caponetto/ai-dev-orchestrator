import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { connectRemoteWebSocket } from '../connect-remote-websocket';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});
async function endpoint(mode: 'stall' | 'disconnect' | 'accept') {
  const sockets = new Set<Duplex>();
  let arrived!: () => void;
  let closed!: () => void;
  const upgrade = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = createServer();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      sockets.delete(socket);
      closed();
    });
  });
  server.on('upgrade', (request, socket) => {
    arrived();
    // Observe EOF on a stalled HTTP upgrade, too.
    socket.resume();
    if (mode === 'disconnect') {
      socket.destroy();
    }
    if (mode === 'accept') {
      const accept = createHash('sha1')
        .update(`${request.headers['sec-websocket-key'] ?? ''}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.on('data', () => socket.end(Buffer.from([0x88, 0])));
    }
    socket.on('end', () => socket.end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      }),
    );
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing server address');
  }
  return {
    meta: {
      type: 'remote' as const,
      remoteSessionId: 'remote',
      reconnectUrl: `ws://127.0.0.1:${String(address.port)}/socket`,
    },
    upgrade,
    disconnected,
  };
}
describe('production factory with native WebSockets', () => {
  it.each(['abort', 'pause', 'finalize', 'timeout'])(
    'releases a stalled production reconnect and naturally exits after %s',
    async (mode) => {
      const server = await endpoint('stall');
      const root = await mkdtemp(join(tmpdir(), 'websocket-connect-'));
      const bundle = process.env['WEBSOCKET_CONNECT_TEST_BUNDLE'];
      const fixture =
        bundle ??
        fileURLToPath(
          new URL('../../test/fixtures/websocket-connect-process.mjs', import.meta.url),
        );
      const child = spawn(
        process.execPath,
        [
          ...(bundle ? [] : ['--import', import.meta.resolve('tsx')]),
          fixture,
          mode,
          root,
          server.meta.reconnectUrl,
        ],
        { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const exited = new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      cleanups.push(async () => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
        await exited;
        await rm(root, { recursive: true, force: true });
      });
      await server.upgrade;
      if (mode !== 'timeout') {
        child.send('cancel');
      }
      expect(await exited, stderr).toBe(0);
      const output: unknown = JSON.parse(stdout);
      expect(output).toEqual({
        outcome:
          mode === 'timeout' ? { error: 'WebSocket connection timed out' } : { handle: null },
        state:
          mode === 'abort'
            ? 'aborted'
            : mode === 'pause'
              ? 'paused'
              : mode === 'finalize'
                ? 'reconnecting'
                : 'running',
      });
      await server.disconnected;
    },
  );
  it('closes a stalled upgrade on cancellation', async () => {
    const server = await endpoint('stall');
    const controller = new AbortController();
    const pending = connectRemoteWebSocket(server.meta, controller.signal);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await server.upgrade;
    controller.abort();
    await rejected;
    await server.disconnected;
  });
  it('closes a stalled upgrade at the establishment deadline', async () => {
    const server = await endpoint('stall');
    const pending = connectRemoteWebSocket(server.meta, undefined, 100);
    const rejected = expect(pending).rejects.toThrow('timed out');
    await server.upgrade;
    await rejected;
    await server.disconnected;
  });
  it('rejects a peer that disconnects before upgrading', async () => {
    const server = await endpoint('disconnect');
    await expect(connectRemoteWebSocket(server.meta)).rejects.toThrow('connection failed');
    await server.disconnected;
  });
  it('transfers a successful connection and closes it when its owner finalizes', async () => {
    const server = await endpoint('accept');
    const controller = new AbortController();
    const transport = await connectRemoteWebSocket(server.meta, controller.signal);
    controller.abort();
    transport.close();
    await server.disconnected;
  });
});
