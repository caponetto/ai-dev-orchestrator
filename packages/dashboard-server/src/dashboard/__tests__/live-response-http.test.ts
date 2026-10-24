import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DashboardDataProvider } from '@ai-dev-orchestrator/ports';
import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardHttpServer } from '../dashboard-http-server';
import { SseEventStream } from '../sse-event-stream';

let root: string;
let server: DashboardHttpServer;
let store: FileBackedLiveRequestStore;
let stream: SseEventStream;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'live-response-http-'));
  store = new FileBackedLiveRequestStore(root);
  stream = new SseEventStream();
  server = new DashboardHttpServer({
    config: { port: 0 },
    dataProvider: {} as DashboardDataProvider,
    eventStream: stream,
    liveRequestStore: store,
  });
  await server.start();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server.stop();
  await rm(root, { recursive: true, force: true });
});
function post(route: string, body: string) {
  return fetch(`http://127.0.0.1:${String(server.getPort())}/api/runs/run/${route}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
async function seed(kind: 'permission' | 'clarification', expiresAt?: string) {
  await store.writeRequest({
    runId: 'run',
    messageId: 'request',
    kind,
    createdAt: '',
    expiresAt,
    payload: {},
  });
}
describe('live response HTTP acknowledgements', () => {
  it.each(['permissions', 'clarifications'])(
    'reports %s storage failure without publishing resolution',
    async (route) => {
      const publish = vi.spyOn(stream, 'publish');
      vi.spyOn(store, 'writeResponse').mockRejectedValueOnce(new Error('storage unavailable'));
      const response = await post(
        route,
        JSON.stringify(route === 'permissions' ? { granted: true } : { answer: 'answer' }),
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Unable to store live response' });
      expect(publish).not.toHaveBeenCalled();
    },
  );
  it('does not treat an inherited object property as an HTTP status mapping', async () => {
    vi.spyOn(store, 'writeResponse').mockRejectedValueOnce(
      Object.assign(new Error('bad adapter code'), { code: 'constructor' }),
    );
    expect((await post('permissions', '{"granted":true}')).status).toBe(500);
  });
  it.each(['permissions', 'clarifications'])(
    'requires a cataloged request for %s',
    async (route) => {
      const response = await post(
        route,
        JSON.stringify(route === 'permissions' ? { granted: true } : { answer: 'answer' }),
      );
      expect(response.status).toBe(404);
      expect(await store.awaitResponse('run', 'request', 0)).toBeNull();
    },
  );
  it.each(['permissions', 'clarifications'])(
    'keeps committed %s acknowledgements stable through duplicate retries and cleanup',
    async (route) => {
      await seed(route === 'permissions' ? 'permission' : 'clarification');
      const publish = vi.spyOn(stream, 'publish');
      const body = JSON.stringify(
        route === 'permissions' ? { granted: true } : { answer: 'answer' },
      );
      const first = await post(route, body);
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ ok: true, outcome: 'response_written' });
      await store.cleanupResolved('run');
      const duplicate = await post(route, body);
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toEqual({ ok: true, outcome: 'already_responded' });
      expect(publish).toHaveBeenCalledOnce();
      expect(
        (
          await post(
            route,
            JSON.stringify(route === 'permissions' ? { granted: false } : { answer: 'other' }),
          )
        ).status,
      ).toBe(409);
    },
  );
  it.each(['permissions', 'clarifications'])(
    'does not turn a committed %s write into failure when diagnostics throw',
    async (route) => {
      await seed(route === 'permissions' ? 'permission' : 'clarification');
      vi.spyOn(stream, 'publish').mockImplementation(() => {
        throw new Error('notification unavailable');
      });
      const response = await post(
        route,
        JSON.stringify(route === 'permissions' ? { granted: true } : { answer: 'answer' }),
      );
      expect(response.status).toBe(200);
      expect(await store.awaitResponse('run', 'request', 0)).not.toBeNull();
    },
  );
  it.each(['null', '[]', '"text"', '{'])('rejects malformed permission input %s', async (body) => {
    expect((await post('permissions', body)).status).toBe(400);
  });
  it('rejects expired, wrong-kind and blank clarification input with client errors', async () => {
    await seed('permission', '2020-01-01T00:00:00Z');
    expect((await post('permissions', '{"granted":true}')).status).toBe(410);
    expect((await post('clarifications', '{"answer":"   "}')).status).toBe(400);
  });
  it('rejects responding through a route with the wrong request kind', async () => {
    await seed('clarification');
    expect((await post('permissions', '{"granted":true}')).status).toBe(400);
  });
});
