import type { RemoteReconnectMeta } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectRemoteWebSocket } from '../connect-remote-websocket';

const meta: RemoteReconnectMeta = {
  type: 'remote',
  remoteSessionId: 'remote',
  reconnectUrl: 'ws://localhost/socket',
};
class Socket extends EventTarget {
  readyState = 0;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
}
describe('production remote WebSocket connection', () => {
  let socket: Socket;
  const construct = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    socket = new Socket();
    construct.mockReset().mockImplementation(function () {
      return socket;
    });
    vi.stubGlobal('WebSocket', construct);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('bounds a stalled upgrade and ignores a late open', async () => {
    const result = connectRemoteWebSocket(meta);
    const rejected = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.close).toHaveBeenCalledOnce();
    socket.open();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects close before open and closes only once across error/close/open races', async () => {
    const result = connectRemoteWebSocket(meta);
    const rejected = expect(result).rejects.toThrow('closed before opening');
    socket.dispatchEvent(new Event('close'));
    socket.dispatchEvent(new Event('error'));
    socket.open();
    expect(socket.close).toHaveBeenCalledOnce();
    await rejected;
  });
  it('cancels a pending socket and removes connection and abort listeners', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(socket, 'removeEventListener');
    const removeAbort = vi.spyOn(controller.signal, 'removeEventListener');
    const result = connectRemoteWebSocket(meta, controller.signal);
    const rejected = expect(result).rejects.toThrow('cancelled');
    controller.abort();
    await rejected;
    expect(socket.close).toHaveBeenCalledOnce();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(['open', 'error', 'close']);
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not create a socket for an already cancelled attempt', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(connectRemoteWebSocket(meta, controller.signal)).rejects.toThrow('cancelled');
    expect(construct).not.toHaveBeenCalled();
  });
  it('cleans up after error even when close throws', async () => {
    socket.close.mockImplementation(() => {
      throw new Error('close failed');
    });
    const result = connectRemoteWebSocket(meta);
    const rejected = expect(result).rejects.toThrow('connection failed');
    socket.dispatchEvent(new Event('error'));
    await rejected;
    expect(socket.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('catches cancellation during socket construction', async () => {
    const controller = new AbortController();
    construct.mockImplementation(function () {
      controller.abort();
      return socket;
    });
    await expect(connectRemoteWebSocket(meta, controller.signal)).rejects.toThrow('cancelled');
    expect(socket.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores callbacks already queued before cancellation', async () => {
    const listeners = vi.spyOn(socket, 'addEventListener');
    const controller = new AbortController();
    const pending = connectRemoteWebSocket(meta, controller.signal);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    const queued = [...listeners.mock.calls];
    controller.abort();
    for (const [type, listener] of queued) {
      if (typeof listener === 'function') {
        listener.call(socket, new Event(type));
      }
    }
    await rejected;
    expect(socket.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('propagates constructor errors without allocating timers', async () => {
    construct.mockImplementation(function () {
      throw new Error('invalid URL');
    });
    await expect(connectRemoteWebSocket(meta)).rejects.toThrow('invalid URL');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('hands an open transport to its owner and removes establishment resources', async () => {
    const controller = new AbortController();
    const result = connectRemoteWebSocket(meta, controller.signal);
    socket.open();
    const transport = await result;
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    transport.close();
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it.each([
    [undefined, undefined, 'ws://localhost/socket'],
    [
      'ws://localhost/preferred',
      'Authorization: Bearer a:b',
      'ws://localhost/preferred?auth=Bearer%20a%3Ab',
    ],
    [
      'ws://localhost/path?existing=1',
      'Authorization: token',
      'ws://localhost/path?existing=1&auth=token',
    ],
    [undefined, 'malformed', 'ws://localhost/socket'],
    [undefined, ': ignored', 'ws://localhost/socket'],
    [undefined, 'X-Custom: ignored', 'ws://localhost/socket'],
    [undefined, 'Authorization: ', 'ws://localhost/socket'],
  ])('preserves URL/auth behavior (%s, %s)', async (websocketUrl, authHeader, expected) => {
    const result = connectRemoteWebSocket({ ...meta, websocketUrl, authHeader });
    socket.open();
    (await result).close();
    expect(construct).toHaveBeenCalledWith(expected);
  });
});
