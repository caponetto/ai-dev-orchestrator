import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DashboardHttpServer, SseEventStream } from '@ai-dev-orchestrator/dashboard-server';
import type { DashboardDataProvider } from '@ai-dev-orchestrator/ports';
import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { permitCommand } from '../commands/permit';
import { ExitCode } from '../output/exit-codes';
import { OutputFormatter } from '../output/formatter';
import { getRunDir, getRunsDir } from '../workspace-paths';

vi.mock('../workspace-paths', async (original) => ({
  ...(await original<object>()),
  getRunDir: vi.fn(),
  getRunsDir: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CLI and production HTTP live responses', () => {
  it('shares immutable decisions while isolating parallel, expired and wrong-kind requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'human-delivery-'));
    vi.mocked(getRunsDir).mockReturnValue(dir);
    vi.mocked(getRunDir).mockImplementation((runId) => join(dir, runId));
    const store = new FileBackedLiveRequestStore(dir);
    const provider: DashboardDataProvider = {
      getRunState: vi.fn(),
      getWorkflowView: vi.fn(),
      getArtifactView: vi.fn(),
      getArtifactDetail: vi.fn(),
      getIterationView: vi.fn(),
      getFindingsView: vi.fn(),
      getUsageView: vi.fn(),
      getRunHistory: vi.fn(),
      getRunConfig: vi.fn(),
      getArtifactContent: vi.fn(),
      getSystemHealth: vi.fn(),
    };
    const server = new DashboardHttpServer({
      config: { host: '127.0.0.1', port: 0 },
      dataProvider: provider,
      eventStream: new SseEventStream(),
      liveRequestStore: store,
    });
    try {
      for (const messageId of ['cli', 'http', 'next']) {
        await store.writeRequest({
          runId: 'run',
          messageId,
          kind: 'permission',
          createdAt: '',
          payload: { action: 'write', resource: `/${messageId}` },
        });
      }
      await store.writeRequest({
        runId: 'run',
        messageId: 'clarify',
        kind: 'clarification',
        createdAt: '',
        payload: { question: 'Which branch?' },
      });
      await store.writeRequest({
        runId: 'run',
        messageId: 'expired',
        kind: 'permission',
        createdAt: '',
        expiresAt: '2020-01-01T00:00:00Z',
        payload: { action: 'write', resource: '/old' },
      });
      const formatter = new OutputFormatter({ noColor: true });
      vi.spyOn(formatter, 'info').mockImplementation(() => undefined);
      vi.spyOn(formatter, 'success').mockImplementation(() => undefined);
      await server.start();
      const post = (id: string, payload: object, route = 'permissions') =>
        fetch(`http://127.0.0.1:${String(server.getPort())}/api/runs/run/${route}/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      const [cli, http] = await Promise.all([
        permitCommand(
          { runId: 'run', deny: false, messageId: 'cli', json: false, verbose: false },
          formatter,
        ),
        post('http', { granted: false }),
      ]);
      expect(cli).toBe(ExitCode.SUCCESS);
      expect(http.status).toBe(200);
      expect((await post('cli', { granted: true })).status).toBe(200);
      expect((await post('cli', { granted: false })).status).toBeGreaterThanOrEqual(400);
      expect((await post('expired', { granted: true })).status).toBeGreaterThanOrEqual(400);
      expect((await post('clarify', { granted: true })).status).toBeGreaterThanOrEqual(400);
      expect((await store.awaitResponse('run', 'cli', 1))?.payload).toEqual({ granted: true });
      expect((await store.awaitResponse('run', 'http', 1))?.payload).toEqual({ granted: false });
      expect((await store.listPendingRequests('run')).map((request) => request.messageId)).toEqual([
        'clarify',
        'next',
      ]);
      expect((await post('clarify', { answer: 'main' }, 'clarifications')).status).toBe(200);
      expect((await store.awaitResponse('run', 'clarify', 1))?.payload).toEqual({ answer: 'main' });
      expect((await store.listPendingRequests('run')).map((request) => request.messageId)).toEqual([
        'next',
      ]);
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
