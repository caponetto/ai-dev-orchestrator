import { request } from 'node:http';

import type {
  AgentStreamBus,
  AgentStreamEvent,
  DashboardActionHandler,
  DashboardDataProvider,
  SettingsProvider,
} from '@ai-orchestrator/ports';
import type { LiveRequestStore, PermissionApprovalStore } from '@ai-orchestrator/runner';
import type {
  ArtifactContentView,
  ArtifactDetailView,
  ArtifactInventoryView,
  DashboardActionResult,
  DashboardEvent,
  PermissionApprovalEntry,
  RunConfigView,
  RunStateView,
  RunSummaryView,
  UsageBreakdownView,
  WorkflowStateView,
  WorkflowSummary,
} from '@ai-orchestrator/schemas';
import { err, ok } from '@ai-orchestrator/schemas';
import { describe, expect, it, afterEach } from 'vitest';

import { DashboardHttpServer } from '../dashboard-http-server';
import { SseEventStream } from '../sse-event-stream';

function createMockProvider(overrides: Partial<DashboardDataProvider> = {}): DashboardDataProvider {
  return {
    getRunState: () => err(new Error('not found')),
    getWorkflowView: () => err(new Error('not found')),
    getArtifactView: () => err(new Error('not found')),
    getArtifactDetail: () => err(new Error('not found')),
    getIterationView: () => err(new Error('not found')),
    getFindingsView: () => err(new Error('not found')),
    getUsageView: () => err(new Error('not found')),
    getRunHistory: () => ok([]),
    getArtifactContent: () => err(new Error('not found')),
    getRunConfig: () => null,
    getRunEvents: () => [],
    getSystemHealth: () => err(new Error('not found')),
    ...overrides,
  };
}

