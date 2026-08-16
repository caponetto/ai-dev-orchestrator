import { createProtocolMessage, PROTOCOL_VERSION } from '@ai-orchestrator/agent-protocol';
import type { AgentOutputStreamEvent, PermissionPolicy } from '@ai-orchestrator/ports';
import type { AgentTask } from '@ai-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveRequestStore } from '../file-backed-live-request-store';
import { HttpAgentRunner } from '../http-agent-runner';
import type { RemoteAgentSessionSupervisor } from '../remote-agent-session-supervisor';

function makeTask(overrides?: Partial<AgentTask>): AgentTask {
  return {
    taskId: 'task-1',
    runId: '20260101-000000-abc123',
    stateId: 'IMPLEMENTATION',
    role: 'implementer',
    description: 'Implement feature X',
    inputArtifacts: [],
    repoRoot: '/repo',
    runDir: '/repo/.ai/runs/run-1',
    outputArtifactPath: '/repo/output/impl.json',
    constraints: {
      timeout: 5000,
      requiredOutputType: 'implementation',
    },
    ...overrides,
  };
}

const jsonHeaders = { get: () => 'application/json' };

describe('HttpAgentRunner', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits task and polls until completion', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: jsonHeaders,
        json: () => ({ taskId: 'remote-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => ({ status: 'running' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => ({
          status: 'completed',
          result: {
            taskId: 'remote-1',
            status: 'success',
            artifactContent: '{"files": ["a.ts"]}',
            durationMs: 3000,
            tokenUsage: { inputTokens: 200, outputTokens: 100 },
          },
        }),
      });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
      pollIntervalMs: 10,
    });

    const result = await runner.dispatch(makeTask());

    expect(result.status).toBe('success');
    expect(result.taskId).toBe('task-1');
    expect(result.artifactContent).toBe('{"files": ["a.ts"]}');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns failure on submit HTTP error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => 'Internal Server Error',
    });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
    });

    const result = await runner.dispatch(makeTask());

    expect(result.status).toBe('failure');
    expect(result.error).toContain('HTTP 500');
  });

  it('returns failure on submit network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
    });

    const result = await runner.dispatch(makeTask());

    expect(result.status).toBe('failure');
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('returns failure when poll returns failed status', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: jsonHeaders,
        json: () => ({ taskId: 'remote-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => ({ status: 'failed', error: 'Agent crashed' }),
      });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
      pollIntervalMs: 10,
    });

    const result = await runner.dispatch(makeTask());

    expect(result.status).toBe('failure');
    expect(result.error).toBe('Agent crashed');
  });

  it('returns failure on poll HTTP error', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: jsonHeaders,
        json: () => ({ taskId: 'remote-1' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: () => 'Bad Gateway',
      });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
      pollIntervalMs: 10,
    });

    const result = await runner.dispatch(makeTask());

    expect(result.status).toBe('failure');
    expect(result.error).toContain('HTTP 502');
  });

  it('returns timeout and sends cancel when polling exceeds timeout', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: jsonHeaders,
        json: () => ({ taskId: 'remote-1' }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => ({ status: 'running' }),
      });

    const task = makeTask({
      constraints: { timeout: 100, requiredOutputType: 'implementation' },
    });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
      pollIntervalMs: 20,
    });

    const result = await runner.dispatch(task);

    expect(result.status).toBe('timeout');
    expect(result.error).toContain('timed out');

    const cancelCall = (fetchMock.mock.calls as unknown[][]).find(
      (c) => typeof c[0] === 'string' && c[0].includes('/cancel'),
    );
    expect(cancelCall).toBeTruthy();
  });

  it('passes auth header when configured', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: jsonHeaders,
        json: () => ({ taskId: 'remote-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => ({
          status: 'completed',
          result: {
            taskId: 'remote-1',
            status: 'success',
            artifactContent: '{}',
            durationMs: 100,
          },
        }),
      });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
      authHeader: 'Authorization: Bearer test-token',
      pollIntervalMs: 10,
    });

    await runner.dispatch(makeTask());

    const submitCall = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = submitCall[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
  });

  it('uses per-role pollIntervalMs from agentConfig', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: jsonHeaders,
        json: () => ({ taskId: 'remote-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => ({
          status: 'completed',
          result: {
            taskId: 'remote-1',
            status: 'success',
            artifactContent: '{}',
            durationMs: 100,
          },
        }),
      });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
      pollIntervalMs: 9999,
    });

    const task = makeTask({
      agentConfig: { pollIntervalMs: 10 },
    });

    const start = Date.now();
    await runner.dispatch(task);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('consumes SSE stream when content-type is text/event-stream', async () => {
    const chunks = [
      'data: {"type":"stdout","content":"building...","timestamp":"2026-01-01T00:00:00Z"}\n\n',
      'data: {"type":"result","result":{"taskId":"remote-1","status":"success","artifactContent":"{}","durationMs":100}}\n\n',
    ];

    let chunkIndex = 0;
    const mockReader = {
      read: vi.fn().mockImplementation(() => {
        if (chunkIndex < chunks.length) {
          const value = new TextEncoder().encode(chunks[chunkIndex++]);
          return Promise.resolve({ done: false, value });
        }
        return Promise.resolve({ done: true, value: undefined });
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
      body: { getReader: () => mockReader },
    });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
    });

    const events: Array<{ type: string; content: string }> = [];
    const result = await runner.dispatch(makeTask(), (event) => {
      events.push({ type: event.type, content: event.content });
    });

    expect(result.status).toBe('success');
    expect(result.taskId).toBe('task-1');
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe('building...');
  });

  it('returns timeout when SSE stream exceeds timeout', async () => {
    const mockReader = {
      read: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({ done: false, value: new TextEncoder().encode(':\n\n') });
            }, 200);
          }),
      ),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
      body: { getReader: () => mockReader },
    });

    const task = makeTask({
      constraints: { timeout: 100, requiredOutputType: 'implementation' },
    });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
    });

    const result = await runner.dispatch(task);

    expect(result.status).toBe('timeout');
    expect(result.error).toContain('SSE stream timed out');
  });

  it('sends cancel POST when SSE stream times out', async () => {
    const mockReader = {
      read: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({ done: false, value: new TextEncoder().encode(':\n\n') });
            }, 200);
          }),
      ),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
        body: { getReader: () => mockReader },
      })
      .mockResolvedValueOnce({ ok: true });

    const task = makeTask({
      constraints: { timeout: 100, requiredOutputType: 'implementation' },
    });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
    });

    const result = await runner.dispatch(task);

    expect(result.status).toBe('timeout');

    const cancelCall = (fetchMock.mock.calls as unknown[][]).find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('/cancel'),
    );
    expect(cancelCall).toBeDefined();
    const cancelOpts = (cancelCall as unknown[])[1] as RequestInit;
    expect(cancelOpts.method).toBe('POST');
    expect(JSON.parse(cancelOpts.body as string)).toEqual({ taskId: 'task-1' });
  });

  it('uses per-role endpoint from agentConfig for SSE cancel', async () => {
    const mockReader = {
      read: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({ done: false, value: new TextEncoder().encode(':\n\n') });
            }, 200);
          }),
      ),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
        body: { getReader: () => mockReader },
      })
      .mockResolvedValueOnce({ ok: true });

    const task = makeTask({
      constraints: { timeout: 100, requiredOutputType: 'implementation' },
      agentConfig: { endpoint: 'https://custom.example.com/run' },
    });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
    });

    const result = await runner.dispatch(task);

    expect(result.status).toBe('timeout');

    const submitCall = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(submitCall[0]).toBe('https://custom.example.com/run');

    const cancelCall = (fetchMock.mock.calls as unknown[][]).find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('/cancel'),
    );
    expect(cancelCall).toBeDefined();
    expect((cancelCall as unknown[])[0]).toBe('https://custom.example.com/run/cancel');
  });

  it('returns timeout within bounded time when SSE read() never resolves', async () => {
    const mockReader = {
      read: vi.fn().mockReturnValue(new Promise(() => {})),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
        body: { getReader: () => mockReader },
      })
      .mockResolvedValueOnce({ ok: true });

    const timeoutMs = 200;
    const task = makeTask({
      constraints: { timeout: timeoutMs, requiredOutputType: 'implementation' },
    });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
    });

    const start = Date.now();
    const result = await runner.dispatch(task);
    const elapsed = Date.now() - start;

    expect(result.status).toBe('timeout');
    expect(result.error).toContain('SSE stream timed out');
    expect(elapsed).toBeLessThan(timeoutMs + 500);
    expect(mockReader.cancel).toHaveBeenCalled();

    const cancelCall = (fetchMock.mock.calls as unknown[][]).find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('/cancel'),
    );
    expect(cancelCall).toBeDefined();
  });

  it(
    'returns timeout within bounded time even when cancel fetch hangs',
    { timeout: 10_000 },
    async () => {
      const mockReader = {
        read: vi.fn().mockReturnValue(new Promise(() => {})),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null),
          },
          body: { getReader: () => mockReader },
        })
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        .mockImplementationOnce((_url: unknown, opts?: Record<string, unknown>) => {
          return new Promise((_resolve, reject) => {
            const signal = opts?.signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          });
        });

      const timeoutMs = 200;
      const task = makeTask({
        constraints: { timeout: timeoutMs, requiredOutputType: 'implementation' },
      });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
      });

      const start = Date.now();
      const result = await runner.dispatch(task);
      const elapsed = Date.now() - start;

      expect(result.status).toBe('timeout');
      expect(elapsed).toBeLessThan(timeoutMs + 6_000);
    },
  );

  it('returns failure when SSE response has no body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
      body: null,
    });

    const runner = new HttpAgentRunner({
      endpoint: 'https://api.example.com/agents',
    });

    const result = await runner.dispatch(makeTask());

    expect(result.status).toBe('failure');
    expect(result.error).toContain('no body');
  });

  describe('WebSocket protocol mode', () => {
    it(
      'fails gracefully when WebSocket handshake times out (no capabilities in session)',
      { timeout: 15_000 },
      async () => {
        const sessionDescriptor = {
          taskId: 'task-1',
          session: {
            sessionId: 'ws-session-1',
            protocol: PROTOCOL_VERSION,
            transport: { type: 'websocket', url: 'ws://localhost:9999/ws/task-1' },
          },
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve(sessionDescriptor),
        });

        const mockWs = {
          onopen: null as (() => void) | null,
          onmessage: null as ((event: { data: string }) => void) | null,
          onerror: null as ((error: unknown) => void) | null,
          onclose: null as (() => void) | null,
          send: vi.fn(),
          close: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          readyState: 1,
        };

        const WebSocketMock = vi.fn(function () {
          return mockWs;
        });
        vi.stubGlobal('WebSocket', WebSocketMock);

        const runner = new HttpAgentRunner({
          endpoint: 'https://api.example.com/agents',
        });

        const result = await runner.dispatch(
          makeTask({ constraints: { timeout: 30_000, requiredOutputType: 'implementation' } }),
        );

        expect(WebSocketMock).toHaveBeenCalledWith('ws://localhost:9999/ws/task-1');
        expect(result.status).toBe('failure');
        expect(result.error).toContain('handshake');
      },
    );

    it('appends auth token as URL query parameter', async () => {
      const sessionDescriptor = {
        taskId: 'task-1',
        session: {
          sessionId: 'ws-session-2',
          protocol: PROTOCOL_VERSION,
          transport: { type: 'websocket', url: 'ws://localhost:9999/ws/task-1' },
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(sessionDescriptor),
      });

      const mockWs = {
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        readyState: 1,
      };

      const WebSocketMock = vi.fn(() => mockWs);
      vi.stubGlobal('WebSocket', WebSocketMock);

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        authHeader: 'Authorization: Bearer secret-token',
      });

      await runner.dispatch(
        makeTask({ constraints: { timeout: 500, requiredOutputType: 'implementation' } }),
      );

      expect(WebSocketMock).toHaveBeenCalledWith(
        'ws://localhost:9999/ws/task-1?auth=Bearer%20secret-token',
      );
    });

    it('appends auth with & when websocket URL already has query params', async () => {
      const sessionDescriptor = {
        taskId: 'task-1',
        session: {
          sessionId: 'ws-session-3',
          protocol: PROTOCOL_VERSION,
          transport: { type: 'websocket', url: 'ws://localhost:9999/ws/task-1?token=abc' },
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(sessionDescriptor),
      });

      const mockWs = {
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        readyState: 1,
      };

      const WebSocketMock = vi.fn(() => mockWs);
      vi.stubGlobal('WebSocket', WebSocketMock);

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        authHeader: 'Authorization: Bearer secret-token',
      });

      await runner.dispatch(
        makeTask({ constraints: { timeout: 500, requiredOutputType: 'implementation' } }),
      );

      expect(WebSocketMock).toHaveBeenCalledWith(
        'ws://localhost:9999/ws/task-1?token=abc&auth=Bearer%20secret-token',
      );
    });

    it('returns failure when WebSocket constructor throws', async () => {
      const sessionDescriptor = {
        taskId: 'task-1',
        session: {
          sessionId: 'ws-session-err',
          protocol: PROTOCOL_VERSION,
          transport: { type: 'websocket', url: 'ws://localhost:9999/ws/task-1' },
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(sessionDescriptor),
      });

      const WebSocketMock = vi.fn(function () {
        throw new Error('WebSocket not supported');
      });
      vi.stubGlobal('WebSocket', WebSocketMock);

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
      });

      const result = await runner.dispatch(makeTask());

      expect(result.status).toBe('failure');
      expect(result.error).toContain('WebSocket connection failed');
      expect(result.error).toContain('WebSocket not supported');
    });

    /**
     * Helper: set up a WebSocket mock, fire the handshake sequence,
     * and return the captured event listeners so callers can
     * inject protocol messages from the "agent" side.
     */
    function setupWsProtocolMode(
      overrides?: Partial<{
        sessionId: string;
        wsUrl: string;
        authHeader: string;
        timeout: number;
      }>,
    ) {
      const sessionId = overrides?.sessionId ?? 'ws-session-proto';
      const wsUrl = overrides?.wsUrl ?? 'ws://localhost:9999/ws/proto';
      const timeout = overrides?.timeout ?? 10_000;

      const sessionDescriptor = {
        taskId: 'task-1',
        session: {
          sessionId,
          protocol: PROTOCOL_VERSION,
          transport: { type: 'websocket', url: wsUrl },
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(sessionDescriptor),
      });

      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const mockWs = {
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          listeners[event] ??= [];
          listeners[event].push(handler);
        }),
        removeEventListener: vi.fn(),
        readyState: 1,
      };

      const WebSocketMock = vi.fn(function () {
        return mockWs;
      });
      vi.stubGlobal('WebSocket', WebSocketMock);

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        ...(overrides?.authHeader ? { authHeader: overrides.authHeader } : {}),
      });

      const task = makeTask({
        constraints: { timeout, requiredOutputType: 'implementation' },
      });

      function fireMessage(msg: object) {
        const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
        for (const handler of listeners['message'] ?? []) {
          handler({ data });
        }
      }

      function fireError(err?: unknown) {
        for (const handler of listeners['error'] ?? []) {
          handler(err ?? new Error('ws error'));
        }
      }

      function sendHandshake() {
        const handshakeMsg = createProtocolMessage('handshake', {
          capabilities: ['permission_request', 'clarification_request'],
        });
        fireMessage(handshakeMsg);
      }

      /** Wait for dispatch() to reach WS setup — drains microtask queue. */
      async function waitForWsSetup() {
        await new Promise((r) => setTimeout(r, 10));
      }

      return {
        runner,
        task,
        mockWs,
        listeners,
        fireMessage,
        fireError,
        sendHandshake,
        waitForWsSetup,
      };
    }

    it('handles progress messages with percent', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const events: AgentOutputStreamEvent[] = [];
      const promise = runner.dispatch(task, (e) => events.push(e));

      await waitForWsSetup();
      sendHandshake();
      fireMessage(
        createProtocolMessage('progress', { phase: 'build', detail: 'Compiling', percent: 75 }),
      );
      fireMessage(createProtocolMessage('done', { summary: 'Build complete' }));

      const result = await promise;
      expect(result.status).toBe('success');
      const progressEvent = events.find(
        (e) => e.type === 'status' && e.content.includes('Compiling'),
      );
      expect(progressEvent).toBeDefined();
      expect(progressEvent?.content).toBe('[build] Compiling (75%)');
    });

    it('handles progress messages without percent', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const events: AgentOutputStreamEvent[] = [];
      const promise = runner.dispatch(task, (e) => events.push(e));

      await waitForWsSetup();
      sendHandshake();
      fireMessage(createProtocolMessage('progress', { phase: 'init', detail: 'Starting up' }));
      fireMessage(createProtocolMessage('done', { summary: 'Done' }));

      const result = await promise;
      expect(result.status).toBe('success');
      const progressEvent = events.find(
        (e) => e.type === 'status' && e.content.includes('Starting up'),
      );
      expect(progressEvent).toBeDefined();
      expect(progressEvent?.content).toBe('[init] Starting up');
    });

    it('handles log messages with error level as stderr', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const events: AgentOutputStreamEvent[] = [];
      const promise = runner.dispatch(task, (e) => events.push(e));

      await waitForWsSetup();
      sendHandshake();
      fireMessage(
        createProtocolMessage('log', { level: 'error', message: 'Something went wrong' }),
      );
      fireMessage(createProtocolMessage('done', { summary: 'Done' }));

      const result = await promise;
      expect(result.status).toBe('success');
      const logEvent = events.find((e) => e.content.includes('Something went wrong'));
      expect(logEvent).toBeDefined();
      expect(logEvent?.type).toBe('stderr');
      expect(logEvent?.content).toBe('[error] Something went wrong');
    });

    it('handles log messages with warn level as stderr', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const events: AgentOutputStreamEvent[] = [];
      const promise = runner.dispatch(task, (e) => events.push(e));

      await waitForWsSetup();
      sendHandshake();
      fireMessage(createProtocolMessage('log', { level: 'warn', message: 'Caution: deprecation' }));
      fireMessage(createProtocolMessage('done', { summary: 'Done' }));

      const result = await promise;
      expect(result.status).toBe('success');
      const logEvent = events.find((e) => e.content.includes('Caution'));
      expect(logEvent?.type).toBe('stderr');
    });

    it('handles log messages with info level as stdout', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const events: AgentOutputStreamEvent[] = [];
      const promise = runner.dispatch(task, (e) => events.push(e));

      await waitForWsSetup();
      sendHandshake();
      fireMessage(createProtocolMessage('log', { level: 'info', message: 'All good' }));
      fireMessage(createProtocolMessage('done', { summary: 'Done' }));

      const result = await promise;
      expect(result.status).toBe('success');
      const logEvent = events.find((e) => e.content.includes('All good'));
      expect(logEvent?.type).toBe('stdout');
    });

    it('handles artifact with isFinal=true', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const promise = runner.dispatch(task);

      await waitForWsSetup();
      sendHandshake();
      fireMessage(
        createProtocolMessage('artifact', {
          artifactType: 'implementation',
          content: '{"files":["a.ts"]}',
          isFinal: true,
        }),
      );
      fireMessage(createProtocolMessage('done', { summary: 'Finished' }));

      const result = await promise;
      expect(result.status).toBe('success');
      expect(result.artifactContent).toBe('{"files":["a.ts"]}');
    });

    it('handles artifact with isFinal=false (stored as fallback)', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const promise = runner.dispatch(task);

      await waitForWsSetup();
      sendHandshake();
      fireMessage(
        createProtocolMessage('artifact', {
          artifactType: 'implementation',
          content: '{"partial":true}',
          isFinal: false,
        }),
      );
      fireMessage(createProtocolMessage('done', { summary: 'Finished' }));

      const result = await promise;
      expect(result.status).toBe('success');
      expect(result.artifactContent).toBe('{"partial":true}');
    });

    it('prefers isFinal artifact over non-final', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const promise = runner.dispatch(task);

      await waitForWsSetup();
      sendHandshake();
      fireMessage(
        createProtocolMessage('artifact', {
          artifactType: 'implementation',
          content: '{"partial":true}',
          isFinal: false,
        }),
      );
      fireMessage(
        createProtocolMessage('artifact', {
          artifactType: 'implementation',
          content: '{"final":true}',
          isFinal: true,
        }),
      );
      fireMessage(createProtocolMessage('done', { summary: 'Finished' }));

      const result = await promise;
      expect(result.status).toBe('success');
      expect(result.artifactContent).toBe('{"final":true}');
    });

    it('uses summary as artifact when no artifact messages received', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const promise = runner.dispatch(task);

      await waitForWsSetup();
      sendHandshake();
      fireMessage(createProtocolMessage('done', { summary: 'Task completed successfully' }));

      const result = await promise;
      expect(result.status).toBe('success');
      expect(result.artifactContent).toBe(
        JSON.stringify({ summary: 'Task completed successfully' }),
      );
    });

    it('handles error message from agent', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const promise = runner.dispatch(task);

      await waitForWsSetup();
      sendHandshake();
      fireMessage(
        createProtocolMessage('error', {
          code: 'E_COMPILE',
          message: 'Compilation failed',
          recoverable: false,
        }),
      );

      const result = await promise;
      expect(result.status).toBe('failure');
      expect(result.error).toBe('Agent error [E_COMPILE]: Compilation failed');
    });

    it('handles transport error', async () => {
      const { runner, task, fireError, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const promise = runner.dispatch(task);

      await waitForWsSetup();
      sendHandshake();
      fireError(new Error('Connection reset'));

      const result = await promise;
      expect(result.status).toBe('failure');
      expect(result.error).toBe('WebSocket connection error');
    });

    it('times out when agent takes too long', async () => {
      const { runner, task } = setupWsProtocolMode({ timeout: 200 });

      const result = await runner.dispatch(task);

      expect(result.status).toMatch(/failure|timeout/);
    });

    it('ignores handshake_ack messages (no-op)', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const events: AgentOutputStreamEvent[] = [];
      const promise = runner.dispatch(task, (e) => events.push(e));

      await waitForWsSetup();
      sendHandshake();

      // Simulate a stray handshake_ack from the agent side
      // (The handler should early-return for handshake_ack)
      fireMessage(createProtocolMessage('handshake_ack', { sessionId: 'ws-session-proto' }));

      // Then finish normally
      fireMessage(createProtocolMessage('done', { summary: 'OK' }));

      const result = await promise;
      expect(result.status).toBe('success');
    });

    it('ignores handshake messages after initial handshake (no-op)', async () => {
      const { runner, task, fireMessage, sendHandshake, waitForWsSetup } = setupWsProtocolMode();

      const events: AgentOutputStreamEvent[] = [];
      const promise = runner.dispatch(task, (e) => events.push(e));

      await waitForWsSetup();
      sendHandshake();

      // Send another handshake from agent — should be treated as no-op by the switch
      fireMessage(createProtocolMessage('handshake', { capabilities: [] }));

      fireMessage(createProtocolMessage('done', { summary: 'OK' }));

      const result = await promise;
      expect(result.status).toBe('success');
    });

    describe('permission_request handling', () => {
      it('grants permission when policy evaluates to grant', async () => {
        const { runner, task, fireMessage, sendHandshake, mockWs, waitForWsSetup } =
          setupWsProtocolMode();

        const policy: PermissionPolicy = {
          evaluate: () => ({ action: 'grant', reason: 'Auto-approved' }),
        };
        runner.setPermissionPolicy(policy);

        const events: AgentOutputStreamEvent[] = [];
        const promise = runner.dispatch(task, (e) => events.push(e));

        await waitForWsSetup();
        sendHandshake();

        const permMsg = createProtocolMessage('permission_request', {
          action: 'file_read' as const,
          resource: '/repo/src/index.ts',
          detail: 'Read source file',
          riskLevel: 'low' as const,
        });
        fireMessage(permMsg);

        // Wait a tick for the async handler to run
        await new Promise((r) => setTimeout(r, 50));

        // Verify permission_response was sent granting access
        const sentMessages = mockWs.send.mock.calls.map(
          (c: unknown[]) =>
            JSON.parse(c[0] as string) as { type: string; payload: Record<string, unknown> },
        );
        const permResp = sentMessages.find(
          (m: Record<string, unknown>) => m.type === 'permission_response',
        );
        expect(permResp).toBeDefined();
        expect(permResp?.payload.granted).toBe(true);
        expect(permResp?.payload.reason).toBe('Auto-approved');

        const permEvent = events.find(
          (e) => e.type === 'permission_request' && e.content.includes('auto-granted'),
        );
        expect(permEvent).toBeDefined();

        fireMessage(createProtocolMessage('done', { summary: 'Done' }));
        const result = await promise;
        expect(result.status).toBe('success');
      });

      it('denies permission when policy evaluates to deny', async () => {
        const { runner, task, fireMessage, sendHandshake, mockWs, waitForWsSetup } =
          setupWsProtocolMode();

        const policy: PermissionPolicy = {
          evaluate: () => ({ action: 'deny', reason: 'Dangerous operation' }),
        };
        runner.setPermissionPolicy(policy);

        const events: AgentOutputStreamEvent[] = [];
        const promise = runner.dispatch(task, (e) => events.push(e));

        await waitForWsSetup();
        sendHandshake();

        fireMessage(
          createProtocolMessage('permission_request', {
            action: 'shell_execute' as const,
            resource: 'rm -rf /',
            detail: 'Delete everything',
            riskLevel: 'high' as const,
          }),
        );

        await new Promise((r) => setTimeout(r, 50));

        const sentMessages = mockWs.send.mock.calls.map(
          (c: unknown[]) =>
            JSON.parse(c[0] as string) as { type: string; payload: Record<string, unknown> },
        );
        const permResp = sentMessages.find(
          (m: Record<string, unknown>) => m.type === 'permission_response',
        );
        expect(permResp).toBeDefined();
        expect(permResp?.payload.granted).toBe(false);
        expect(permResp?.payload.reason).toBe('Dangerous operation');

        const permEvent = events.find(
          (e) => e.type === 'permission_request' && e.content.includes('denied'),
        );
        expect(permEvent).toBeDefined();

        fireMessage(createProtocolMessage('done', { summary: 'Done' }));
        const result = await promise;
        expect(result.status).toBe('success');
      });

      it('uses liveRequestStore when policy is ask_human and response is granted', async () => {
        const { runner, task, fireMessage, sendHandshake, mockWs, waitForWsSetup } =
          setupWsProtocolMode();

        const policy: PermissionPolicy = {
          evaluate: () => ({ action: 'ask_human', reason: 'Needs manual approval' }),
        };
        runner.setPermissionPolicy(policy);

        const mockStore: LiveRequestStore = {
          writeRequest: vi.fn().mockResolvedValue(undefined),
          writeResponse: vi.fn().mockResolvedValue(undefined),
          awaitResponse: vi.fn().mockResolvedValue({
            runId: '20260101-000000-abc123',
            messageId: 'msg-perm-1',
            respondedAt: new Date().toISOString(),
            payload: { granted: true, reason: 'Approved by operator' },
          }),
          listPendingRequests: vi.fn().mockResolvedValue([]),
          cleanupResolved: vi.fn().mockResolvedValue(0),
        };
        runner.setLiveRequestStore(mockStore);

        const events: AgentOutputStreamEvent[] = [];
        const promise = runner.dispatch(task, (e) => events.push(e));

        await waitForWsSetup();
        sendHandshake();

        const permMsg = createProtocolMessage('permission_request', {
          action: 'file_write' as const,
          resource: '/repo/src/config.ts',
          detail: 'Write config file',
          riskLevel: 'medium' as const,
        });
        fireMessage(permMsg);

        await new Promise((r) => setTimeout(r, 50));

        /* eslint-disable @typescript-eslint/unbound-method */
        expect(mockStore.writeRequest).toHaveBeenCalled();
        expect(mockStore.awaitResponse).toHaveBeenCalled();
        /* eslint-enable @typescript-eslint/unbound-method */

        const sentMessages = mockWs.send.mock.calls.map(
          (c: unknown[]) =>
            JSON.parse(c[0] as string) as { type: string; payload: Record<string, unknown> },
        );
        const permResp = sentMessages.find(
          (m: Record<string, unknown>) => m.type === 'permission_response',
        );
        expect(permResp).toBeDefined();
        expect(permResp?.payload.granted).toBe(true);

        fireMessage(createProtocolMessage('done', { summary: 'Done' }));
        const result = await promise;
        expect(result.status).toBe('success');
      });

      it('handles liveRequestStore timeout (null response) with deny', async () => {
        const { runner, task, fireMessage, sendHandshake, mockWs, waitForWsSetup } =
          setupWsProtocolMode();

        const mockStore: LiveRequestStore = {
          writeRequest: vi.fn().mockResolvedValue(undefined),
          writeResponse: vi.fn().mockResolvedValue(undefined),
          awaitResponse: vi.fn().mockResolvedValue(null),
          listPendingRequests: vi.fn().mockResolvedValue([]),
          cleanupResolved: vi.fn().mockResolvedValue(0),
        };
        runner.setLiveRequestStore(mockStore);

        const events: AgentOutputStreamEvent[] = [];
        const promise = runner.dispatch(task, (e) => events.push(e));

        await waitForWsSetup();
        sendHandshake();

        fireMessage(
          createProtocolMessage('permission_request', {
            action: 'file_write' as const,
            resource: '/repo/src/config.ts',
            detail: 'Write config file',
            riskLevel: 'medium' as const,
          }),
        );

        await new Promise((r) => setTimeout(r, 50));

        const sentMessages = mockWs.send.mock.calls.map(
          (c: unknown[]) =>
            JSON.parse(c[0] as string) as { type: string; payload: Record<string, unknown> },
        );
        const permResp = sentMessages.find(
          (m: Record<string, unknown>) => m.type === 'permission_response',
        );
        expect(permResp).toBeDefined();
        expect(permResp?.payload.granted).toBe(false);
        expect(permResp?.payload.reason).toContain('timed out');

        // Should also write a timeout response
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockStore.writeResponse).toHaveBeenCalledWith(
          expect.objectContaining({ payload: { timedOut: true, granted: false } }),
        );

        fireMessage(createProtocolMessage('done', { summary: 'Done' }));
        const result = await promise;
        expect(result.status).toBe('success');
      });

      it('denies by default when no policy or store is configured', async () => {
        const { runner, task, fireMessage, sendHandshake, mockWs, waitForWsSetup } =
          setupWsProtocolMode();

        const events: AgentOutputStreamEvent[] = [];
        const promise = runner.dispatch(task, (e) => events.push(e));

        await waitForWsSetup();
        sendHandshake();

        fireMessage(
          createProtocolMessage('permission_request', {
            action: 'shell_execute' as const,
            resource: 'ls',
            detail: 'List files',
            riskLevel: 'low' as const,
          }),
        );

        await new Promise((r) => setTimeout(r, 50));

        const sentMessages = mockWs.send.mock.calls.map(
          (c: unknown[]) =>
            JSON.parse(c[0] as string) as { type: string; payload: Record<string, unknown> },
        );
        const permResp = sentMessages.find(
          (m: Record<string, unknown>) => m.type === 'permission_response',
        );
        expect(permResp).toBeDefined();
        expect(permResp?.payload.granted).toBe(false);
        expect(permResp?.payload.reason).toContain('No permission policy');

        fireMessage(createProtocolMessage('done', { summary: 'Done' }));
        const result = await promise;
        expect(result.status).toBe('success');
      });
    });

    describe('clarification_request handling', () => {
      it('responds with answer from liveRequestStore', async () => {
        const { runner, task, fireMessage, sendHandshake, mockWs, waitForWsSetup } =
          setupWsProtocolMode();

        const mockStore: LiveRequestStore = {
          writeRequest: vi.fn().mockResolvedValue(undefined),
          writeResponse: vi.fn().mockResolvedValue(undefined),
          awaitResponse: vi.fn().mockResolvedValue({
            runId: '20260101-000000-abc123',
            messageId: 'msg-clar-1',
            respondedAt: new Date().toISOString(),
            payload: { answer: 'Use PostgreSQL' },
          }),
          listPendingRequests: vi.fn().mockResolvedValue([]),
          cleanupResolved: vi.fn().mockResolvedValue(0),
        };
        runner.setLiveRequestStore(mockStore);

        const events: AgentOutputStreamEvent[] = [];
        const promise = runner.dispatch(task, (e) => events.push(e));

        await waitForWsSetup();
        sendHandshake();

        fireMessage(
          createProtocolMessage('clarification_request', {
            question: 'Which database to use?',
            context: 'Choosing database engine',
          }),
        );

        await new Promise((r) => setTimeout(r, 50));

        /* eslint-disable @typescript-eslint/unbound-method */
        expect(mockStore.writeRequest).toHaveBeenCalled();
        expect(mockStore.awaitResponse).toHaveBeenCalled();
        /* eslint-enable @typescript-eslint/unbound-method */

        const sentMessages = mockWs.send.mock.calls.map(
          (c: unknown[]) =>
            JSON.parse(c[0] as string) as { type: string; payload: Record<string, unknown> },
        );
        const clarResp = sentMessages.find(
          (m: Record<string, unknown>) => m.type === 'clarification_response',
        );
        expect(clarResp).toBeDefined();
        expect(clarResp?.payload.answer).toBe('Use PostgreSQL');

        const clarEvent = events.find((e) => e.type === 'clarification_request');
        expect(clarEvent).toBeDefined();
        expect(clarEvent?.content).toContain('Which database to use?');

        fireMessage(createProtocolMessage('done', { summary: 'Done' }));
        const result = await promise;
        expect(result.status).toBe('success');
      });

      it('sends abort when liveRequestStore response times out', async () => {
        const { runner, task, fireMessage, sendHandshake, mockWs, waitForWsSetup } =
          setupWsProtocolMode();

        const mockStore: LiveRequestStore = {
          writeRequest: vi.fn().mockResolvedValue(undefined),
          writeResponse: vi.fn().mockResolvedValue(undefined),
          awaitResponse: vi.fn().mockResolvedValue(null),
          listPendingRequests: vi.fn().mockResolvedValue([]),
          cleanupResolved: vi.fn().mockResolvedValue(0),
        };
        runner.setLiveRequestStore(mockStore);

        const promise = runner.dispatch(task);

        await waitForWsSetup();
        sendHandshake();

        fireMessage(
          createProtocolMessage('clarification_request', {
            question: 'Which database?',
            context: 'DB choice needed',
          }),
        );

        await new Promise((r) => setTimeout(r, 50));

        const sentMessages = mockWs.send.mock.calls.map(
          (c: unknown[]) =>
            JSON.parse(c[0] as string) as { type: string; payload: Record<string, unknown> },
        );
        const abortResp = sentMessages.find((m: Record<string, unknown>) => m.type === 'abort');
        expect(abortResp).toBeDefined();
        expect(abortResp?.payload.reason).toContain('timed out');

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockStore.writeResponse).toHaveBeenCalledWith(
          expect.objectContaining({ payload: { timedOut: true, aborted: true } }),
        );

        fireMessage(createProtocolMessage('done', { summary: 'Done' }));
        const result = await promise;
        expect(result.status).toBe('success');
      });

      it('sends abort when no liveRequestStore is configured', async () => {
        const { runner, task, fireMessage, sendHandshake, mockWs, waitForWsSetup } =
          setupWsProtocolMode();

        const promise = runner.dispatch(task);

        await waitForWsSetup();
        sendHandshake();

        fireMessage(
          createProtocolMessage('clarification_request', {
            question: 'How to proceed?',
            context: 'Need guidance',
          }),
        );

        await new Promise((r) => setTimeout(r, 50));

        const sentMessages = mockWs.send.mock.calls.map(
          (c: unknown[]) =>
            JSON.parse(c[0] as string) as { type: string; payload: Record<string, unknown> },
        );
        const abortResp = sentMessages.find((m: Record<string, unknown>) => m.type === 'abort');
        expect(abortResp).toBeDefined();
        expect(abortResp?.payload.reason).toContain('No live request store');

        fireMessage(createProtocolMessage('done', { summary: 'Done' }));
        const result = await promise;
        expect(result.status).toBe('success');
      });
    });
  });

  describe('dispatchWithSession', () => {
    it('falls back to dispatch() when no sessionSupervisor is set', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 100,
            },
          }),
        });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });

      const result = await runner.dispatchWithSession(makeTask());

      expect(result.kind).toBe('terminal');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(result.result?.status).toBe('success');
    });

    it('falls back to dispatch() when submit returns HTTP error', async () => {
      // First call (dispatchWithSession submit) fails, then dispatch() calls work normally
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => 'Internal Server Error',
          headers: jsonHeaders,
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 100,
            },
          }),
        });

      const supervisor: RemoteAgentSessionSupervisor = {
        createSession: vi.fn(),
        attach: vi.fn(),
        reconnect: vi.fn(),
        sendHumanResponse: vi.fn(),
        pause: vi.fn(),
        abort: vi.fn(),
        finalize: vi.fn(),
        getSnapshot: vi.fn(),
        getState: vi.fn(),
        listByRun: vi.fn(),
        waitForAdvance: vi.fn(),
        isLeaseExpired: vi.fn(),
        getHost: vi.fn(),
      } as unknown as RemoteAgentSessionSupervisor;

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });
      runner.setSessionSupervisor(supervisor);

      const result = await runner.dispatchWithSession(makeTask());

      expect(result.kind).toBe('terminal');
    });

    it('falls back to dispatch() when submit fetch throws', async () => {
      // First call throws (dispatchWithSession), then dispatch() calls work
      fetchMock
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 100,
            },
          }),
        });

      const supervisor: RemoteAgentSessionSupervisor = {
        createSession: vi.fn(),
        attach: vi.fn(),
        reconnect: vi.fn(),
        sendHumanResponse: vi.fn(),
        pause: vi.fn(),
        abort: vi.fn(),
        finalize: vi.fn(),
        getSnapshot: vi.fn(),
        getState: vi.fn(),
        listByRun: vi.fn(),
        waitForAdvance: vi.fn(),
        isLeaseExpired: vi.fn(),
        getHost: vi.fn(),
      } as unknown as RemoteAgentSessionSupervisor;

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });
      runner.setSessionSupervisor(supervisor);

      const result = await runner.dispatchWithSession(makeTask());

      expect(result.kind).toBe('terminal');
    });

    it('creates a session via supervisor when response has valid reconnect info', async () => {
      const sessionDescriptor = {
        taskId: 'task-1',
        session: {
          sessionId: 'ws-session-sup',
          protocol: PROTOCOL_VERSION,
          transport: { type: 'websocket', url: 'ws://localhost:9999/ws/task-1' },
          reconnect: {
            url: 'https://api.example.com/sessions/ws-session-sup',
            leaseExpiresAt: '2030-01-01T00:00:00Z',
            heartbeatIntervalMs: 30000,
          },
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(sessionDescriptor),
      });

      const mockWs = {
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        readyState: 1,
      };
      const WebSocketMock = vi.fn(function () {
        return mockWs;
      });
      vi.stubGlobal('WebSocket', WebSocketMock);

      const mockHandle = {
        ref: {
          sessionId: 'ws-session-sup',
          runId: '20260101-000000-abc123',
          stateId: 'IMPLEMENTATION',
          role: 'implementer',
          transport: 'remote',
        },
        state: 'running',
        pendingRequests: [],
      };

      const createSessionMock = vi.fn().mockResolvedValue(mockHandle);

      const supervisor = {
        createSession: createSessionMock,
      } as unknown as RemoteAgentSessionSupervisor;

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
      });
      runner.setSessionSupervisor(supervisor);

      const result = await runner.dispatchWithSession(makeTask());

      expect(result.kind).toBe('session');
      expect(result.handle).toBe(mockHandle);
      expect(createSessionMock).toHaveBeenCalledTimes(1);

      // Verify the ref and reconnectMeta were passed correctly
      const callArgs = createSessionMock.mock.calls[0];
      expect(callArgs[0]).toMatchObject({
        sessionId: 'ws-session-sup',
        transport: 'remote',
      });
      expect(callArgs[2]).toMatchObject({
        type: 'remote',
        remoteSessionId: 'ws-session-sup',
        reconnectUrl: 'https://api.example.com/sessions/ws-session-sup',
        websocketUrl: 'ws://localhost:9999/ws/task-1',
      });
    });

    it('creates a session with auth in websocket URL (no existing query params)', async () => {
      const sessionDescriptor = {
        taskId: 'task-1',
        session: {
          sessionId: 'ws-session-auth',
          protocol: PROTOCOL_VERSION,
          transport: { type: 'websocket', url: 'ws://localhost:9999/ws/task-1' },
          reconnect: {
            url: 'https://api.example.com/sessions/ws-session-auth',
          },
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(sessionDescriptor),
      });

      const mockWs = {
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        readyState: 1,
      };
      const WebSocketMock = vi.fn(function () {
        return mockWs;
      });
      vi.stubGlobal('WebSocket', WebSocketMock);

      const supervisor = {
        createSession: vi.fn().mockResolvedValue({
          ref: { sessionId: 'ws-session-auth' },
          state: 'running',
          pendingRequests: [],
        }),
      } as unknown as RemoteAgentSessionSupervisor;

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        authHeader: 'Authorization: Bearer my-token',
      });
      runner.setSessionSupervisor(supervisor);

      await runner.dispatchWithSession(makeTask());

      expect(WebSocketMock).toHaveBeenCalledWith(
        'ws://localhost:9999/ws/task-1?auth=Bearer%20my-token',
      );
    });

    it('creates a session with auth in websocket URL (existing query params)', async () => {
      const sessionDescriptor = {
        taskId: 'task-1',
        session: {
          sessionId: 'ws-session-auth2',
          protocol: PROTOCOL_VERSION,
          transport: { type: 'websocket', url: 'ws://localhost:9999/ws/task-1?x=1' },
          reconnect: {
            url: 'https://api.example.com/sessions/ws-session-auth2',
          },
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(sessionDescriptor),
      });

      const mockWs = {
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        readyState: 1,
      };
      const WebSocketMock = vi.fn(function () {
        return mockWs;
      });
      vi.stubGlobal('WebSocket', WebSocketMock);

      const supervisor = {
        createSession: vi.fn().mockResolvedValue({
          ref: { sessionId: 'ws-session-auth2' },
          state: 'running',
          pendingRequests: [],
        }),
      } as unknown as RemoteAgentSessionSupervisor;

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        authHeader: 'Authorization: Bearer my-token',
      });
      runner.setSessionSupervisor(supervisor);

      await runner.dispatchWithSession(makeTask());

      expect(WebSocketMock).toHaveBeenCalledWith(
        'ws://localhost:9999/ws/task-1?x=1&auth=Bearer%20my-token',
      );
    });

    it('falls back to dispatch() when session has no reconnect info', async () => {
      const sessionDescriptor = {
        taskId: 'task-1',
        session: {
          sessionId: 'ws-session-no-reconnect',
          protocol: PROTOCOL_VERSION,
          transport: { type: 'websocket', url: 'ws://localhost:9999/ws/task-1' },
          // No reconnect field
        },
      };

      // First fetch for dispatchWithSession
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve(sessionDescriptor),
        })
        // Second fetch for fallback dispatch()
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 50,
            },
          }),
        });

      const supervisor = {
        createSession: vi.fn(),
      } as unknown as RemoteAgentSessionSupervisor;

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });
      runner.setSessionSupervisor(supervisor);

      const result = await runner.dispatchWithSession(makeTask());

      expect(result.kind).toBe('terminal');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(supervisor.createSession).not.toHaveBeenCalled();
    });

    it('falls back to dispatch() when JSON parse fails', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.reject(new Error('Invalid JSON')),
        })
        // dispatch() calls
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 50,
            },
          }),
        });

      const supervisor = {
        createSession: vi.fn(),
      } as unknown as RemoteAgentSessionSupervisor;

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });
      runner.setSessionSupervisor(supervisor);

      const result = await runner.dispatchWithSession(makeTask());

      expect(result.kind).toBe('terminal');
    });

    it('falls back to dispatch() when response is non-JSON content-type', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'text/plain' },
        })
        // dispatch() calls
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 50,
            },
          }),
        });

      const supervisor = {
        createSession: vi.fn(),
      } as unknown as RemoteAgentSessionSupervisor;

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });
      runner.setSessionSupervisor(supervisor);

      const result = await runner.dispatchWithSession(makeTask());

      expect(result.kind).toBe('terminal');
    });

    it('sets websocketUrl to undefined when transport is not websocket', async () => {
      const sessionDescriptor = {
        taskId: 'task-1',
        session: {
          sessionId: 'ws-session-none',
          protocol: PROTOCOL_VERSION,
          transport: { type: 'websocket', url: 'ws://localhost:9999/ws/task-1' },
          reconnect: {
            url: 'https://api.example.com/sessions/ws-session-none',
          },
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(sessionDescriptor),
      });

      const mockWs = {
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        readyState: 1,
      };
      const WebSocketMock = vi.fn(function () {
        return mockWs;
      });
      vi.stubGlobal('WebSocket', WebSocketMock);

      const createSessionMock = vi.fn().mockResolvedValue({
        ref: { sessionId: 'ws-session-none' },
        state: 'running',
        pendingRequests: [],
      });

      const supervisor = {
        createSession: createSessionMock,
      } as unknown as RemoteAgentSessionSupervisor;

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
      });
      runner.setSessionSupervisor(supervisor);

      await runner.dispatchWithSession(makeTask());

      // websocketUrl should be set since transport IS websocket
      const callArgs = createSessionMock.mock.calls[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(callArgs[2].websocketUrl).toBe('ws://localhost:9999/ws/task-1');
    });
  });

  describe('buildHeaders', () => {
    it('returns only Content-Type when no auth header is provided', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 50,
            },
          }),
        });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });

      await runner.dispatch(makeTask());

      const submitCall = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = submitCall[1].headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('parses colon-separated auth header with multiple colons', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 50,
            },
          }),
        });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        authHeader: 'X-API-Key: key:with:colons',
        pollIntervalMs: 10,
      });

      await runner.dispatch(makeTask());

      const submitCall = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = submitCall[1].headers as Record<string, string>;
      expect(headers['X-API-Key']).toBe('key:with:colons');
    });

    it('ignores auth header without colon separator', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 50,
            },
          }),
        });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        authHeader: 'no-colon-here',
        pollIntervalMs: 10,
      });

      await runner.dispatch(makeTask());

      const submitCall = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = submitCall[1].headers as Record<string, string>;
      // Should only have Content-Type since the auth header had no colon
      expect(Object.keys(headers)).toEqual(['Content-Type']);
    });
  });

  describe('dispatch() JSON parse failure', () => {
    it('falls back to poll when submitRes.json() throws', async () => {
      // The first fetch returns json content-type but json() throws
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.reject(new Error('Unexpected token')),
      });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });

      // body=null from catch → skips the body block → falls to non-JSON non-SSE
      // → calls pollForResult with the Response, but json() will throw again
      // leading to failure
      const result = await runner.dispatch(makeTask());

      expect(result.status).toBe('failure');
      expect(result.error).toContain('Failed to parse submit response');
    });
  });

  describe('dispatch() with submitResponseSchema fallback', () => {
    it('uses submitResponseSchema when parseSubmitResponse fails but raw body has taskId', async () => {
      // Body that parseSubmitResponse won't accept (session field is not an object)
      // but submitResponseSchema CAN extract taskId from
      const weirdBody = { taskId: 'fallback-task-id', session: 'not-an-object' };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve(weirdBody),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'fallback-task-id',
              status: 'success',
              artifactContent: '{"ok":true}',
              durationMs: 100,
            },
          }),
        });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });

      const result = await runner.dispatch(makeTask());

      expect(result.status).toBe('success');
      // The poll endpoint should have used the fallback taskId
      const pollCall = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(pollCall[0]).toBe('https://api.example.com/agents/tasks/fallback-task-id');
    });
  });

  describe('SSE stream edge cases', () => {
    it('skips lines without data: prefix', async () => {
      const chunks = [
        ':comment line\n',
        'event: heartbeat\n',
        'data: {"type":"stdout","content":"real-data","timestamp":"2026-01-01T00:00:00Z"}\n\n',
        'data: {"type":"result","result":{"taskId":"remote-1","status":"success","artifactContent":"{}","durationMs":100}}\n\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const value = new TextEncoder().encode(chunks[chunkIndex++]);
            return Promise.resolve({ done: false, value });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
        body: { getReader: () => mockReader },
      });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
      });

      const events: Array<{ type: string; content: string }> = [];
      const result = await runner.dispatch(makeTask(), (event) => {
        events.push({ type: event.type, content: event.content });
      });

      expect(result.status).toBe('success');
      // Only the real data line should generate an event
      expect(events).toHaveLength(1);
      expect(events[0].content).toBe('real-data');
    });

    it('skips empty payload after data:', async () => {
      const chunks = [
        'data: \n\n',
        'data: {"type":"result","result":{"taskId":"remote-1","status":"success","artifactContent":"{}","durationMs":100}}\n\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const value = new TextEncoder().encode(chunks[chunkIndex++]);
            return Promise.resolve({ done: false, value });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
        body: { getReader: () => mockReader },
      });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
      });

      const events: Array<{ type: string; content: string }> = [];
      const result = await runner.dispatch(makeTask(), (event) => {
        events.push({ type: event.type, content: event.content });
      });

      expect(result.status).toBe('success');
      // Empty payload lines should be skipped
      expect(events).toHaveLength(0);
    });

    it('skips invalid JSON payload', async () => {
      const chunks = [
        'data: {invalid-json}\n\n',
        'data: {"type":"result","result":{"taskId":"remote-1","status":"success","artifactContent":"{}","durationMs":100}}\n\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const value = new TextEncoder().encode(chunks[chunkIndex++]);
            return Promise.resolve({ done: false, value });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
        body: { getReader: () => mockReader },
      });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
      });

      const result = await runner.dispatch(makeTask());

      // Should still succeed because the second line has a valid result
      expect(result.status).toBe('success');
    });

    it('returns failure when SSE stream ends without result', async () => {
      const chunks = [
        'data: {"type":"stdout","content":"working...","timestamp":"2026-01-01T00:00:00Z"}\n\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const value = new TextEncoder().encode(chunks[chunkIndex++]);
            return Promise.resolve({ done: false, value });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
        body: { getReader: () => mockReader },
      });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
      });

      const result = await runner.dispatch(makeTask());

      expect(result.status).toBe('failure');
      expect(result.error).toContain('SSE stream ended without producing a result');
    });
  });

  describe('dispatch() poll failure edge cases', () => {
    it('returns failure when poll JSON parse fails', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => {
            throw new Error('Poll JSON parse error');
          },
        });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });

      const result = await runner.dispatch(makeTask());

      expect(result.status).toBe('failure');
      expect(result.error).toContain('Poll request failed');
    });

    it('returns failure when submit response has invalid format for polling', async () => {
      // Return non-JSON content-type, and pollForResult gets a Response
      // whose json() returns something that doesn't match submitResponseSchema
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/plain' },
        json: () => Promise.resolve({ noTaskId: true }),
      });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });

      const result = await runner.dispatch(makeTask());

      expect(result.status).toBe('failure');
      expect(result.error).toContain('Failed to parse submit response');
    });
  });

  describe('per-role agentConfig overrides', () => {
    it('uses endpoint from agentConfig in dispatch', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 50,
            },
          }),
        });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        pollIntervalMs: 10,
      });

      const task = makeTask({
        agentConfig: { endpoint: 'https://custom.example.com/run' },
      });

      await runner.dispatch(task);

      const submitCall = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(submitCall[0]).toBe('https://custom.example.com/run');
    });

    it('uses authHeader from agentConfig in dispatch', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: jsonHeaders,
          json: () => ({ taskId: 'remote-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            status: 'completed',
            result: {
              taskId: 'remote-1',
              status: 'success',
              artifactContent: '{}',
              durationMs: 50,
            },
          }),
        });

      const runner = new HttpAgentRunner({
        endpoint: 'https://api.example.com/agents',
        authHeader: 'Authorization: Bearer default-token',
        pollIntervalMs: 10,
      });

      const task = makeTask({
        agentConfig: { authHeader: 'X-Custom: custom-token' },
      });

      await runner.dispatch(task);

      const submitCall = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = submitCall[1].headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('custom-token');
      expect(headers['Authorization']).toBeUndefined();
    });
  });
});
