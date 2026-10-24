import { EventEmitter } from 'node:events';

import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import type { AgentSessionStore } from '@ai-dev-orchestrator/ports';
import type { AgentSessionRef, RemoteReconnectMeta } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSessionRegistry } from '../agent-session-registry';
import { CompositeAgentSessionSupervisor } from '../composite-agent-session-supervisor';
import { LocalAgentSessionSupervisor } from '../local-agent-session-supervisor';
import { serializeMessage } from '../protocol-serializer';
import { RemoteAgentSessionSupervisor } from '../remote-agent-session-supervisor';
import type { WebSocketLike } from '../websocket-protocol-transport';
import { WebSocketProtocolTransport } from '../websocket-protocol-transport';

const ref: AgentSessionRef = {
  sessionId: 'session',
  runId: 'run',
  stateId: 'WORK',
  role: 'planner',
  transport: 'remote',
};
const meta: RemoteReconnectMeta = {
  type: 'remote',
  remoteSessionId: 'remote',
  reconnectUrl: 'http://localhost/reconnect',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function connection() {
  const events = new EventEmitter();
  const close = vi.fn();
  const send = vi.fn();
  const socket: WebSocketLike = {
    readyState: 1,
    close,
    send,
    addEventListener: ((event: string, handler: (...args: unknown[]) => void) => {
      events.on(event, handler);
    }) as WebSocketLike['addEventListener'],
    removeEventListener: (event, handler) => {
      events.off(event, handler);
    },
  };
  const transport = new WebSocketProtocolTransport(socket);
  return {
    events,
    close,
    send,
    transport,
    message: (message: ReturnType<typeof createProtocolMessage>) =>
      events.emit('message', { data: serializeMessage(message) }),
  };
}
describe('remote reconnect ownership', () => {
  let supervisor: RemoteAgentSessionSupervisor;
  let registry: AgentSessionRegistry;
  let save: ReturnType<typeof vi.fn<AgentSessionStore['saveSnapshot']>>;
  const supervisors: RemoteAgentSessionSupervisor[] = [];
  beforeEach(() => {
    save = vi.fn().mockResolvedValue(undefined);
    registry = new AgentSessionRegistry({
      saveSnapshot: save,
      loadSnapshot: vi.fn(),
      listByRun: vi.fn(),
      listAll: vi.fn(),
      removeSnapshot: vi.fn(),
    });
    supervisor = new RemoteAgentSessionSupervisor(registry);
    supervisors.push(supervisor);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const instance of supervisors.splice(0)) {
      await instance.finalize(ref.sessionId);
    }
    vi.useRealTimers();
  });
  it.each(['abort', 'pause', 'finalize'])(
    'does not revive a host after %s crosses transport creation',
    async (operation) => {
      await supervisor.createSession(ref, undefined, meta);
      const transport = connection();
      const gate = deferred<WebSocketProtocolTransport>();
      supervisor.setTransportFactory(() => gate.promise);
      const pending = supervisor.reconnect(ref.sessionId);
      await Promise.resolve();
      if (operation === 'abort') {
        await supervisor.abort(ref.sessionId, 'shutdown');
      } else if (operation === 'pause') {
        await supervisor.pause(ref.sessionId);
      } else {
        await supervisor.finalize(ref.sessionId);
      }
      gate.resolve(transport.transport);
      expect(await pending).toBeNull();
      expect(transport.close).toHaveBeenCalledOnce();
      expect(supervisor.getState(ref.sessionId)).toBe(
        operation === 'abort' ? 'aborted' : operation === 'pause' ? 'paused' : 'reconnecting',
      );
    },
  );
  it('coalesces concurrent reconnect and attach calls', async () => {
    await supervisor.createSession(ref, undefined, meta);
    const transport = connection();
    const gate = deferred<WebSocketProtocolTransport>();
    const factory = vi.fn(() => gate.promise);
    supervisor.setTransportFactory(factory);
    const first = supervisor.reconnect(ref.sessionId);
    const second = supervisor.reconnect(ref.sessionId);
    const attached = supervisor.attach(ref.sessionId);
    await Promise.resolve();
    expect(factory).toHaveBeenCalledOnce();
    gate.resolve(transport.transport);
    const handles = await Promise.all([first, second, attached]);
    expect(handles.map((handle) => handle?.state)).toEqual(['running', 'running', 'running']);
  });
  it('observes lease expiry without heartbeat and persists failure', async () => {
    vi.useFakeTimers();
    const transport = connection();
    await supervisor.createSession(
      ref,
      undefined,
      { ...meta, leaseExpiresAt: new Date(Date.now() + 100).toISOString() },
      transport.transport,
    );
    const result = supervisor.getHost(ref.sessionId)?.resultPromise;
    const advance = supervisor.waitForAdvance(ref.sessionId);
    await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.getState(ref.sessionId)).toBe('failed');
    expect(await result).toMatchObject({
      status: 'failure',
      error: 'Remote session lease expired',
    });
    expect(await advance).toMatchObject({ kind: 'failed' });
    expect(registry.get(ref.sessionId)?.state).toBe('failed');
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it('discards a transport when its lease expires during creation', async () => {
    vi.useFakeTimers();
    await supervisor.createSession(ref, undefined, {
      ...meta,
      leaseExpiresAt: new Date(Date.now() + 100).toISOString(),
    });
    const gate = deferred<WebSocketProtocolTransport>();
    const transport = connection();
    supervisor.setTransportFactory(() => gate.promise);
    const pending = supervisor.reconnect(ref.sessionId);
    await vi.advanceTimersByTimeAsync(100);
    gate.resolve(transport.transport);
    expect(await pending).toBeNull();
    expect(supervisor.getState(ref.sessionId)).toBe('failed');
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it.each(['factory', 'snapshot'])('cleans up and retries after %s failure', async (mode) => {
    await supervisor.createSession(ref, undefined, meta);
    const failed = connection();
    const working = connection();
    const error = new Error('unavailable');
    const factory = vi
      .fn()
      .mockResolvedValueOnce(failed.transport)
      .mockResolvedValueOnce(working.transport);
    if (mode === 'factory') {
      factory.mockReset().mockRejectedValueOnce(error).mockResolvedValueOnce(working.transport);
    } else {
      save.mockRejectedValueOnce(error);
    }
    supervisor.setTransportFactory(factory);
    await expect(supervisor.reconnect(ref.sessionId)).rejects.toBe(error);
    expect(supervisor.getHost(ref.sessionId)?.transport).toBeNull();
    expect(supervisor.getState(ref.sessionId)).toBe('running');
    expect(failed.close).toHaveBeenCalledTimes(mode === 'snapshot' ? 1 : 0);
    expect((await supervisor.reconnect(ref.sessionId))?.state).toBe('running');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it.each(['abort', 'finalize', 'replace', 'lease', 'lease-after-write'])(
    'fences %s during snapshot persistence',
    async (mode) => {
      await supervisor.createSession(
        ref,
        undefined,
        mode.startsWith('lease')
          ? { ...meta, leaseExpiresAt: new Date(Date.now() + 1000).toISOString() }
          : meta,
      );
      const old = connection();
      supervisor.setTransportFactory(() => Promise.resolve(old.transport));
      const gate = deferred<undefined>();
      const entered = deferred<undefined>();
      save.mockImplementationOnce(async () => {
        entered.resolve(undefined);
        await gate.promise;
      });
      const pending = supervisor.reconnect(ref.sessionId);
      await entered.promise;
      let changing: Promise<unknown>;
      if (mode === 'abort') {
        changing = supervisor.abort(ref.sessionId, 'stop');
      } else if (mode === 'finalize') {
        changing = supervisor.finalize(ref.sessionId);
      } else if (mode === 'replace') {
        changing = supervisor.createSession(ref, undefined, meta, connection().transport);
      } else {
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 2000);
        changing =
          mode === 'lease-after-write' ? Promise.resolve(null) : supervisor.attach(ref.sessionId);
      }
      gate.resolve(undefined);
      await changing;
      expect(await pending).toBeNull();
      expect(old.close).toHaveBeenCalledOnce();
    },
  );

  it('discards obsolete factory failures without reviving an aborted host', async () => {
    await supervisor.createSession(ref, undefined, meta);
    const gate = deferred<WebSocketProtocolTransport>();
    supervisor.setTransportFactory(() => gate.promise);
    const pending = supervisor.reconnect(ref.sessionId);
    await Promise.resolve();
    await supervisor.abort(ref.sessionId, 'stop');
    gate.reject(new Error('late failure'));
    expect(await pending).toBeNull();
    expect(supervisor.getState(ref.sessionId)).toBe('aborted');
  });

  it('does not enter a factory cancelled before its microtask starts', async () => {
    await supervisor.createSession(ref, undefined, meta);
    const factory = vi.fn();
    supervisor.setTransportFactory(factory);
    const pending = supervisor.reconnect(ref.sessionId);
    await supervisor.abort(ref.sessionId, 'stop');
    expect(await pending).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('makes restored hosts abortable before their factory resolves', async () => {
    await supervisor.createSession(ref, undefined, meta);
    const restarted = new RemoteAgentSessionSupervisor(registry);
    supervisors.push(restarted);
    const late = connection();
    const gate = deferred<WebSocketProtocolTransport>();
    restarted.setTransportFactory(() => gate.promise);
    const pending = restarted.attach(ref.sessionId);
    await Promise.resolve();
    expect(await restarted.abort(ref.sessionId, 'restart shutdown')).toBe(true);
    gate.resolve(late.transport);
    expect(await pending).toBeNull();
    expect(late.close).toHaveBeenCalledOnce();
    expect(registry.get(ref.sessionId)?.state).toBe('aborted');
    // The original process is gone in this scenario: do not let test teardown overwrite new state.
    supervisors.splice(supervisors.indexOf(supervisor), 1);
  });

  it('preserves durable pending permission identity and duration on restore', async () => {
    const original = connection();
    await supervisor.createSession(ref, undefined, meta, original.transport);
    const request = createProtocolMessage('permission_request', {
      action: 'write',
      resource: '/file',
      riskLevel: 'low',
    });
    original.message(request);
    await supervisor.waitForAdvance(ref.sessionId);
    await supervisor.pause(ref.sessionId);
    await supervisor.finalize(ref.sessionId);
    const before = registry.get(ref.sessionId);
    const restarted = new RemoteAgentSessionSupervisor(registry);
    supervisors.push(restarted);
    const reconnected = connection();
    restarted.setTransportFactory(() => Promise.resolve(reconnected.transport));
    const handler = vi.fn();
    expect(await restarted.attach(ref.sessionId, handler)).toMatchObject({
      state: 'awaiting_human',
      pendingRequests: [{ requestId: request.messageId }],
    });
    expect((await restarted.getSnapshot(ref.sessionId))?.createdAt).toBe(before?.createdAt);
    reconnected.message(createProtocolMessage('progress', { phase: 'work', detail: 'ready' }));
    expect(handler).toHaveBeenCalledOnce();
    expect(
      await restarted.sendHumanResponse(ref.sessionId, request.messageId, { granted: true }),
    ).toBe(true);
    expect(reconnected.send).toHaveBeenCalledOnce();
  });

  it('treats remote close as disconnection and persists it before reconnecting', async () => {
    const first = connection();
    await supervisor.createSession(ref, undefined, meta, first.transport);
    first.events.emit('close');
    expect(supervisor.getHost(ref.sessionId)?.transport).toBeNull();
    const second = connection();
    supervisor.setTransportFactory(() => Promise.resolve(second.transport));
    expect((await supervisor.reconnect(ref.sessionId))?.state).toBe('running');
    first.message(createProtocolMessage('done', { summary: 'stale' }));
    expect(supervisor.getState(ref.sessionId)).toBe('running');
    expect(registry.get(ref.sessionId)?.state).toBe('running');
  });

  it.each(['', 'not-a-date'])('fails closed for invalid lease %s', async (leaseExpiresAt) => {
    vi.useFakeTimers();
    await supervisor.createSession(ref, undefined, { ...meta, leaseExpiresAt });
    await vi.advanceTimersByTimeAsync(1);
    expect(supervisor.getState(ref.sessionId)).toBe('failed');
  });

  it.each(['reconnect', 'answer'])(
    'refuses expired connected-session %s before the timer runs',
    async (operation) => {
      vi.useFakeTimers();
      const active = connection();
      await supervisor.createSession(
        ref,
        undefined,
        { ...meta, leaseExpiresAt: new Date(Date.now() + 100).toISOString() },
        active.transport,
      );
      vi.setSystemTime(Date.now() + 100);
      if (operation === 'reconnect') {
        expect(await supervisor.reconnect(ref.sessionId)).toBeNull();
      } else {
        expect(
          await supervisor.sendHumanResponse(ref.sessionId, 'request', { granted: true }),
        ).toBe(false);
      }
      expect(active.close).toHaveBeenCalledOnce();
      expect(registry.get(ref.sessionId)?.state).toBe('failed');
    },
  );

  it('schedules distant leases without overflowing Node timers', async () => {
    vi.useFakeTimers();
    await supervisor.createSession(ref, undefined, {
      ...meta,
      leaseExpiresAt: new Date(Date.now() + 0x7fff_ffff + 100).toISOString(),
    });
    await vi.advanceTimersByTimeAsync(0x7fff_ffff);
    expect(supervisor.getState(ref.sessionId)).toBe('running');
    await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.getState(ref.sessionId)).toBe('failed');
  });

  it('keeps expiry failure retryable after a background storage error', async () => {
    vi.useFakeTimers();
    await supervisor.createSession(ref, undefined, {
      ...meta,
      leaseExpiresAt: new Date(Date.now() + 100).toISOString(),
    });
    save.mockRejectedValueOnce(new Error('disk failed'));
    await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.getState(ref.sessionId)).toBe('failed');
    expect(registry.get(ref.sessionId)?.state).toBe('running');
    expect(await supervisor.waitForAdvance(ref.sessionId)).toMatchObject({ kind: 'failed' });
    expect(registry.get(ref.sessionId)?.state).toBe('failed');
  });

  it('closes a completed attempt if it is replaced during finalization persistence', async () => {
    const old = connection();
    await supervisor.createSession(ref, undefined, meta, old.transport);
    const gate = deferred<undefined>();
    const entered = deferred<undefined>();
    save.mockImplementationOnce(async () => {
      entered.resolve(undefined);
      await gate.promise;
    });
    const finalizing = supervisor.finalize(ref.sessionId);
    await entered.promise;
    expect(await supervisor.attach(ref.sessionId)).toBeNull();
    expect(await supervisor.reconnect(ref.sessionId)).toBeNull();
    const fresh = connection();
    const replacement = supervisor.createSession(ref, undefined, meta, fresh.transport);
    gate.resolve(undefined);
    await Promise.all([finalizing, replacement]);
    expect(supervisor.getHost(ref.sessionId)?.transport).toBe(fresh.transport);
    expect(fresh.close).not.toHaveBeenCalled();
  });
  it('releases callers on abort without waiting for an unresponsive factory', async () => {
    await supervisor.createSession(ref, undefined, meta);
    const gate = deferred<WebSocketProtocolTransport>();
    supervisor.setTransportFactory(() => gate.promise);
    const pending = supervisor.reconnect(ref.sessionId);
    await Promise.resolve();
    await supervisor.abort(ref.sessionId, 'stop');
    expect(await pending).toBeNull();
    const late = connection();
    gate.resolve(late.transport);
    await vi.waitFor(() => {
      expect(late.close).toHaveBeenCalledOnce();
    });
  });
  it('keeps heartbeat monitoring and ignores a queued lease callback after finalization', async () => {
    vi.useFakeTimers();
    const scheduling = vi.spyOn(globalThis, 'setTimeout');
    await supervisor.createSession(ref, undefined, {
      ...meta,
      heartbeatIntervalMs: 10,
      leaseExpiresAt: new Date(Date.now() + 100).toISOString(),
    });
    const lateLease = scheduling.mock.calls.find(([, delay]) => delay === 100)?.[0];
    if (typeof lateLease !== 'function') {
      throw new Error('Expected lease deadline');
    }
    await vi.advanceTimersByTimeAsync(10);
    expect(supervisor.getState(ref.sessionId)).toBe('running');
    await supervisor.finalize(ref.sessionId);
    const writes = save.mock.calls.length;
    lateLease();
    expect(save).toHaveBeenCalledTimes(writes);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('enforces expiry after transport creation even when the lease callback has not run', async () => {
    vi.useFakeTimers();
    await supervisor.createSession(ref, undefined, {
      ...meta,
      leaseExpiresAt: new Date(Date.now() + 100).toISOString(),
    });
    const gate = deferred<WebSocketProtocolTransport>();
    supervisor.setTransportFactory(() => gate.promise);
    const pending = supervisor.reconnect(ref.sessionId);
    await Promise.resolve();
    vi.setSystemTime(Date.now() + 100);
    const late = connection();
    gate.resolve(late.transport);
    expect(await pending).toBeNull();
    expect(late.close).toHaveBeenCalledOnce();
    expect(supervisor.getState(ref.sessionId)).toBe('failed');
    await supervisor.waitForAdvance(ref.sessionId);
    expect(registry.get(ref.sessionId)?.state).toBe('failed');
  });

  it('keeps finalization fenced and retryable after storage fails', async () => {
    const transport = connection();
    await supervisor.createSession(ref, undefined, meta, transport.transport);
    save.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(supervisor.finalize(ref.sessionId)).rejects.toThrow('storage unavailable');
    expect(await supervisor.reconnect(ref.sessionId)).toBeNull();
    expect(transport.close).toHaveBeenCalledOnce();
    await supervisor.finalize(ref.sessionId);
    expect(supervisor.getHost(ref.sessionId)).toBeUndefined();
  });
  it('routes remote advancement and finalization to the owning delegate with a shared registry', async () => {
    const local = new LocalAgentSessionSupervisor(registry);
    const composite = new CompositeAgentSessionSupervisor([local, supervisor]);
    const connected = connection();
    await supervisor.createSession(ref, undefined, meta, connected.transport);
    connected.message(
      createProtocolMessage('permission_request', {
        action: 'write',
        resource: '/file',
        riskLevel: 'low',
      }),
    );
    expect(await composite.waitForAdvance(ref.sessionId)).toMatchObject({ kind: 'awaiting_human' });
    await composite.finalize(ref.sessionId);
    expect(supervisor.getHost(ref.sessionId)).toBeUndefined();
    expect(connected.close).toHaveBeenCalledOnce();
  });

  it('limits registry lookups to the delegate transport', async () => {
    const local = new LocalAgentSessionSupervisor(registry);
    const base = {
      state: 'paused' as const,
      pendingRequests: [],
      lastProtocolTimestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const stdioRef = { ...ref, sessionId: 'stdio', transport: 'stdio' as const };
    await registry.register({ ...base, ref: stdioRef });
    await registry.register({ ...base, ref });
    expect(supervisor.getState('stdio')).toBeNull();
    expect(await supervisor.getSnapshot('stdio')).toBeNull();
    expect(local.getState(ref.sessionId)).toBeNull();
    expect(await local.getSnapshot(ref.sessionId)).toBeNull();
    expect(local.getState('stdio')).toBe('paused');
    expect((await local.getSnapshot('stdio'))?.ref).toEqual(stdioRef);
    expect((await local.listByRun(ref.runId)).map((snapshot) => snapshot.ref.transport)).toEqual([
      'stdio',
    ]);
    expect(
      (await supervisor.listByRun(ref.runId)).map((snapshot) => snapshot.ref.transport),
    ).toEqual(['remote']);
  });
  it('disposes owned deadlines and transports when the initial snapshot fails', async () => {
    vi.useFakeTimers();
    const connected = connection();
    save.mockRejectedValueOnce(new Error('initial save failed'));
    await expect(
      supervisor.createSession(
        ref,
        undefined,
        { ...meta, leaseExpiresAt: new Date(Date.now() + 1000).toISOString() },
        connected.transport,
      ),
    ).rejects.toThrow('initial save failed');
    expect(connected.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(supervisor.getState(ref.sessionId)).toBe('failed');
    expect(await supervisor.waitForAdvance(ref.sessionId)).toMatchObject({ kind: 'failed' });
  });

  it.each(['abort', 'replacement'])(
    'preserves %s when initial setup storage fails late',
    async (mode) => {
      const connected = connection();
      const gate = deferred<undefined>();
      const entered = deferred<undefined>();
      save.mockImplementationOnce(async () => {
        entered.resolve(undefined);
        await gate.promise;
      });
      const creating = supervisor.createSession(ref, undefined, meta, connected.transport);
      await entered.promise;
      const replacement = connection();
      const changing =
        mode === 'abort'
          ? supervisor.abort(ref.sessionId, 'stop')
          : supervisor.createSession(ref, undefined, meta, replacement.transport);
      const failed = expect(creating).rejects.toThrow('late storage failure');
      gate.reject(new Error('late storage failure'));
      await failed;
      await changing;
      expect(supervisor.getState(ref.sessionId)).toBe(mode === 'abort' ? 'aborted' : 'running');
      if (mode === 'replacement') {
        expect(replacement.close).not.toHaveBeenCalled();
      }
      expect(connected.close).toHaveBeenCalledOnce();
    },
  );
});