async function waitForClients(
  getCount: () => number,
  expected: number,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (getCount() < expected) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for ${String(expected)} client(s) (got ${String(getCount())})`,
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface SSEConnection {
  data: Promise<string>;
  connected: Promise<void>;
}

function connectSSE(port: number, path: string): SSEConnection {
  let resolveConnected!: () => void;
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });

  const data = new Promise<string>((resolve) => {
    let buffer = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      resolveConnected();
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          resolve(buffer);
          res.destroy();
        }, 50);
      });
    });
    req.end();
  });

  return { data, connected };
}

function httpGet(
  port: number,
  path: string,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body,
          headers: res.headers as Record<string, string>,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk: Buffer) => {
          responseBody += chunk.toString();
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: responseBody });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpDelete(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'DELETE' }, (res) => {
      let responseBody = '';
      res.on('data', (chunk: Buffer) => {
        responseBody += chunk.toString();
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: responseBody });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPut(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk: Buffer) => {
          responseBody += chunk.toString();
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: responseBody });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('DashboardHttpServer', () => {
  let server: DashboardHttpServer;
  let eventStream: SseEventStream;

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- server may not be assigned if a test fails before assignment
    if (server) {
      await server.stop();
    }
  });

  it('starts and stops cleanly', async () => {
    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
    });
    await server.start();
    expect(server.getPort()).toBeGreaterThan(0);
    await server.stop();
  });

  it('health endpoint returns ok', async () => {
    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
    });
    await server.start();

    const res = await httpGet(server.getPort(), '/api/health');
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body) as { status: string; clients: number };
    expect(data.status).toBe('ok');
    expect(data.clients).toBe(0);
  });

  it('returns 404 for unknown routes', async () => {
    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
    });
    await server.start();

    const res = await httpGet(server.getPort(), '/api/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns run state from data provider', async () => {
    eventStream = new SseEventStream();
    const mockState: RunStateView = {
      runId: 'run-1',
      status: 'running',
      currentState: 'PLANNING',
      previousState: 'INTAKE',
      startedAt: '2026-01-01T00:00:00Z',
      stateEnteredAt: '2026-01-01T00:00:05Z',
      elapsedMs: 5000,
      transitionCount: 2,
      isWaitingForHuman: false,
    };

    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider({ getRunState: () => ok(mockState) }),
      eventStream,
    });
    await server.start();

    const res = await httpGet(server.getPort(), '/api/runs/run-1/state');
    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as { currentState: string }).currentState).toBe('PLANNING');
  });

  it('returns 404 when run state not found', async () => {
    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
    });
    await server.start();

    const res = await httpGet(server.getPort(), '/api/runs/nonexistent/state');
    expect(res.status).toBe(404);
  });

  it('returns usage view from data provider', async () => {
    eventStream = new SseEventStream();
    const mockUsage: UsageBreakdownView = {
      runId: 'run-1',
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      byRole: [],
    };

    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider({ getUsageView: () => ok(mockUsage) }),
      eventStream,
    });
    await server.start();

    const res = await httpGet(server.getPort(), '/api/runs/run-1/usage');
    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as { totalTokens: number }).totalTokens).toBe(150);
  });

  it('returns run history with limit', async () => {
    eventStream = new SseEventStream();
    const runs: RunSummaryView[] = Array.from({ length: 5 }, (_, i) => ({
      runId: `run-${String(i)}`,
      repository: 'test',
      workflow: 'default',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T01:00:00Z',
      durationMs: 3600000,
      totalArtifacts: 1,
      totalTokens: 100,
      totalInputTokens: 80,
      totalOutputTokens: 20,
      finalState: 'DONE',
    }));

    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider({ getRunHistory: () => ok(runs) }),
      eventStream,
    });
    await server.start();

    const res = await httpGet(server.getPort(), '/api/runs?limit=2');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(2);
  });

  it('returns artifact inventory', async () => {
    eventStream = new SseEventStream();
    const mockArtifacts: ArtifactInventoryView = {
      runId: 'run-1',
      artifacts: [],
      totalCount: 0,
      totalSizeBytes: 0,
      byType: {},
    };

    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider({ getArtifactView: () => ok(mockArtifacts) }),
      eventStream,
    });
    await server.start();

    const res = await httpGet(server.getPort(), '/api/runs/run-1/artifacts');
    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as { totalCount: number }).totalCount).toBe(0);
  });

  it('SSE endpoint sets correct headers', async () => {
    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
    });
    await server.start();

    const port = server.getPort();

    const headers = await new Promise<Record<string, string>>((resolve) => {
      const req = request(
        { hostname: '127.0.0.1', port, path: '/events', method: 'GET' },
        (res) => {
          resolve(res.headers as Record<string, string>);
          res.destroy();
        },
      );
      req.end();
    });

    expect(headers['content-type']).toBe('text/event-stream');
    expect(headers['cache-control']).toBe('no-cache');
  });

  it('SSE client receives broadcasted events', async () => {
    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
    });
    await server.start();

    const { data: dataPromise, connected } = connectSSE(server.getPort(), '/events');
    await connected;
    await waitForClients(() => eventStream.getClientCount(), 1);

    const event: DashboardEvent = {
      type: 'state_changed',
      timestamp: '2026-01-01T00:00:00Z',
      runId: 'run-1',
      data: { from: 'INTAKE', to: 'PLANNING' },
    };
    eventStream.publish(event);

    const receivedData = await dataPromise;
    expect(receivedData).toContain('data:');
    expect(receivedData).toContain('state_changed');
  });

  it('SSE client with type filter only receives matching events', async () => {
    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
    });
    await server.start();

    const { data: dataPromise, connected } = connectSSE(
      server.getPort(),
      '/events?types=artifact_produced',
    );
    await connected;
    await waitForClients(() => eventStream.getClientCount(), 1);

    eventStream.publish({
      type: 'state_changed',
      timestamp: '2026-01-01T00:00:00Z',
      runId: 'run-1',
      data: {},
    });
    eventStream.publish({
      type: 'artifact_produced',
      timestamp: '2026-01-01T00:00:01Z',
      runId: 'run-1',
      data: { artifact: 'spec' },
    });

    const receivedData = await dataPromise;
    expect(receivedData).toContain('artifact_produced');
    expect(receivedData).not.toContain('state_changed');
  });

  it('SSE client disconnect updates client count', async () => {
    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
    });
    await server.start();

    const port = server.getPort();

    await new Promise<void>((resolve) => {
      const req = request(
        { hostname: '127.0.0.1', port, path: '/events', method: 'GET' },
        (res) => {
          expect(server.getClientCount()).toBe(1);
          res.destroy();
          setTimeout(() => {
            expect(server.getClientCount()).toBe(0);
            resolve();
          }, 50);
        },
      );
      req.end();
    });
  });

  it('agent-stream SSE endpoint delivers run-filtered events', async () => {
    const subscribers = new Map<string, (event: AgentStreamEvent) => void>();
    let nextId = 1;
    const agentBus: AgentStreamBus = {
      subscribe: (cb) => {
        const id = `c-${String(nextId++)}`;
        subscribers.set(id, cb);
        return id;
      },
      unsubscribe: (id) => subscribers.delete(id),
      publish: (event) => {
        for (const [, cb] of subscribers) {
          cb(event);
        }
      },
      getClientCount: () => subscribers.size,
    };

    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
      agentStreamBus: agentBus,
    });
    await server.start();

    const port = server.getPort();

    const { data: dataPromise, connected } = connectSSE(port, '/api/runs/run-1/agent-stream');
    await connected;
    await waitForClients(() => agentBus.getClientCount(), 1);

    agentBus.publish({
      runId: 'run-other',
      stateId: 'PLANNING',
      roleId: 'planner',
      dispatchId: 'dispatch-1',
      timestamp: '2026-01-01T00:00:00Z',
      type: 'stdout',
      content: 'wrong run',
    });
    agentBus.publish({
      runId: 'run-1',
      stateId: 'PLAN_REVIEW',
      roleId: 'plan_reviewer',
      dispatchId: 'dispatch-2',
      timestamp: '2026-01-01T00:00:01Z',
      type: 'stdout',
      content: 'hello from agent',
    });

    const receivedData = await dataPromise;
    expect(receivedData).toContain('hello from agent');
    expect(receivedData).not.toContain('wrong run');
  });

  it('agent-stream SSE endpoint replays existing run history on connect', async () => {
    const subscribers = new Map<string, (event: AgentStreamEvent) => void>();
    let nextId = 1;
    const historicalEvent: AgentStreamEvent = {
      runId: 'run-1',
      stateId: 'REFINEMENT',
      roleId: 'requirements_analyst',
      dispatchId: 'dispatch-1',
      timestamp: '2026-01-01T00:00:00Z',
      type: 'stdout',
      content: 'historical output',
    };
    const agentBus: AgentStreamBus & {
      getRunHistory: (runId: string) => readonly AgentStreamEvent[];
    } = {
      subscribe: (cb) => {
        const id = `c-${String(nextId++)}`;
        subscribers.set(id, cb);
        return id;
      },
      unsubscribe: (id) => subscribers.delete(id),
      publish: (event) => {
        for (const [, cb] of subscribers) {
          cb(event);
        }
      },
      getClientCount: () => subscribers.size,
      getRunHistory: (runId) => (runId === 'run-1' ? [historicalEvent] : []),
    };

    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
      agentStreamBus: agentBus,
    });
    await server.start();

    const port = server.getPort();

    const receivedData = await new Promise<string>((resolve) => {
      const req = request(
        { hostname: '127.0.0.1', port, path: '/api/runs/run-1/agent-stream', method: 'GET' },
        (res) => {
          res.on('data', (chunk: Buffer) => {
            resolve(chunk.toString());
            res.destroy();
          });
        },
      );
      req.end();
    });

    expect(receivedData).toContain('historical output');
  });

  it('agent-stream returns 404 when no bus configured', async () => {
    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider(),
      eventStream,
    });
    await server.start();

    const port = server.getPort();
    const res = await httpGet(port, '/api/runs/run-1/agent-stream');
    expect(res.status).toBe(404);
  });

  it('returns historical run events', async () => {
    eventStream = new SseEventStream();
    server = new DashboardHttpServer({
      config: { port: 0 },
      dataProvider: createMockProvider({
        getRunEvents: () => [
          {
            type: 'state_changed',
            timestamp: '2026-01-01T00:00:00Z',
            runId: 'run-1',
            data: { stateId: 'REFINEMENT' },
          },
        ],
      }),
      eventStream,
    });
    await server.start();

    const res = await httpGet(server.getPort(), '/api/runs/run-1/events');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual([
      {
        type: 'state_changed',
        timestamp: '2026-01-01T00:00:00Z',
        runId: 'run-1',
        data: { stateId: 'REFINEMENT' },
      },
    ]);
  });

  describe('persisted action routes', () => {
    function createMockActionHandler(
      overrides: Partial<DashboardActionHandler> = {},
    ): DashboardActionHandler {
      return {
        approve: () => Promise.resolve({ success: true }),
        reject: () => Promise.resolve({ success: true }),
        abort: () => Promise.resolve({ success: true }),
        answer: () => Promise.resolve({ success: true }),
        deleteRun: () => Promise.resolve({ success: true }),
        createRun: () => Promise.resolve({ success: true }),
        listWorkflows: () => [],
        getWorkflowPreview: () => null,
        ...overrides,
      };
    }

    function httpPost(
      port: number,
      path: string,
      body: unknown,
    ): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = request(
          {
            hostname: '127.0.0.1',
            port,
            path,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            },
          },
          (res) => {
            let responseBody = '';
            res.on('data', (chunk: Buffer) => {
              responseBody += chunk.toString();
            });
            res.on('end', () => {
              resolve({ status: res.statusCode ?? 0, body: responseBody });
            });
          },
        );
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    }

    it('approve returns success when action handler succeeds', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/approve', {
        message: 'Looks good',
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    it('reject returns success', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/reject', {
        message: 'Needs work',
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    it('abort returns success', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/abort', {});
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    it('answer validates non-empty content', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/answer', {
        content: '',
      });
      expect(res.status).toBe(400);
    });

    it('answer returns success with valid content', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/answer', {
        content: 'Use Redis for caching',
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    it('action routes return 404 when no action handler configured', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/approve', {});
      expect(res.status).toBe(404);
    });

    it('action route returns 400 when handler reports failure', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler({
        approve: () => Promise.resolve({ success: false, error: 'Run is not waiting' }),
      });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/approve', {});
      expect(res.status).toBe(400);
      const data = JSON.parse(res.body) as DashboardActionResult;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Run is not waiting');
    });
  });

  describe('browse-directory endpoint', () => {
    it('returns cancelled response in test environment', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/browse-directory');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as { path: string | null; cancelled?: boolean };
      expect(data.path).toBeNull();
      expect(data.cancelled).toBe(true);
    });
  });

  describe('permission-approvals endpoints', () => {
    function httpDelete(port: number, path: string): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port, path, method: 'DELETE' }, (res) => {
          let responseBody = '';
          res.on('data', (chunk: Buffer) => {
            responseBody += chunk.toString();
          });
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body: responseBody });
          });
        });
        req.on('error', reject);
        req.end();
      });
    }

    const mockEntries: PermissionApprovalEntry[] = [
      {
        id: 'entry-1',
        action: 'shell_execute',
        resource: 'npm test',
        detail: 'Run tests',
        createdAt: '2026-07-20T10:00:00Z',
        createdByRole: 'implementer',
      },
      {
        id: 'entry-2',
        action: 'file_write',
        resource: '/src/main.ts',
        createdAt: '2026-07-21T14:00:00Z',
      },
    ];

    function createMockApprovalStore(
      overrides: Partial<PermissionApprovalStore> = {},
    ): PermissionApprovalStore {
      return {
        findMatch: () => undefined,
        record: () => Promise.resolve(),
        list: () => mockEntries,
        remove: () => Promise.resolve(true),
        clear: () => Promise.resolve(),
        reload: () => Promise.resolve(),
        ...overrides,
      };
    }

    it('GET returns 404 when no approval store configured', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/permission-approvals');
      expect(res.status).toBe(404);
    });

    it('GET returns list of approvals', async () => {
      eventStream = new SseEventStream();
      const approvalStore = createMockApprovalStore();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        approvalStore,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/permission-approvals');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as PermissionApprovalEntry[];
      expect(data).toHaveLength(2);
      expect(data[0]?.id).toBe('entry-1');
      expect(data[1]?.id).toBe('entry-2');
    });

    it('DELETE /:id returns 404 when no approval store configured', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpDelete(server.getPort(), '/api/permission-approvals/entry-1');
      expect(res.status).toBe(404);
    });

    it('DELETE /:id removes entry and returns ok', async () => {
      eventStream = new SseEventStream();
      const approvalStore = createMockApprovalStore();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        approvalStore,
      });
      await server.start();

      const res = await httpDelete(server.getPort(), '/api/permission-approvals/entry-1');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
    });

    it('DELETE /:id returns 404 when entry not found', async () => {
      eventStream = new SseEventStream();
      const approvalStore = createMockApprovalStore({ remove: () => Promise.resolve(false) });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        approvalStore,
      });
      await server.start();

      const res = await httpDelete(server.getPort(), '/api/permission-approvals/nonexistent');
      expect(res.status).toBe(404);
    });

    it('DELETE / clears all entries', async () => {
      eventStream = new SseEventStream();
      let cleared = false;
      const approvalStore = createMockApprovalStore({
        clear: () => {
          cleared = true;
          return Promise.resolve();
        },
      });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        approvalStore,
      });
      await server.start();

      const res = await httpDelete(server.getPort(), '/api/permission-approvals');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
      expect(cleared).toBe(true);
    });

    it('DELETE / returns 404 when no approval store configured', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpDelete(server.getPort(), '/api/permission-approvals');
      expect(res.status).toBe(404);
    });
  });

  describe('binary file endpoint', () => {
    it('serves video files from artifacts directory', async () => {
      const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const runsDir = mkdtempSync(join(tmpdir(), 'test-runs-'));
      const runId = '20260725-test';
      const videosDir = join(runsDir, runId, 'artifacts', 'verification', 'videos');
      mkdirSync(videosDir, { recursive: true });
      writeFileSync(join(videosDir, 'login.webm'), Buffer.from('fake-video-content'));

      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0, runsDir },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(
        server.getPort(),
        `/api/runs/${runId}/files/verification/videos/login.webm`,
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('video/webm');
      expect(res.body).toBe('fake-video-content');
    });

    it('returns 404 for non-existent files', async () => {
      const { mkdtempSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const runsDir = mkdtempSync(join(tmpdir(), 'test-runs-'));
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0, runsDir },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(
        server.getPort(),
        '/api/runs/run-fake/files/verification/videos/missing.webm',
      );
      expect(res.status).toBe(404);
    });

    it('rejects path traversal attempts', async () => {
      const { mkdtempSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const runsDir = mkdtempSync(join(tmpdir(), 'test-runs-'));
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0, runsDir },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/runs/run-1/files/../../etc/passwd');
      expect(res.status === 400 || res.status === 404).toBe(true);
    });

    it('returns 404 when runsDir is not configured', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(
        server.getPort(),
        '/api/runs/run-1/files/verification/videos/test.webm',
      );
      expect(res.status).toBe(404);
    });
  });

  describe('run config endpoint', () => {
    it('returns config when available', async () => {
      eventStream = new SseEventStream();
      const mockConfig: RunConfigView = {
        roles: [],
        iterationLimits: { PLANNING: 3 },
        qualityGates: {
          specificationReadiness: { minCompletenessScore: 0.8 },
          implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
        },
        budget: { maxTokensPerRun: 100000 },
      };
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider({ getRunConfig: () => mockConfig }),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/runs/run-1/config');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as RunConfigView;
      expect(data.iterationLimits).toEqual({ PLANNING: 3 });
    });

    it('returns 404 when config is not available', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider({ getRunConfig: () => null }),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/runs/run-1/config');
      expect(res.status).toBe(404);
    });
  });

  describe('artifact detail endpoint', () => {
    it('returns artifact detail when found', async () => {
      eventStream = new SseEventStream();
      const mockDetail: ArtifactDetailView = {
        ref: { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' },
        type: 'plan',
        name: 'main-plan',
        currentVersion: 1,
        producedBy: 'planner',
        createdAt: '2026-01-01T00:00:00Z',
        sizeBytes: 256,
        versions: [],
        dependsOn: [],
        dependedOnBy: [],
      };
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider({ getArtifactDetail: () => ok(mockDetail) }),
        eventStream,
      });
      await server.start();

      const res = await httpGet(
        server.getPort(),
        '/api/runs/run-1/artifacts/plan/main-plan/1/detail',
      );
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as ArtifactDetailView;
      expect(data.name).toBe('main-plan');
      expect(data.currentVersion).toBe(1);
    });

    it('returns 400 for invalid version (non-numeric)', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(
        server.getPort(),
        '/api/runs/run-1/artifacts/plan/main-plan/abc/detail',
      );
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid version' });
    });

    it('returns 404 when artifact not found', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider({
          getArtifactDetail: () => err(new Error('Artifact not found')),
        }),
        eventStream,
      });
      await server.start();

      const res = await httpGet(
        server.getPort(),
        '/api/runs/run-1/artifacts/plan/main-plan/1/detail',
      );
      expect(res.status).toBe(404);
    });
  });

  describe('artifact content endpoint', () => {
    it('returns artifact content when found', async () => {
      eventStream = new SseEventStream();
      const mockContent: ArtifactContentView = {
        content: '# Plan\nSome content',
        contentType: 'markdown',
        sizeBytes: 30,
      };
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider({ getArtifactContent: () => ok(mockContent) }),
        eventStream,
      });
      await server.start();

      const res = await httpGet(
        server.getPort(),
        '/api/runs/run-1/artifacts/plan/main-plan/1/content',
      );
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as ArtifactContentView;
      expect(data.contentType).toBe('markdown');
      expect(data.content).toContain('Plan');
    });

    it('returns 400 for invalid version', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(
        server.getPort(),
        '/api/runs/run-1/artifacts/plan/main-plan/notanum/content',
      );
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid version' });
    });

    it('returns 404 when content not found', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider({
          getArtifactContent: () => err(new Error('Content not found')),
        }),
        eventStream,
      });
      await server.start();

      const res = await httpGet(
        server.getPort(),
        '/api/runs/run-1/artifacts/plan/main-plan/1/content',
      );
      expect(res.status).toBe(404);
    });
  });

  describe('script content endpoint', () => {
    it('returns script content when found', async () => {
      const { mkdtempSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const scriptsDir = mkdtempSync(join(tmpdir(), 'test-scripts-'));
      writeFileSync(join(scriptsDir, 'upload.ts'), 'console.log("hello");');

      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0, scriptsDir },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/scripts/upload.ts/content');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as { content: string; contentType: string };
      expect(data.content).toBe('console.log("hello");');
      expect(data.contentType).toBe('code');
    });

    it('returns 404 when scriptsDir is not configured', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/scripts/upload.ts/content');
      expect(res.status).toBe(404);
    });

    it('returns 400 for path traversal attempts', async () => {
      const { mkdtempSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const scriptsDir = mkdtempSync(join(tmpdir(), 'test-scripts-'));

      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0, scriptsDir },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/scripts/..%2Fetc%2Fpasswd/content');
      expect(res.status).toBe(400);
    });

    it('returns 404 when script does not exist', async () => {
      const { mkdtempSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const scriptsDir = mkdtempSync(join(tmpdir(), 'test-scripts-'));

      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0, scriptsDir },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/scripts/nonexistent.ts/content');
      expect(res.status).toBe(404);
    });
  });

  describe('sessions endpoint', () => {
    it('returns empty array when provider does not support sessions', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/runs/run-1/sessions');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 500 when sessions provider returns error', async () => {
      eventStream = new SseEventStream();
      const sessionProvider = {
        ...createMockProvider(),
        getSessionsView: () => err(new Error('session load failure')),
      };
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: sessionProvider,
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/runs/run-1/sessions');
      expect(res.status).toBe(500);
      expect((JSON.parse(res.body) as { error: string }).error).toBe('session load failure');
    });
  });

  describe('live-requests endpoint', () => {
    function createMockLiveRequestStore(
      overrides: Partial<LiveRequestStore> = {},
    ): LiveRequestStore {
      return {
        writeRequest: () => Promise.resolve(),
        writeResponse: () => Promise.resolve(),
        awaitResponse: () => Promise.resolve(null),
        listPendingRequests: () => Promise.resolve([]),
        cleanupResolved: () => Promise.resolve(0),
        ...overrides,
      };
    }

    it('returns 404 when no live request store configured', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/runs/run-1/live-requests');
      expect(res.status).toBe(404);
    });

    it('returns pending requests when store is configured', async () => {
      eventStream = new SseEventStream();
      const pendingRequests = [
        {
          runId: 'run-1',
          messageId: 'msg-1',
          kind: 'permission' as const,
          createdAt: '2026-01-01T00:00:00Z',
          payload: { tool: 'shell_execute', command: 'npm test' },
        },
      ];
      const store = createMockLiveRequestStore({
        listPendingRequests: () => Promise.resolve(pendingRequests),
      });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        liveRequestStore: store,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/runs/run-1/live-requests');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as { messageId: string }[];
      expect(data).toHaveLength(1);
      expect(data[0]?.messageId).toBe('msg-1');
    });
  });

  describe('permissions endpoint', () => {
    function createMockLiveRequestStore(
      overrides: Partial<LiveRequestStore> = {},
    ): LiveRequestStore {
      return {
        writeRequest: () => Promise.resolve(),
        writeResponse: () => Promise.resolve(),
        awaitResponse: () => Promise.resolve(null),
        listPendingRequests: () => Promise.resolve([]),
        cleanupResolved: () => Promise.resolve(0),
        ...overrides,
      };
    }

    it('returns 404 when no live request store configured', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/permissions/msg-1', {
        granted: true,
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when body.granted is not boolean', async () => {
      eventStream = new SseEventStream();
      const store = createMockLiveRequestStore();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        liveRequestStore: store,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/permissions/msg-1', {
        granted: 'yes',
      });
      expect(res.status).toBe(400);
      expect((JSON.parse(res.body) as { error: string }).error).toContain('granted');
    });

    it('returns success when valid request', async () => {
      eventStream = new SseEventStream();
      let writtenResponse: { runId: string; messageId: string } | null = null;
      const store = createMockLiveRequestStore({
        writeResponse: (resp) => {
          writtenResponse = { runId: resp.runId, messageId: resp.messageId };
          return Promise.resolve();
        },
      });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        liveRequestStore: store,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/permissions/msg-1', {
        granted: true,
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
      expect(writtenResponse).toEqual({ runId: 'run-1', messageId: 'msg-1' });
    });
  });

  describe('clarifications endpoint', () => {
    function createMockLiveRequestStore(
      overrides: Partial<LiveRequestStore> = {},
    ): LiveRequestStore {
      return {
        writeRequest: () => Promise.resolve(),
        writeResponse: () => Promise.resolve(),
        awaitResponse: () => Promise.resolve(null),
        listPendingRequests: () => Promise.resolve([]),
        cleanupResolved: () => Promise.resolve(0),
        ...overrides,
      };
    }

    it('returns 404 when no live request store configured', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/clarifications/msg-1', {
        answer: 'Use Redis',
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when answer is empty', async () => {
      eventStream = new SseEventStream();
      const store = createMockLiveRequestStore();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        liveRequestStore: store,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/clarifications/msg-1', {
        answer: '',
      });
      expect(res.status).toBe(400);
      expect((JSON.parse(res.body) as { error: string }).error).toContain('answer');
    });

    it('returns 400 when answer is missing', async () => {
      eventStream = new SseEventStream();
      const store = createMockLiveRequestStore();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        liveRequestStore: store,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/clarifications/msg-1', {});
      expect(res.status).toBe(400);
    });

    it('returns success when valid request', async () => {
      eventStream = new SseEventStream();
      let writtenResponse: { runId: string; messageId: string } | null = null;
      const store = createMockLiveRequestStore({
        writeResponse: (resp) => {
          writtenResponse = { runId: resp.runId, messageId: resp.messageId };
          return Promise.resolve();
        },
      });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        liveRequestStore: store,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/clarifications/msg-1', {
        answer: 'Use Redis for caching',
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
      expect(writtenResponse).toEqual({ runId: 'run-1', messageId: 'msg-1' });
    });
  });

  describe('retry endpoint', () => {
    it('returns success with action handler', async () => {
      eventStream = new SseEventStream();
      const actionHandler: DashboardActionHandler = {
        approve: () => Promise.resolve({ success: true }),
        reject: () => Promise.resolve({ success: true }),
        abort: () => Promise.resolve({ success: true }),
        answer: () => Promise.resolve({ success: true }),
        deleteRun: () => Promise.resolve({ success: true }),
        createRun: () => Promise.resolve({ success: true }),
        listWorkflows: () => [],
        getWorkflowPreview: () => null,
        retry: () => Promise.resolve({ success: true }),
      };
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/retry', {});
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    it('returns 404 when no action handler', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs/run-1/retry', {});
      expect(res.status).toBe(404);
    });
  });

  describe('delete run endpoint', () => {
    it('returns success with action handler', async () => {
      eventStream = new SseEventStream();
      let deletedRunId: string | null = null;
      const actionHandler: DashboardActionHandler = {
        approve: () => Promise.resolve({ success: true }),
        reject: () => Promise.resolve({ success: true }),
        abort: () => Promise.resolve({ success: true }),
        answer: () => Promise.resolve({ success: true }),
        deleteRun: (runId) => {
          deletedRunId = runId;
          return Promise.resolve({ success: true });
        },
        createRun: () => Promise.resolve({ success: true }),
        listWorkflows: () => [],
        getWorkflowPreview: () => null,
        retry: () => Promise.resolve({ success: true }),
      };
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler,
      });
      await server.start();

      const res = await httpDelete(server.getPort(), '/api/runs/run-1');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true });
      expect(deletedRunId).toBe('run-1');
    });

    it('returns 404 when no action handler', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpDelete(server.getPort(), '/api/runs/run-1');
      expect(res.status).toBe(404);
    });
  });

  describe('settings endpoints', () => {
    function createMockSettingsProvider(
      overrides: Partial<SettingsProvider> = {},
    ): SettingsProvider {
      return {
        getProjectSettings: () => null,
        updateProjectSettings: () => ({ ok: true }),
        ...overrides,
      };
    }

    it('GET returns 404 when no settings provider', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/settings');
      expect(res.status).toBe(404);
    });

    it('GET returns 404 when no project settings found', async () => {
      eventStream = new SseEventStream();
      const settingsProvider = createMockSettingsProvider({
        getProjectSettings: () => null,
      });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        settingsProvider,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/settings');
      expect(res.status).toBe(404);
    });

    it('GET returns settings when available', async () => {
      eventStream = new SseEventStream();
      const mockSettings = {
        roles: { assignments: {} },
        governance: {
          iterationLimits: { defaults: {} },
          qualityGates: {
            specificationReadiness: { minCompletenessScore: 0.8 },
            implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
          },
        },
        runtime: { logLevel: 'info' },
        availableRunners: ['claude-code'],
        modelsByRunner: {},
      };
      const settingsProvider = createMockSettingsProvider({
        getProjectSettings: () => mockSettings,
      });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        settingsProvider,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/settings');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as Record<string, unknown>;
      expect(data).toHaveProperty('runtime');
    });

    it('PUT returns 404 when no settings provider', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpPut(server.getPort(), '/api/settings', {
        runtime: { logLevel: 'debug' },
      });
      expect(res.status).toBe(404);
    });

    it('PUT returns 400 for invalid JSON', async () => {
      eventStream = new SseEventStream();
      const settingsProvider = createMockSettingsProvider();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        settingsProvider,
      });
      await server.start();

      // Send raw invalid JSON
      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const invalidData = '{invalid json}}}';
        const req = request(
          {
            hostname: '127.0.0.1',
            port: server.getPort(),
            path: '/api/settings',
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(invalidData),
            },
          },
          (httpRes) => {
            let responseBody = '';
            httpRes.on('data', (chunk: Buffer) => {
              responseBody += chunk.toString();
            });
            httpRes.on('end', () => {
              resolve({ status: httpRes.statusCode ?? 0, body: responseBody });
            });
          },
        );
        req.on('error', reject);
        req.write(invalidData);
        req.end();
      });
      expect(res.status).toBe(400);
    });

    it('PUT returns success', async () => {
      eventStream = new SseEventStream();
      const settingsProvider = createMockSettingsProvider({
        updateProjectSettings: () => ({ ok: true }),
      });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        settingsProvider,
      });
      await server.start();

      const res = await httpPut(server.getPort(), '/api/settings', {
        runtime: { logLevel: 'debug' },
      });
      expect(res.status).toBe(200);
      expect((JSON.parse(res.body) as { ok: boolean }).ok).toBe(true);
    });
  });

  describe('workflows endpoints', () => {
    function createMockActionHandler(
      overrides: Partial<DashboardActionHandler> = {},
    ): DashboardActionHandler {
      return {
        approve: () => Promise.resolve({ success: true }),
        reject: () => Promise.resolve({ success: true }),
        abort: () => Promise.resolve({ success: true }),
        answer: () => Promise.resolve({ success: true }),
        deleteRun: () => Promise.resolve({ success: true }),
        createRun: () => Promise.resolve({ success: true }),
        listWorkflows: () => [],
        getWorkflowPreview: () => null,
        retry: () => Promise.resolve({ success: true }),
        ...overrides,
      };
    }

    it('GET /api/workflows returns 404 when no action handler', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/workflows');
      expect(res.status).toBe(404);
    });

    it('GET /api/workflows returns workflows list', async () => {
      eventStream = new SseEventStream();
      const workflows: WorkflowSummary[] = [
        { name: 'default', version: '1.0', stateCount: 5 },
        { name: 'review-only', version: '1.0', stateCount: 3 },
      ];
      const handler = createMockActionHandler({ listWorkflows: () => workflows });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/workflows');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as WorkflowSummary[];
      expect(data).toHaveLength(2);
      expect(data[0]?.name).toBe('default');
    });

    it('GET /api/workflows/:name/preview returns 404 when no action handler', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/workflows/default/preview');
      expect(res.status).toBe(404);
    });

    it('GET /api/workflows/:name/preview returns preview when found', async () => {
      eventStream = new SseEventStream();
      const mockPreview: WorkflowStateView = {
        runId: 'preview',
        states: [
          {
            id: 'INTAKE',
            type: 'action',
            label: 'Intake',
            visited: false,
            current: true,
            timeSpentMs: 0,
            visitCount: 0,
          },
        ],
        transitions: [],
        currentState: 'INTAKE',
        visitedStates: [],
        stateHistory: [],
      };
      const handler = createMockActionHandler({
        getWorkflowPreview: (name) => (name === 'default' ? mockPreview : null),
      });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/workflows/default/preview');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as WorkflowStateView;
      expect(data.currentState).toBe('INTAKE');
    });

    it('GET /api/workflows/:name/preview returns 404 when not found', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler({ getWorkflowPreview: () => null });
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/workflows/nonexistent/preview');
      expect(res.status).toBe(404);
    });
  });

  describe('create run endpoint', () => {
    function createMockActionHandler(
      overrides: Partial<DashboardActionHandler> = {},
    ): DashboardActionHandler {
      return {
        approve: () => Promise.resolve({ success: true }),
        reject: () => Promise.resolve({ success: true }),
        abort: () => Promise.resolve({ success: true }),
        answer: () => Promise.resolve({ success: true }),
        deleteRun: () => Promise.resolve({ success: true }),
        createRun: () => Promise.resolve({ success: true, runId: 'new-run-1' }),
        listWorkflows: () => [],
        getWorkflowPreview: () => null,
        retry: () => Promise.resolve({ success: true }),
        ...overrides,
      };
    }

    it('returns 404 when no action handler', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs', { prompt: 'Build a feature' });
      expect(res.status).toBe(404);
    });

    it('returns 400 when prompt is empty', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs', { prompt: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when prompt is missing', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs', {});
      expect(res.status).toBe(400);
    });

    it('returns success when valid', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();

      const res = await httpPost(server.getPort(), '/api/runs', {
        prompt: 'Implement login',
        workflow: 'default',
      });
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as { success: boolean; runId?: string };
      expect(data.success).toBe(true);
      expect(data.runId).toBe('new-run-1');
    });
  });

  describe('server-info endpoint', () => {
    it('returns cwd', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/server-info');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as { cwd: string };
      expect(data.cwd).toBe(process.cwd());
    });
  });

  describe('SSE with runId filter', () => {
    it('only receives events for the filtered runId', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();

      const { data: dataPromise, connected } = connectSSE(server.getPort(), '/events?runId=run-1');
      await connected;
      await waitForClients(() => eventStream.getClientCount(), 1);

      // Publish event for a different run -- should be filtered out
      eventStream.publish({
        type: 'state_changed',
        timestamp: '2026-01-01T00:00:00Z',
        runId: 'run-other',
        data: { from: 'INTAKE', to: 'PLANNING' },
      });
      // Publish event for the matching run -- should arrive
      eventStream.publish({
        type: 'artifact_produced',
        timestamp: '2026-01-01T00:00:01Z',
        runId: 'run-1',
        data: { artifact: 'spec' },
      });

      const receivedData = await dataPromise;
      expect(receivedData).toContain('artifact_produced');
      expect(receivedData).not.toContain('run-other');
    });
  });

  describe('bridgeAgentStreamEvents', () => {
    it('publishes permission_requested dashboard event for permission_request agent event', async () => {
      const subscribers = new Map<string, (event: AgentStreamEvent) => void>();
      let nextId = 1;
      const agentBus: AgentStreamBus = {
        subscribe: (cb) => {
          const id = `c-${String(nextId++)}`;
          subscribers.set(id, cb);
          return id;
        },
        unsubscribe: (id) => subscribers.delete(id),
        publish: (event) => {
          for (const [, cb] of subscribers) {
            cb(event);
          }
        },
        getClientCount: () => subscribers.size,
      };

      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        agentStreamBus: agentBus,
      });
      await server.start();

      const { data: dataPromise, connected } = connectSSE(server.getPort(), '/events');
      await connected;
      await waitForClients(() => eventStream.getClientCount(), 1);

      agentBus.publish({
        runId: 'run-1',
        stateId: 'PLANNING',
        roleId: 'planner',
        dispatchId: 'dispatch-1',
        timestamp: '2026-01-01T00:00:00Z',
        type: 'permission_request',
        content: 'Permission needed',
        requestMessageId: 'perm-msg-1',
        structuredData: { tool: 'shell_execute' },
      });

      const receivedData = await dataPromise;
      expect(receivedData).toContain('permission_requested');
      expect(receivedData).toContain('perm-msg-1');
    });

    it('publishes clarification_requested dashboard event for clarification_request agent event', async () => {
      const subscribers = new Map<string, (event: AgentStreamEvent) => void>();
      let nextId = 1;
      const agentBus: AgentStreamBus = {
        subscribe: (cb) => {
          const id = `c-${String(nextId++)}`;
          subscribers.set(id, cb);
          return id;
        },
        unsubscribe: (id) => subscribers.delete(id),
        publish: (event) => {
          for (const [, cb] of subscribers) {
            cb(event);
          }
        },
        getClientCount: () => subscribers.size,
      };

      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider(),
        eventStream,
        agentStreamBus: agentBus,
      });
      await server.start();

      const { data: dataPromise, connected } = connectSSE(server.getPort(), '/events');
      await connected;
      await waitForClients(() => eventStream.getClientCount(), 1);

      agentBus.publish({
        runId: 'run-1',
        stateId: 'PLANNING',
        roleId: 'planner',
        dispatchId: 'dispatch-1',
        timestamp: '2026-01-01T00:00:00Z',
        type: 'clarification_request',
        content: 'Need clarification',
        requestMessageId: 'clar-msg-1',
        structuredData: { question: 'Which database?' },
      });

      const receivedData = await dataPromise;
      expect(receivedData).toContain('clarification_requested');
      expect(receivedData).toContain('clar-msg-1');
    });
  });

  describe('health endpoint with run stats', () => {
    it('returns runStats computed from getRunHistory', async () => {
      eventStream = new SseEventStream();
      const runs: RunSummaryView[] = [
        {
          runId: 'run-1',
          repository: 'test',
          workflow: 'default',
          status: 'running',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '',
          durationMs: 0,
          totalArtifacts: 0,
          totalTokens: 150,
          totalInputTokens: 100,
          totalOutputTokens: 50,
          finalState: 'PLANNING',
        },
        {
          runId: 'run-2',
          repository: 'test',
          workflow: 'default',
          status: 'completed',
          startedAt: '2026-01-02T00:00:00Z',
          completedAt: '2026-01-02T01:00:00Z',
          durationMs: 3600000,
          totalArtifacts: 5,
          totalTokens: 500,
          totalInputTokens: 300,
          totalOutputTokens: 200,
          finalState: 'DONE',
        },
        {
          runId: 'run-3',
          repository: 'test',
          workflow: 'default',
          status: 'failed',
          startedAt: '2026-01-03T00:00:00Z',
          completedAt: '',
          durationMs: 1800000,
          totalArtifacts: 2,
          totalTokens: 250,
          totalInputTokens: 150,
          totalOutputTokens: 100,
          finalState: 'ABORTED',
        },
      ];

      server = new DashboardHttpServer({
        config: { port: 0 },
        dataProvider: createMockProvider({ getRunHistory: () => ok(runs) }),
        eventStream,
      });
      await server.start();

      const res = await httpGet(server.getPort(), '/api/health');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as {
        runStats: {
          total: number;
          active: number;
          completed: number;
          failed: number;
          avgDurationMs: number | null;
          latestRun: string | null;
          totalInputTokens: number;
          totalOutputTokens: number;
        };
      };
      expect(data.runStats.total).toBe(3);
      expect(data.runStats.active).toBe(1);
      expect(data.runStats.completed).toBe(1);
      expect(data.runStats.failed).toBe(1);
      expect(data.runStats.avgDurationMs).toBe(2700000); // (3600000 + 1800000) / 2
      expect(data.runStats.latestRun).toBe('2026-01-03T00:00:00Z');
      expect(data.runStats.totalInputTokens).toBe(550);
      expect(data.runStats.totalOutputTokens).toBe(350);
    });
  });
});
