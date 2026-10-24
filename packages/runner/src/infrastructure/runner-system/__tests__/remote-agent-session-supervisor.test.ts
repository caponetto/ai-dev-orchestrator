import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import type { AgentSessionRef, RemoteReconnectMeta } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSessionRegistry } from '../agent-session-registry';
import { DefaultAgentSessionStore } from '../default-agent-session-store';
import { serializeMessage } from '../protocol-serializer';
import { RemoteAgentSessionSupervisor } from '../remote-agent-session-supervisor';
import type { WebSocketLike } from '../websocket-protocol-transport';
import { WebSocketProtocolTransport, WS_READY_STATE } from '../websocket-protocol-transport';

function createMockWebSocket(): WebSocketLike & EventEmitter & { sentMessages: string[] } {
  const emitter = new EventEmitter() as WebSocketLike & EventEmitter & { sentMessages: string[] };
  emitter.sentMessages = [];
  Object.defineProperty(emitter, 'readyState', { value: WS_READY_STATE.OPEN, writable: true });
  emitter.send = (data: string) => {
    emitter.sentMessages.push(data);
  };
  emitter.close = () => {
    (emitter as unknown as { readyState: number }).readyState = WS_READY_STATE.CLOSED;
  };
  emitter.addEventListener = ((event: string, handler: (...args: unknown[]) => void) => {
    emitter.on(event, handler);
  }) as WebSocketLike['addEventListener'];
  emitter.removeEventListener = (event: string, handler: (...args: unknown[]) => void) => {
    emitter.off(event, handler);
  };
  return emitter;
}

function sendWsMessage(ws: EventEmitter, message: ProtocolMessage): void {
  ws.emit('message', { data: serializeMessage(message) });
}

const REF: AgentSessionRef = {
  sessionId: 'rsess-1',
  runId: 'run-1',
  stateId: 'IMPL',
  role: 'implementer',
  transport: 'remote',
};

const RECONNECT_META: RemoteReconnectMeta = {
  type: 'remote',
  remoteSessionId: 'remote-abc',
  reconnectUrl: 'https://agent.example.com/sessions/remote-abc/reconnect',
  websocketUrl: 'wss://agent.example.com/sessions/remote-abc/ws',
};

