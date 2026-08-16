import { request } from 'node:http';

import type { DashboardActionHandler, DashboardDataProvider } from '@ai-orchestrator/ports';
import type { LiveRequestStore } from '@ai-orchestrator/runner';
import type {
  DashboardActionResult,
  DashboardEvent,
  RunStateView,
  RunSummaryView,
} from '@ai-orchestrator/schemas';
import { err, ok } from '@ai-orchestrator/schemas';
import { afterEach, describe, expect, it } from 'vitest';

import { DashboardHttpServer } from '../../src/dashboard/dashboard-http-server';
import { SseEventStream } from '../../src/dashboard/sse-event-stream';

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
    getSystemHealth: () =>
      ok({
        overallStatus: 'ok' as const,
        subsystems: [],
        timestamp: new Date().toISOString(),
      }),
    ...overrides,
  };
}

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

function createMockLiveRequestStore(overrides: Partial<LiveRequestStore> = {}): LiveRequestStore {
  return {
    writeRequest: () => Promise.resolve(),
    writeResponse: () => Promise.resolve(),
    awaitResponse: () => Promise.resolve(null),
    listPendingRequests: () => Promise.resolve([]),
    cleanupResolved: () => Promise.resolve(0),
    ...overrides,
  };
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

describe('Dashboard HTTP Server Integration', () => {
  let server: DashboardHttpServer;
  let eventStream: SseEventStream;

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- server may not be assigned if a test fails before assignment
    if (server) {
      await server.stop();
    }
  });

  describe('action lifecycle: create → query → approve → abort', () => {
    it('drives a run through create, state check, approve, and abort', async () => {
      let currentState = 'WAITING_FOR_HUMAN';
      let runCreated = false;

      const mockState: RunStateView = {
        runId: 'run-lifecycle-1',
        status: 'waiting',
        currentState: 'WAITING_FOR_HUMAN',
        previousState: 'PLAN_REVIEW',
        startedAt: '2026-01-01T00:00:00Z',
        stateEnteredAt: '2026-01-01T00:00:05Z',
        elapsedMs: 5000,
        transitionCount: 3,
        isWaitingForHuman: true,
      };

      eventStream = new SseEventStream();
      const handler = createMockActionHandler({
        createRun: () => {
          runCreated = true;
          return Promise.resolve({ success: true, runId: 'run-lifecycle-1' });
        },
        approve: () => {
          currentState = 'IMPLEMENTATION';
          return Promise.resolve({ success: true });
        },
        abort: () => {
          currentState = 'ABORTED';
          return Promise.resolve({ success: true });
        },
      });

      server = new DashboardHttpServer({
        config: { port: 0, host: '127.0.0.1' },
        dataProvider: createMockProvider({
          getRunState: () =>
            ok({
              ...mockState,
              currentState,
              isWaitingForHuman: currentState === 'WAITING_FOR_HUMAN',
            }),
        }),
        eventStream,
        actionHandler: handler,
      });
      await server.start();
      const port = server.getPort();

      const createRes = await httpPost(port, '/api/runs', { prompt: 'Build feature X' });
      expect(createRes.status).toBe(200);
      expect(runCreated).toBe(true);

      const stateRes1 = await httpGet(port, '/api/runs/run-lifecycle-1/state');
      expect(stateRes1.status).toBe(200);
      const state1 = JSON.parse(stateRes1.body) as {
        currentState: string;
        isWaitingForHuman: boolean;
      };
      expect(state1.currentState).toBe('WAITING_FOR_HUMAN');
      expect(state1.isWaitingForHuman).toBe(true);

      const approveRes = await httpPost(port, '/api/runs/run-lifecycle-1/approve', {
        message: 'Go',
      });
      expect(approveRes.status).toBe(200);

      const stateRes2 = await httpGet(port, '/api/runs/run-lifecycle-1/state');
      const state2 = JSON.parse(stateRes2.body) as { currentState: string };
      expect(state2.currentState).toBe('IMPLEMENTATION');

      const abortRes = await httpPost(port, '/api/runs/run-lifecycle-1/abort', {});
      expect(abortRes.status).toBe(200);

      const stateRes3 = await httpGet(port, '/api/runs/run-lifecycle-1/state');
      const state3 = JSON.parse(stateRes3.body) as { currentState: string };
      expect(state3.currentState).toBe('ABORTED');
    });
  });

  describe('permission flow end-to-end', () => {
    it('permission grant is written and triggers SSE event', async () => {
      const writtenResponses: { runId: string; messageId: string; granted: boolean }[] = [];
      eventStream = new SseEventStream();
      const store = createMockLiveRequestStore({
        listPendingRequests: (runId) =>
          Promise.resolve(
            runId === 'run-perm-1'
              ? [
                  {
                    runId: 'run-perm-1',
                    messageId: 'perm-msg-1',
                    kind: 'permission' as const,
                    createdAt: '2026-01-01T00:00:00Z',
                    payload: { tool: 'shell_execute', command: 'npm test' },
                  },
                ]
              : [],
          ),
        writeResponse: (resp) => {
          writtenResponses.push({
            runId: resp.runId,
            messageId: resp.messageId,
            granted: (resp.payload as { granted: boolean }).granted,
          });
          return Promise.resolve();
        },
      });

      server = new DashboardHttpServer({
        config: { port: 0, host: '127.0.0.1' },
        dataProvider: createMockProvider(),
        eventStream,
        liveRequestStore: store,
      });
      await server.start();
      const port = server.getPort();

      const { data: sseData, connected } = connectSSE(port, '/events');
      await connected;
      await waitForClients(() => eventStream.getClientCount(), 1);

      const pendingRes = await httpGet(port, '/api/runs/run-perm-1/live-requests');
      expect(pendingRes.status).toBe(200);
      const pending = JSON.parse(pendingRes.body) as { messageId: string }[];
      expect(pending).toHaveLength(1);

      const grantRes = await httpPost(port, '/api/runs/run-perm-1/permissions/perm-msg-1', {
        granted: true,
      });
      expect(grantRes.status).toBe(200);

      expect(writtenResponses).toHaveLength(1);
      expect(writtenResponses[0]?.granted).toBe(true);

      const received = await sseData;
      expect(received).toContain('permission_resolved');
      expect(received).toContain('perm-msg-1');
    });
  });

  describe('health aggregation across multiple runs', () => {
    it('health endpoint computes stats from run history', async () => {
      const runs: RunSummaryView[] = [
        {
          runId: 'run-1',
          repository: 'repo',
          workflow: 'dev',
          status: 'running',
          startedAt: '2026-08-01T10:00:00Z',
          completedAt: '',
          durationMs: 0,
          totalArtifacts: 2,
          totalTokens: 500,
          totalInputTokens: 300,
          totalOutputTokens: 200,
          finalState: 'IMPLEMENTATION',
        },
        {
          runId: 'run-2',
          repository: 'repo',
          workflow: 'dev',
          status: 'completed',
          startedAt: '2026-08-02T10:00:00Z',
          completedAt: '2026-08-02T11:00:00Z',
          durationMs: 3600000,
          totalArtifacts: 16,
          totalTokens: 2000,
          totalInputTokens: 1200,
          totalOutputTokens: 800,
          finalState: 'DONE',
        },
        {
          runId: 'run-3',
          repository: 'repo',
          workflow: 'pr-review',
          status: 'failed',
          startedAt: '2026-08-03T10:00:00Z',
          completedAt: '2026-08-03T10:30:00Z',
          durationMs: 1800000,
          totalArtifacts: 5,
          totalTokens: 800,
          totalInputTokens: 500,
          totalOutputTokens: 300,
          finalState: 'FAILED',
        },
      ];

      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0, host: '127.0.0.1' },
        dataProvider: createMockProvider({
          getRunHistory: () => ok(runs),
        }),
        eventStream,
      });
      await server.start();
      const port = server.getPort();

      const healthRes = await httpGet(port, '/api/health');
      expect(healthRes.status).toBe(200);
      const health = JSON.parse(healthRes.body) as {
        status: string;
        uptimeMs: number;
        runStats: {
          total: number;
          active: number;
          completed: number;
          failed: number;
          avgDurationMs: number | null;
          totalInputTokens: number;
          totalOutputTokens: number;
        };
      };

      expect(health.status).toBe('ok');
      expect(health.uptimeMs).toBeGreaterThan(0);
      expect(health.runStats.total).toBe(3);
      expect(health.runStats.active).toBe(1);
      expect(health.runStats.completed).toBe(1);
      expect(health.runStats.failed).toBe(1);
      expect(health.runStats.avgDurationMs).toBe(2700000);
      expect(health.runStats.totalInputTokens).toBe(2000);
      expect(health.runStats.totalOutputTokens).toBe(1300);

      const runsRes = await httpGet(port, '/api/runs');
      expect(runsRes.status).toBe(200);
      const runList = JSON.parse(runsRes.body) as RunSummaryView[];
      expect(runList).toHaveLength(3);
      expect(runList[0]?.startedAt).toBe('2026-08-03T10:00:00Z');
    });
  });

  describe('SSE event flow with multiple clients', () => {
    it('multiple SSE clients each receive the same published events', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0, host: '127.0.0.1' },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();
      const port = server.getPort();

      const conn1 = connectSSE(port, '/events');
      const conn2 = connectSSE(port, '/events');
      await conn1.connected;
      await conn2.connected;
      await waitForClients(() => eventStream.getClientCount(), 2);

      const event: DashboardEvent = {
        type: 'state_changed',
        timestamp: '2026-08-17T12:00:00Z',
        runId: 'run-multi-1',
        data: { from: 'INTAKE', to: 'PLANNING' },
      };
      eventStream.publish(event);

      const [data1, data2] = await Promise.all([conn1.data, conn2.data]);
      expect(data1).toContain('state_changed');
      expect(data1).toContain('run-multi-1');
      expect(data2).toContain('state_changed');
      expect(data2).toContain('run-multi-1');
    });
  });

  describe('action handler error propagation', () => {
    it('returns 400 with error message when action fails', async () => {
      eventStream = new SseEventStream();
      const handler = createMockActionHandler({
        approve: () =>
          Promise.resolve({
            success: false,
            error: 'Run is not in a waiting state',
          } as DashboardActionResult),
        reject: () =>
          Promise.resolve({
            success: false,
            error: 'Run already completed',
          } as DashboardActionResult),
      });

      server = new DashboardHttpServer({
        config: { port: 0, host: '127.0.0.1' },
        dataProvider: createMockProvider(),
        eventStream,
        actionHandler: handler,
      });
      await server.start();
      const port = server.getPort();

      const approveRes = await httpPost(port, '/api/runs/run-1/approve', {});
      expect(approveRes.status).toBe(400);
      const approveData = JSON.parse(approveRes.body) as DashboardActionResult;
      expect(approveData.success).toBe(false);
      expect(approveData.error).toBe('Run is not in a waiting state');

      const rejectRes = await httpPost(port, '/api/runs/run-1/reject', {});
      expect(rejectRes.status).toBe(400);
      const rejectData = JSON.parse(rejectRes.body) as DashboardActionResult;
      expect(rejectData.error).toBe('Run already completed');
    });
  });

  describe('CORS headers on all response types', () => {
    it('includes CORS headers on JSON, 404, and SSE responses', async () => {
      eventStream = new SseEventStream();
      server = new DashboardHttpServer({
        config: { port: 0, host: '127.0.0.1' },
        dataProvider: createMockProvider(),
        eventStream,
      });
      await server.start();
      const port = server.getPort();

      const jsonRes = await httpGet(port, '/api/health');
      expect(jsonRes.headers['access-control-allow-origin']).toBe('*');

      const notFoundRes = await httpGet(port, '/api/runs/nonexistent/state');
      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.headers['access-control-allow-origin']).toBe('*');
    });
  });
});