describe('RemoteAgentSessionSupervisor', () => {
  let dir: string;
  let store: DefaultAgentSessionStore;
  let registry: AgentSessionRegistry;
  let supervisor: RemoteAgentSessionSupervisor;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'remote-session-supervisor-'));
    store = new DefaultAgentSessionStore(dir);
    registry = new AgentSessionRegistry(store);
    supervisor = new RemoteAgentSessionSupervisor(registry);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await supervisor.finalize(REF.sessionId);
    await rm(dir, { recursive: true, force: true });
  });

  function makeTransport(): {
    ws: ReturnType<typeof createMockWebSocket>;
    transport: WebSocketProtocolTransport;
  } {
    const ws = createMockWebSocket();
    const transport = new WebSocketProtocolTransport(ws);
    return { ws, transport };
  }

  it.each(['immediate', 'pending'] as const)(
    'recovers exact completion after %s advancement and finalization without reconnecting',
    async (mode) => {
      const { ws, transport } = makeTransport();
      await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
      const advancing = mode === 'pending' ? supervisor.waitForAdvance(REF.sessionId) : undefined;
      sendWsMessage(
        ws,
        createProtocolMessage('artifact', {
          artifactType: 'implementation',
          content: '{"final":true}',
          isFinal: true,
        }),
      );
      sendWsMessage(
        ws,
        createProtocolMessage('done', {
          summary: 'finished',
          tokenUsage: { inputTokens: 30, outputTokens: 20 },
        }),
      );
      const result = await (advancing ?? supervisor.waitForAdvance(REF.sessionId));
      expect(result).toMatchObject({
        kind: 'completed',
        artifactContent: '{"final":true}',
        tokenUsage: { inputTokens: 30, outputTokens: 20 },
      });
      await supervisor.finalize(REF.sessionId);
      const restartedRegistry = new AgentSessionRegistry(new DefaultAgentSessionStore(dir));
      await restartedRegistry.rebuild();
      const restarted = new RemoteAgentSessionSupervisor(restartedRegistry);
      const factory = vi.fn(() => Promise.resolve(makeTransport().transport));
      restarted.setTransportFactory(factory);
      expect((await restarted.attach(REF.sessionId))?.state).toBe('completed');
      expect(await restarted.waitForAdvance(REF.sessionId)).toEqual(result);
      expect(factory).not.toHaveBeenCalled();
      expect(
        await restarted.sendHumanResponse(REF.sessionId, 'old-request', { granted: true }),
      ).toBe(false);
    },
  );

  it('retains the done summary on the fast completion path', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    sendWsMessage(ws, createProtocolMessage('done', { summary: 'summary only' }));
    expect(await supervisor.waitForAdvance(REF.sessionId)).toMatchObject({
      kind: 'completed',
      artifactContent: '{"summary":"summary only"}',
    });
  });

  it.each(['completed', 'failed', 'aborted'] as const)(
    'does not invent output or reconnect a legacy %s snapshot without a receipt',
    async (state) => {
      await registry.register({
        ref: REF,
        state,
        pendingRequests: [],
        lastProtocolTimestamp: '',
        reconnect: RECONNECT_META,
        createdAt: '',
        updatedAt: '',
      });
      const factory = vi.fn(() => Promise.resolve(makeTransport().transport));
      supervisor.setTransportFactory(factory);
      expect(await supervisor.attach(REF.sessionId)).toBeNull();
      expect(await supervisor.waitForAdvance(REF.sessionId)).toMatchObject({ kind: 'failed' });
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it('refuses a completed in-memory host without its required receipt', async () => {
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    const host = supervisor.getHost(REF.sessionId);
    if (!host) {
      throw new Error('missing host');
    }
    host.state = 'completed';
    expect(await supervisor.waitForAdvance(REF.sessionId)).toMatchObject({
      kind: 'failed',
      error: 'Session completion receipt is unavailable',
    });
  });

  it('retains a completed host when finalization cannot persist, then retries safely', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    sendWsMessage(ws, createProtocolMessage('done', { summary: 'finished' }));
    const expected = await supervisor.waitForAdvance(REF.sessionId);
    const save = vi
      .spyOn(store, 'saveSnapshot')
      .mockRejectedValueOnce(new Error('finalization unavailable'));
    await expect(supervisor.finalize(REF.sessionId)).rejects.toThrow('finalization unavailable');
    expect(supervisor.getHost(REF.sessionId)).toBeDefined();
    save.mockRestore();
    expect(await supervisor.waitForAdvance(REF.sessionId)).toEqual(expected);
    await supervisor.finalize(REF.sessionId);
    expect(supervisor.getHost(REF.sessionId)).toBeUndefined();
    expect(await supervisor.waitForAdvance(REF.sessionId)).toEqual(expected);
  });

  it('does not expose success until the completion snapshot commits and retries a failed commit', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    const save = vi
      .spyOn(store, 'saveSnapshot')
      .mockRejectedValue(new Error('completion disk unavailable'));
    const advancing = supervisor.waitForAdvance(REF.sessionId);
    sendWsMessage(ws, createProtocolMessage('done', { summary: 'finished' }));
    await expect(advancing).rejects.toThrow('completion disk unavailable');
    expect(registry.get(REF.sessionId)?.state).toBe('running');
    save.mockRestore();
    expect(await supervisor.waitForAdvance(REF.sessionId)).toMatchObject({
      kind: 'completed',
      artifactContent: '{"summary":"finished"}',
    });
    expect((await store.loadSnapshot(REF.sessionId, REF.runId))?.state).toBe('completed');
  });

  it('does not turn cancellation into success while its completion snapshot is pending', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = store.saveSnapshot.bind(store);
    vi.spyOn(store, 'saveSnapshot').mockImplementation(async (snapshot) => {
      if (snapshot.state === 'completed') {
        entered();
        await blocked;
      }
      await save(snapshot);
    });
    const advancing = supervisor.waitForAdvance(REF.sessionId);
    sendWsMessage(ws, createProtocolMessage('done', { summary: 'done' }));
    await started;
    const aborting = supervisor.abort(REF.sessionId, 'stop');
    release();
    expect(await advancing).toMatchObject({ kind: 'failed' });
    await aborting;
    expect(registry.get(REF.sessionId)?.state).toBe('aborted');
  });

  it('preserves frozen duration and observes completion after lease expiry', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { ws, transport } = makeTransport();
    await supervisor.createSession(
      REF,
      undefined,
      { ...RECONNECT_META, leaseExpiresAt: '2020-01-01T00:00:00Z' },
      transport,
    );
    clock.mockReturnValue(1100);
    sendWsMessage(ws, createProtocolMessage('done', { summary: 'done' }));
    expect(await supervisor.waitForAdvance(REF.sessionId)).toMatchObject({ durationMs: 100 });
    await supervisor.finalize(REF.sessionId);
    const restored = new RemoteAgentSessionSupervisor(registry);
    clock.mockReturnValue(9000);
    expect((await restored.attach(REF.sessionId))?.state).toBe('completed');
    expect(await restored.waitForAdvance(REF.sessionId)).toMatchObject({ durationMs: 100 });
  });

  it.each(['done', 'error'] as const)(
    'does not deliver responses or reopen a session after %s',
    async (terminal) => {
      const { ws, transport } = makeTransport();
      await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
      const request = createProtocolMessage('permission_request', {
        action: 'write',
        resource: '/file',
        riskLevel: 'high',
      });
      sendWsMessage(ws, request);
      sendWsMessage(
        ws,
        terminal === 'done'
          ? createProtocolMessage('done', { summary: 'done' })
          : createProtocolMessage('error', {
              code: 'failed',
              message: 'failed',
              recoverable: false,
            }),
      );
      const state = supervisor.getState(REF.sessionId);
      const sent = ws.sentMessages.length;
      expect(
        await supervisor.sendHumanResponse(REF.sessionId, request.messageId, { granted: true }),
      ).toBe(false);
      expect(ws.sentMessages).toHaveLength(sent);
      sendWsMessage(ws, createProtocolMessage('clarification_request', { question: 'late?' }));
      expect(supervisor.getState(REF.sessionId)).toBe(state);
    },
  );

  it('retains the pending request when the WebSocket cannot send and permits a later retry', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    const request = createProtocolMessage('permission_request', {
      action: 'write',
      resource: '/file',
      riskLevel: 'high',
    });
    sendWsMessage(ws, request);
    const send = ws.send.bind(ws);
    ws.send = () => {
      throw new Error('socket unavailable');
    };
    expect(
      await supervisor.sendHumanResponse(REF.sessionId, request.messageId, { granted: true }),
    ).toBe(false);
    expect((await supervisor.getSnapshot(REF.sessionId))?.pendingRequests[0].requestId).toBe(
      request.messageId,
    );
    ws.send = send;
    expect(
      await supervisor.sendHumanResponse(REF.sessionId, request.messageId, { granted: true }),
    ).toBe(true);
    expect(ws.sentMessages).toHaveLength(1);
  });

  it('expires pending permissions with the remote lease and refuses late answers', async () => {
    vi.useFakeTimers();
    try {
      const { ws, transport } = makeTransport();
      await supervisor.createSession(
        REF,
        undefined,
        { ...RECONNECT_META, leaseExpiresAt: '2020-01-01T00:00:00Z', heartbeatIntervalMs: 10 },
        transport,
      );
      const request = createProtocolMessage('permission_request', {
        action: 'write',
        resource: '/file',
        riskLevel: 'high',
      });
      sendWsMessage(ws, request);
      await supervisor.waitForAdvance(REF.sessionId);
      await vi.advanceTimersByTimeAsync(10);
      expect((await supervisor.getSnapshot(REF.sessionId))?.pendingRequests).toEqual([]);
      expect(
        await supervisor.sendHumanResponse(REF.sessionId, request.messageId, { granted: true }),
      ).toBe(false);
      expect(await supervisor.waitForAdvance(REF.sessionId)).toMatchObject({ kind: 'failed' });
      await supervisor.finalize(REF.sessionId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists an immediately pending request before returning it to the workflow', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    const request = createProtocolMessage('permission_request', {
      action: 'write',
      resource: '/file',
      riskLevel: 'high',
    });
    sendWsMessage(ws, request);
    await supervisor.waitForAdvance(REF.sessionId);
    expect(
      (await store.loadSnapshot(REF.sessionId, REF.runId))?.pendingRequests[0]?.requestId,
    ).toBe(request.messageId);
  });

  it('retains request identity across restart after send succeeds but snapshot persistence fails', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    const request = createProtocolMessage('permission_request', {
      action: 'write',
      resource: '/file',
      riskLevel: 'high',
    });
    sendWsMessage(ws, request);
    await supervisor.waitForAdvance(REF.sessionId);
    const save = vi
      .spyOn(store, 'saveSnapshot')
      .mockRejectedValueOnce(new Error('snapshot unavailable after send'));
    await expect(
      supervisor.sendHumanResponse(REF.sessionId, request.messageId, { granted: true }),
    ).rejects.toThrow('snapshot unavailable');
    expect(ws.sentMessages).toHaveLength(1);
    expect(
      await supervisor.sendHumanResponse(REF.sessionId, request.messageId, { granted: true }),
    ).toBe(false);
    save.mockRestore();
    const restartedRegistry = new AgentSessionRegistry(new DefaultAgentSessionStore(dir));
    await restartedRegistry.rebuild();
    const restarted = new RemoteAgentSessionSupervisor(restartedRegistry);
    const reconnected = makeTransport();
    restarted.setTransportFactory(() => Promise.resolve(reconnected.transport));
    const attached = await restarted.attach(REF.sessionId);
    expect(attached?.pendingRequests[0].requestId).toBe(request.messageId);
    expect(
      await restarted.sendHumanResponse(REF.sessionId, 'different-request', { granted: true }),
    ).toBe(false);
    expect(reconnected.ws.sentMessages).toHaveLength(0);
    await restarted.finalize(REF.sessionId);
  });

  it('does not reconnect a persisted terminal session or deliver answers after abort', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    const request = createProtocolMessage('permission_request', {
      action: 'write',
      resource: '/file',
      riskLevel: 'high',
    });
    sendWsMessage(ws, request);
    await supervisor.abort(REF.sessionId, 'stop');
    expect(
      await supervisor.sendHumanResponse(REF.sessionId, request.messageId, { granted: true }),
    ).toBe(false);
    supervisor.setTransportFactory(() => Promise.resolve(makeTransport().transport));
    expect(await supervisor.reconnect(REF.sessionId)).toBeNull();
    await supervisor.finalize(REF.sessionId);
    const restoredRegistry = new AgentSessionRegistry(new DefaultAgentSessionStore(dir));
    await restoredRegistry.rebuild();
    const restarted = new RemoteAgentSessionSupervisor(restoredRegistry);
    const factory = vi.fn(() => Promise.resolve(makeTransport().transport));
    restarted.setTransportFactory(factory);
    expect(await restarted.attach(REF.sessionId)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('ignores messages from a replaced transport', async () => {
    const first = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, first.transport);
    // A transport error severs ownership; reconnect installs another transport for this host.
    first.ws.emit('error', new Error('connection lost'));
    const next = makeTransport();
    supervisor.setTransportFactory(() => Promise.resolve(next.transport));
    await supervisor.reconnect(REF.sessionId);
    sendWsMessage(
      first.ws,
      createProtocolMessage('permission_request', {
        action: 'write',
        resource: '/stale',
        riskLevel: 'high',
      }),
    );
    expect((await supervisor.getSnapshot(REF.sessionId))?.pendingRequests).toEqual([]);
    const current = createProtocolMessage('permission_request', {
      action: 'read',
      resource: '/current',
      riskLevel: 'low',
    });
    sendWsMessage(next.ws, current);
    expect(
      (await supervisor.getSnapshot(REF.sessionId))?.pendingRequests.map(
        (request) => request.requestId,
      ),
    ).toEqual([current.messageId]);
    first.ws.emit('error', new Error('late error on replaced transport'));
    expect(supervisor.getState(REF.sessionId)).toBe('awaiting_human');
    expect(
      await supervisor.sendHumanResponse(REF.sessionId, current.messageId, { granted: true }),
    ).toBe(true);
    await supervisor.finalize(REF.sessionId);
  });

  it.each(['permission', 'clarification'] as const)(
    'isolates parallel %s requests and rejects wrong-kind and duplicate responses',
    async (kind) => {
      const first = makeTransport();
      const second = makeTransport();
      const otherRef = { ...REF, sessionId: 'rsess-2', runId: 'run-2' };
      await supervisor.createSession(REF, undefined, RECONNECT_META, first.transport);
      await supervisor.createSession(otherRef, undefined, RECONNECT_META, second.transport);
      const request =
        kind === 'permission'
          ? createProtocolMessage('permission_request', {
              action: 'write',
              resource: '/file',
              riskLevel: 'high',
            })
          : createProtocolMessage('clarification_request', { question: 'Which branch?' });
      sendWsMessage(first.ws, request);
      sendWsMessage(second.ws, request);
      expect(
        await supervisor.sendHumanResponse(
          REF.sessionId,
          request.messageId,
          kind === 'permission' ? { answer: 'main' } : { granted: true },
        ),
      ).toBe(false);
      const answer = kind === 'permission' ? { granted: true } : { answer: 'main' };
      expect(
        await Promise.all([
          supervisor.sendHumanResponse(REF.sessionId, request.messageId, answer),
          supervisor.sendHumanResponse(REF.sessionId, request.messageId, answer),
        ]),
      ).toEqual([true, false]);
      expect(second.ws.sentMessages).toHaveLength(0);
      expect((await supervisor.getSnapshot(otherRef.sessionId))?.pendingRequests[0].requestId).toBe(
        request.messageId,
      );
    },
  );

  it('creates a session with reconnect metadata', async () => {
    const { transport } = makeTransport();
    const handle = await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    expect(handle.ref.sessionId).toBe('rsess-1');
    expect(handle.state).toBe('running');

    const snap = await supervisor.getSnapshot('rsess-1');
    expect(snap).not.toBeNull();
    expect(snap?.reconnect).toEqual(RECONNECT_META);
  });

  it('throws when creating without reconnect metadata', async () => {
    await expect(supervisor.createSession(REF)).rejects.toThrow('reconnect metadata');
  });

  it('tracks pending permission requests from WebSocket messages', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    sendWsMessage(
      ws,
      createProtocolMessage('permission_request', {
        action: 'write_file',
        resource: '/src/main.ts',
        riskLevel: 'high',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const snap = await supervisor.getSnapshot('rsess-1');
    expect(snap?.state).toBe('awaiting_human');
    expect(snap?.pendingRequests).toHaveLength(1);
    expect(snap?.pendingRequests[0].kind).toBe('permission');
  });

  it('delivers human response and clears pending', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    sendWsMessage(
      ws,
      createProtocolMessage('permission_request', {
        action: 'write_file',
        resource: '/src/main.ts',
        riskLevel: 'medium',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const snap = await supervisor.getSnapshot('rsess-1');
    const requestId = (snap as NonNullable<typeof snap>).pendingRequests[0].requestId;

    const sent = await supervisor.sendHumanResponse('rsess-1', requestId, {
      granted: true,
      reason: 'approved',
    });
    expect(sent).toBe(true);

    const updated = await supervisor.getSnapshot('rsess-1');
    expect(updated?.pendingRequests).toHaveLength(0);
    expect(updated?.state).toBe('running');
  });

  it('returns false for human response on unknown session', async () => {
    const sent = await supervisor.sendHumanResponse('nonexistent', 'req-1', { granted: true });
    expect(sent).toBe(false);
  });

  it('returns false for human response on unknown request id', async () => {
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    const sent = await supervisor.sendHumanResponse('rsess-1', 'nonexistent', { granted: true });
    expect(sent).toBe(false);
  });

  it('attaches to existing session', async () => {
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    const events: string[] = [];
    const handle = await supervisor.attach('rsess-1', (e) => events.push(e.content));
    expect(handle).not.toBeNull();
    expect(handle?.ref.sessionId).toBe('rsess-1');
  });

  it('returns null when attaching to unknown session', async () => {
    const handle = await supervisor.attach('nonexistent');
    expect(handle).toBeNull();
  });

  it('aborts a session', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    const aborted = await supervisor.abort('rsess-1', 'test abort');
    expect(aborted).toBe(true);

    const state = supervisor.getState('rsess-1');
    expect(state).toBe('aborted');

    expect(ws.sentMessages.some((m) => m.includes('"abort"'))).toBe(true);
  });

  it('pauses and disconnects transport', async () => {
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    const paused = await supervisor.pause('rsess-1');
    expect(paused).toBe(true);

    const state = supervisor.getState('rsess-1');
    expect(state).toBe('paused');

    const host = supervisor.getHost('rsess-1');
    expect(host?.transport).toBeNull();
  });

  it('completes on done message', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    sendWsMessage(
      ws,
      createProtocolMessage('artifact', {
        name: 'output',
        type: 'code',
        content: '{"result": "done"}',
        isFinal: true,
      }),
    );
    sendWsMessage(
      ws,
      createProtocolMessage('done', {
        summary: 'completed successfully',
      }),
    );

    const host = supervisor.getHost('rsess-1') as NonNullable<
      ReturnType<typeof supervisor.getHost>
    >;
    const result = await host.resultPromise;
    expect(result.status).toBe('success');
    expect(result.artifactContent).toBe('{"result": "done"}');
    expect(host.state).toBe('completed');
  });

  it('handles error message', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    sendWsMessage(
      ws,
      createProtocolMessage('error', {
        code: 'INTERNAL',
        message: 'something went wrong',
      }),
    );

    const host = supervisor.getHost('rsess-1') as NonNullable<
      ReturnType<typeof supervisor.getHost>
    >;
    const result = await host.resultPromise;
    expect(result.status).toBe('failure');
    expect(result.error).toContain('INTERNAL');
    expect(host.state).toBe('failed');
  });

  it('finalizes and removes host from memory', async () => {
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    await supervisor.finalize('rsess-1');
    expect(supervisor.getHost('rsess-1')).toBeUndefined();

    const snap = registry.get('rsess-1');
    expect(snap).not.toBeNull();
  });

  it('lists sessions by run', async () => {
    const { transport: t1 } = makeTransport();
    const { transport: t2 } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, t1);
    await supervisor.createSession(
      { ...REF, sessionId: 'rsess-2', role: 'reviewer' },
      undefined,
      { ...RECONNECT_META, remoteSessionId: 'remote-def' },
      t2,
    );

    const sessions = await supervisor.listByRun('run-1');
    expect(sessions).toHaveLength(2);
  });

  it('attach falls back to reconnect when host not in memory', async () => {
    const { transport: t1 } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, t1);
    await supervisor.pause('rsess-1');
    await supervisor.finalize('rsess-1');

    const fresh = new RemoteAgentSessionSupervisor(registry);
    const { transport: t2 } = makeTransport();
    fresh.setTransportFactory(() => Promise.resolve(t2));

    const handle = await fresh.attach('rsess-1');
    expect(handle).not.toBeNull();
    expect(handle?.ref.sessionId).toBe('rsess-1');
    expect(handle?.state).toBe('running');
  });

  it('attach returns null when no transport factory and host not in memory', async () => {
    const { transport: t1 } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, t1);
    await supervisor.pause('rsess-1');
    await supervisor.finalize('rsess-1');

    const fresh = new RemoteAgentSessionSupervisor(registry);

    const handle = await fresh.attach('rsess-1');
    expect(handle).toBeNull();
  });

  it('reconnects from persisted snapshot via transport factory', async () => {
    const { transport: t1 } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, t1);
    await supervisor.pause('rsess-1');
    await supervisor.finalize('rsess-1');

    const fresh = new RemoteAgentSessionSupervisor(registry);
    const { transport: t2 } = makeTransport();
    fresh.setTransportFactory(() => Promise.resolve(t2));

    const handle = await fresh.reconnect('rsess-1');
    expect(handle).not.toBeNull();
    expect(handle?.state).toBe('running');
  });

  it('reconnect returns null for expired lease', async () => {
    const metaWithExpiry: RemoteReconnectMeta = {
      ...RECONNECT_META,
      leaseExpiresAt: '2020-01-01T00:00:00Z',
    };
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, metaWithExpiry, transport);
    await supervisor.pause('rsess-1');
    await supervisor.finalize('rsess-1');

    const fresh = new RemoteAgentSessionSupervisor(registry);
    fresh.setTransportFactory(() => Promise.resolve(makeTransport().transport));

    const handle = await fresh.reconnect('rsess-1');
    expect(handle).toBeNull();
  });

  it('reconnect preserves authHeader in reconnect metadata', async () => {
    const metaWithAuth: RemoteReconnectMeta = {
      ...RECONNECT_META,
      authHeader: 'Authorization:Bearer test-token',
    };
    const { transport: t1 } = makeTransport();
    await supervisor.createSession(REF, undefined, metaWithAuth, t1);

    const snap = await supervisor.getSnapshot('rsess-1');
    expect(snap?.reconnect).toBeDefined();
    expect((snap?.reconnect as RemoteReconnectMeta).authHeader).toBe(
      'Authorization:Bearer test-token',
    );

    await supervisor.pause('rsess-1');
    await supervisor.finalize('rsess-1');

    const fresh = new RemoteAgentSessionSupervisor(registry);
    const { transport: t2 } = makeTransport();
    fresh.setTransportFactory((_ref, meta) => {
      expect(meta.authHeader).toBe('Authorization:Bearer test-token');
      return Promise.resolve(t2);
    });

    const handle = await fresh.reconnect('rsess-1');
    expect(handle).not.toBeNull();
    expect(handle?.state).toBe('running');
  });

  it('reconnect returns null for unknown session', async () => {
    const handle = await supervisor.reconnect('nonexistent');
    expect(handle).toBeNull();
  });

  it('isLeaseExpired returns correct value', async () => {
    const futureExpiry: RemoteReconnectMeta = {
      ...RECONNECT_META,
      leaseExpiresAt: '2099-01-01T00:00:00Z',
    };
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, futureExpiry, transport);

    expect(supervisor.isLeaseExpired('rsess-1')).toBe(false);
  });

  it('isLeaseExpired returns true for past expiry', async () => {
    const pastExpiry: RemoteReconnectMeta = {
      ...RECONNECT_META,
      leaseExpiresAt: '2020-01-01T00:00:00Z',
    };
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, pastExpiry, transport);

    expect(supervisor.isLeaseExpired('rsess-1')).toBe(true);
  });

  it('handles clarification requests', async () => {
    const { ws, transport } = makeTransport();
    const events: string[] = [];
    await supervisor.createSession(REF, (e) => events.push(e.content), RECONNECT_META, transport);

    sendWsMessage(
      ws,
      createProtocolMessage('clarification_request', {
        question: 'Which branch?',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const snap = await supervisor.getSnapshot('rsess-1');
    expect(snap?.state).toBe('awaiting_human');
    expect(snap?.pendingRequests[0].kind).toBe('clarification');
    expect(events.some((e) => e.includes('Which branch?'))).toBe(true);

    const requestId = (snap as NonNullable<typeof snap>).pendingRequests[0].requestId;
    await supervisor.sendHumanResponse('rsess-1', requestId, { answer: 'main' });

    const updated = await supervisor.getSnapshot('rsess-1');
    expect(updated?.pendingRequests).toHaveLength(0);
  });

  it('createSession without transport wires nothing', async () => {
    const handle = await supervisor.createSession(REF, undefined, RECONNECT_META);
    expect(handle.ref.sessionId).toBe('rsess-1');
    expect(handle.state).toBe('running');
    const host = supervisor.getHost('rsess-1');
    expect(host?.transport).toBeNull();
  });

  it('attach without onStreamEvent does not add handler', async () => {
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    const handle = await supervisor.attach('rsess-1');
    expect(handle).not.toBeNull();
    const host = supervisor.getHost('rsess-1');
    expect(host?.streamHandlers).toHaveLength(0);
  });

  it('waitForAdvance returns failed for unknown session', async () => {
    const result = await supervisor.waitForAdvance('nonexistent');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error).toContain('nonexistent');
    }
  });

  it('waitForAdvance returns completed for terminal completed session', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    sendWsMessage(
      ws,
      createProtocolMessage('artifact', {
        name: 'output',
        type: 'code',
        content: '{"final": true}',
        isFinal: true,
      }),
    );
    sendWsMessage(ws, createProtocolMessage('done', { summary: 'done' }));

    await new Promise((r) => setTimeout(r, 50));

    const result = await supervisor.waitForAdvance('rsess-1');
    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.artifactContent).toBe('{"final": true}');
    }
  });

  it('waitForAdvance returns failed for terminal non-completed session', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    sendWsMessage(
      ws,
      createProtocolMessage('error', {
        code: 'FATAL',
        message: 'crashed',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const result = await supervisor.waitForAdvance('rsess-1');
    expect(result.kind).toBe('failed');
  });

  it('waitForAdvance returns awaiting_human when pending requests exist', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    sendWsMessage(
      ws,
      createProtocolMessage('permission_request', {
        action: 'write_file',
        resource: '/src/main.ts',
        riskLevel: 'medium',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const result = await supervisor.waitForAdvance('rsess-1');
    expect(result.kind).toBe('awaiting_human');
  });

  it('abort returns false for unknown session', async () => {
    const aborted = await supervisor.abort('nonexistent', 'reason');
    expect(aborted).toBe(false);
  });

  it('abort without transport does not send message', async () => {
    await supervisor.createSession(REF, undefined, RECONNECT_META);
    const host = supervisor.getHost('rsess-1');
    expect(host?.transport).toBeNull();

    const aborted = await supervisor.abort('rsess-1', 'test');
    expect(aborted).toBe(true);
    expect(supervisor.getState('rsess-1')).toBe('aborted');
  });

  it('pause returns false for unknown session', async () => {
    const paused = await supervisor.pause('nonexistent');
    expect(paused).toBe(false);
  });

  it('pause returns false for terminal session', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    sendWsMessage(ws, createProtocolMessage('done', { summary: 'done' }));
    await new Promise((r) => setTimeout(r, 50));

    const paused = await supervisor.pause('rsess-1');
    expect(paused).toBe(false);
  });

  it('finalize without transport does not fail', async () => {
    await supervisor.createSession(REF, undefined, RECONNECT_META);
    await supervisor.finalize('rsess-1');
    expect(supervisor.getHost('rsess-1')).toBeUndefined();
  });

  it('getState returns state from registry when host removed', async () => {
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    await supervisor.finalize('rsess-1');

    const state = supervisor.getState('rsess-1');
    expect(state).toBe('running');
  });

  it('getState returns null for unknown session', () => {
    const state = supervisor.getState('unknown');
    expect(state).toBeNull();
  });

  it('reconnect returns handle immediately for in-memory host with transport', async () => {
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    const handle = await supervisor.reconnect('rsess-1');
    expect(handle).not.toBeNull();
    expect(handle?.state).toBe('running');
  });

  it('reconnect creates new transport for in-memory host without transport', async () => {
    await supervisor.createSession(REF, undefined, RECONNECT_META);
    const host = supervisor.getHost('rsess-1');
    expect(host?.transport).toBeNull();

    const { transport: newTransport } = makeTransport();
    supervisor.setTransportFactory(() => Promise.resolve(newTransport));

    const handle = await supervisor.reconnect('rsess-1');
    expect(handle).not.toBeNull();
    expect(handle?.state).toBe('running');
  });

  it('reconnect returns null for in-memory host without transport and no factory', async () => {
    await supervisor.createSession(REF, undefined, RECONNECT_META);
    // No transport factory set
    const handle = await supervisor.reconnect('rsess-1');
    expect(handle).toBeNull();
  });

  it('transport error transitions to reconnecting state', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    ws.emit('error', new Error('connection lost'));

    await new Promise((r) => setTimeout(r, 50));

    const host = supervisor.getHost('rsess-1');
    expect(host?.state).toBe('reconnecting');
    expect(host?.transport).toBeNull();
  });

  it('handles progress messages', async () => {
    const { ws, transport } = makeTransport();
    const events: string[] = [];
    await supervisor.createSession(REF, (e) => events.push(e.content), RECONNECT_META, transport);

    sendWsMessage(
      ws,
      createProtocolMessage('progress', {
        phase: 'build',
        detail: 'compiling',
        percent: 75,
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(events.some((e) => e.includes('[build] compiling (75%)'))).toBe(true);
  });

  it('handles log messages', async () => {
    const { ws, transport } = makeTransport();
    const events: Array<{ type: string; content: string }> = [];
    await supervisor.createSession(
      REF,
      (e) => events.push({ type: e.type, content: e.content }),
      RECONNECT_META,
      transport,
    );

    sendWsMessage(
      ws,
      createProtocolMessage('log', {
        level: 'error',
        message: 'something failed',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const errorEvent = events.find((e) => e.content.includes('something failed'));
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.type).toBe('stderr');
  });

  it('handles non-final artifact', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    sendWsMessage(
      ws,
      createProtocolMessage('artifact', {
        name: 'partial',
        type: 'code',
        content: '{"partial": true}',
        isFinal: false,
      }),
    );

    sendWsMessage(ws, createProtocolMessage('done', { summary: 'done' }));

    const host = supervisor.getHost('rsess-1') as NonNullable<
      ReturnType<typeof supervisor.getHost>
    >;
    const result = await host.resultPromise;
    expect(result.status).toBe('success');
    expect(result.artifactContent).toBe('{"partial": true}');
  });

  it('done without prior artifact uses summary fallback', async () => {
    const { ws, transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);

    sendWsMessage(ws, createProtocolMessage('done', { summary: 'all done' }));

    const host = supervisor.getHost('rsess-1') as NonNullable<
      ReturnType<typeof supervisor.getHost>
    >;
    const result = await host.resultPromise;
    expect(result.status).toBe('success');
    expect(result.artifactContent).toBe(JSON.stringify({ summary: 'all done' }));
  });

  it('isLeaseExpired returns false for unknown session', () => {
    expect(supervisor.isLeaseExpired('unknown')).toBe(false);
  });

  it('isLeaseExpired returns false when no leaseExpiresAt', async () => {
    const { transport } = makeTransport();
    await supervisor.createSession(REF, undefined, RECONNECT_META, transport);
    expect(supervisor.isLeaseExpired('rsess-1')).toBe(false);
  });

  it('emitStream swallows handler errors', async () => {
    const { ws, transport } = makeTransport();
    const events: string[] = [];
    await supervisor.createSession(
      REF,
      () => {
        throw new Error('handler boom');
      },
      RECONNECT_META,
      transport,
    );

    const host = supervisor.getHost('rsess-1');
    host?.streamHandlers.push((e) => events.push(e.content));

    sendWsMessage(
      ws,
      createProtocolMessage('progress', {
        phase: 'test',
        detail: 'running',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(events.some((e) => e.includes('running'))).toBe(true);
  });
});

describe('http-session-contract extensions', () => {
  // Inline tests for the new contract functions
  it('parseSubmitResponse parses reconnect descriptor', async () => {
    const { parseSubmitResponse } =
      await import('../../../domain/runner-system/http-session-contract');
    const result = parseSubmitResponse({
      taskId: 'task-1',
      session: {
        sessionId: 'sess-1',
        protocol: 'ado/agent/v1',
        capabilities: ['write_file'],
        transport: { type: 'websocket', url: 'wss://example.com/ws' },
        reconnect: {
          url: 'https://example.com/reconnect',
          leaseExpiresAt: '2099-01-01T00:00:00Z',
          heartbeatIntervalMs: 30000,
          resultUrl: 'https://example.com/result',
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.session?.reconnect).toEqual({
        url: 'https://example.com/reconnect',
        leaseExpiresAt: '2099-01-01T00:00:00Z',
        heartbeatIntervalMs: 30000,
        resultUrl: 'https://example.com/result',
      });
    }
  });

  it('parseSubmitResponse ignores invalid reconnect', async () => {
    const { parseSubmitResponse } =
      await import('../../../domain/runner-system/http-session-contract');
    const result = parseSubmitResponse({
      taskId: 'task-1',
      session: {
        sessionId: 'sess-1',
        reconnect: { url: '' },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.session?.reconnect).toBeUndefined();
    }
  });

  it('isResumableSession returns true for reconnectable sessions', async () => {
    const { isResumableSession } =
      await import('../../../domain/runner-system/http-session-contract');
    expect(
      isResumableSession({
        sessionId: 'sess-1',
        protocol: 'ado/agent/v1',
        transport: { type: 'websocket', url: 'wss://example.com/ws' },
        reconnect: { url: 'https://example.com/reconnect' },
      }),
    ).toBe(true);
  });

  it('isResumableSession returns false without reconnect', async () => {
    const { isResumableSession } =
      await import('../../../domain/runner-system/http-session-contract');
    expect(
      isResumableSession({
        sessionId: 'sess-1',
        protocol: 'ado/agent/v1',
        transport: { type: 'websocket', url: 'wss://example.com/ws' },
      }),
    ).toBe(false);
  });

  it('isResumableSession returns false without protocol mode', async () => {
    const { isResumableSession } =
      await import('../../../domain/runner-system/http-session-contract');
    expect(
      isResumableSession({
        sessionId: 'sess-1',
        reconnect: { url: 'https://example.com/reconnect' },
      }),
    ).toBe(false);
  });
});
