import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileBackedLiveRequestStore } from '../file-backed-live-request-store';

vi.mock('node:fs/promises', async (load) => {
  const actual = await load<typeof fs>();
  return { ...actual, link: vi.fn(actual.link), readFile: vi.fn(actual.readFile) };
});
const real = await vi.importActual<typeof fs>('node:fs/promises');
let root: string;
let store: FileBackedLiveRequestStore;
const request = {
  runId: 'run',
  messageId: 'request',
  kind: 'permission' as const,
  createdAt: '',
  payload: {},
};
const response = {
  runId: 'run',
  messageId: 'request',
  respondedAt: '',
  payload: { granted: true },
};
beforeEach(async () => {
  root = await real.mkdtemp(join(tmpdir(), 'response-retirement-'));
  store = new FileBackedLiveRequestStore(root);
  vi.mocked(fs.link).mockReset().mockImplementation(real.link);
  vi.mocked(fs.readFile).mockReset().mockImplementation(real.readFile);
  await store.writeRequest(request);
});
afterEach(async () => {
  await real.rm(root, { recursive: true, force: true });
});
function barrier() {
  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  vi.mocked(fs.link).mockImplementationOnce((from, to) => {
    reached();
    return held.then(() => real.link(from, to));
  });
  return { entered, release };
}
describe('immutable response retirement', () => {
  it('rejects a competing publication with no valid decision instead of overwriting it', async () => {
    vi.mocked(fs.link).mockImplementationOnce(async (_from, to) => {
      await real.writeFile(to, '{}');
      throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
    });
    await expect(store.writeResponse(response, { requireRequest: true })).rejects.toThrow(
      'already has a response',
    );
    expect(await real.readFile(join(root, 'run', 'live-responses', 'request.json'), 'utf8')).toBe(
      '{}',
    );
  });
  it('hides a retired catalog entry even when interrupted cleanup removed only the response', async () => {
    await store.writeResponse(response);
    await real.mkdir(join(root, 'run', 'live-resolved'));
    await real.link(
      join(root, 'run', 'live-responses', 'request.json'),
      join(root, 'run', 'live-resolved', 'request.json'),
    );
    await real.unlink(join(root, 'run', 'live-responses', 'request.json'));
    expect(await store.listPendingRequests('run')).toEqual([]);
    expect(await store.writeResponse(response, { requireRequest: true })).toBe('already_responded');
  });
  it('preserves the request if an active response disappears during a cleanup retry', async () => {
    await store.writeResponse(response);
    await real.mkdir(join(root, 'run', 'live-resolved'));
    await real.link(
      join(root, 'run', 'live-responses', 'request.json'),
      join(root, 'run', 'live-resolved', 'request.json'),
    );
    vi.mocked(fs.link).mockImplementationOnce(async (from) => {
      await real.unlink(from);
      throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
    });
    expect(await store.cleanupResolved('run')).toBe(0);
    expect(await real.readdir(join(root, 'run', 'live-requests'))).toEqual(['request.json']);
    expect(await store.writeResponse(response, { requireRequest: true })).toBe('already_responded');
  });
  it('recognizes retirement when the request disappears during pre-publication validation', async () => {
    let reached!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const read = new Promise<never>((_resolve, reject) => {
      release = () => {
        reject(Object.assign(new Error('missing response'), { code: 'ENOENT' }));
      };
    });
    vi.mocked(fs.readFile)
      .mockImplementationOnce(real.readFile)
      .mockImplementationOnce(() => {
        reached();
        return read;
      });
    const late = store.writeResponse(response, { requireRequest: true });
    await entered;
    await store.writeResponse(response, { requireRequest: true });
    await store.cleanupResolved('run');
    release();
    expect(await late).toBe('already_responded');
    expect(await real.readdir(join(root, 'run', 'live-responses'))).toEqual([]);
  });
  it.each([true, false])(
    'keeps the winner when a paused writer publishes after cleanup (same=%s)',
    async (same) => {
      const held = barrier();
      const late = store.writeResponse(response, { requireRequest: true });
      const observed = same
        ? expect(late).resolves.toBe('already_responded')
        : expect(late).rejects.toThrow('already has a response');
      await held.entered;
      await store.writeResponse(
        { ...response, payload: { granted: same } },
        { requireRequest: true },
      );
      expect(await store.cleanupResolved('run')).toBe(1);
      held.release();
      await observed;
      expect(await real.readdir(join(root, 'run', 'live-responses'))).toEqual([]);
      expect(
        JSON.parse(await real.readFile(join(root, 'run', 'live-resolved', 'request.json'), 'utf8')),
      ).toMatchObject({ payload: { granted: same } });
      expect(await store.listPendingRequests('run')).toEqual([]);
    },
  );
  it('does not republish a retired request when registration races cleanup', async () => {
    const held = barrier();
    const registration = store.writeRequest(request);
    const rejected = expect(registration).rejects.toThrow('retired');
    await held.entered;
    await store.writeResponse(response);
    await store.cleanupResolved('run');
    held.release();
    await rejected;
    expect(await real.readdir(join(root, 'run', 'live-requests'))).toEqual([]);
  });
  it.each([true, false])(
    'resumes cleanup after receipt publication (request present=%s)',
    async (present) => {
      await store.writeResponse(response);
      await real.mkdir(join(root, 'run', 'live-resolved'));
      await real.link(
        join(root, 'run', 'live-responses', 'request.json'),
        join(root, 'run', 'live-resolved', 'request.json'),
      );
      if (!present) {
        await real.unlink(join(root, 'run', 'live-requests', 'request.json'));
      }
      expect(await store.cleanupResolved('run')).toBe(present ? 1 : 0);
      expect(await real.readdir(join(root, 'run', 'live-responses'))).toEqual([]);
      expect(await store.writeResponse(response, { requireRequest: true })).toBe(
        'already_responded',
      );
    },
  );
  it('retains active files if retirement publication fails, then permits a safe cleanup retry', async () => {
    await store.writeResponse(response);
    vi.mocked(fs.link).mockRejectedValueOnce(new Error('archive unavailable'));
    expect(await store.cleanupResolved('run')).toBe(0);
    expect(await store.awaitResponse('run', 'request', 0)).toEqual(response);
    expect(await store.cleanupResolved('run')).toBe(1);
  });
  it.each([
    'invalid JSON',
    JSON.stringify({ ...response, runId: 'other' }),
    JSON.stringify({ ...response, messageId: 'other' }),
  ])('fails closed for an invalid retirement receipt (%s)', async (data) => {
    await real.mkdir(join(root, 'run', 'live-resolved'));
    await real.writeFile(join(root, 'run', 'live-resolved', 'request.json'), data);
    await expect(store.writeResponse(response, { requireRequest: true })).rejects.toThrow(
      'invalid',
    );
    await expect(store.writeRequest(request)).rejects.toThrow('invalid');
    expect(await store.listPendingRequests('run')).toEqual([]);
  });
  it('does not treat a receipt read error as an absent receipt', async () => {
    await real.mkdir(join(root, 'run', 'live-resolved', 'request.json'), { recursive: true });
    await expect(store.writeResponse(response)).rejects.toThrow();
    expect(await store.awaitResponse('run', 'request', 0)).toBeNull();
  });
  it('does not delete a response that arrived before its request catalog entry', async () => {
    await store.writeResponse({ ...response, messageId: 'early' });
    expect(await store.cleanupResolved('run')).toBe(0);
    expect(await store.awaitResponse('run', 'early', 0)).not.toBeNull();
  });
  it('compares expiry instants rather than timestamp spelling and rejects invalid expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    try {
      await store.writeRequest({
        ...request,
        messageId: 'future',
        expiresAt: '2026-06-01T10:00:00-03:00',
      });
      await store.writeRequest({
        ...request,
        messageId: 'past',
        expiresAt: '2026-06-01T14:00:00+03:00',
      });
      await store.writeRequest({
        ...request,
        messageId: 'equal',
        expiresAt: '2026-06-01T12:00:00Z',
      });
      expect((await store.listPendingRequests('run')).map((entry) => entry.messageId)).toEqual([
        'future',
        'request',
      ]);
      await expect(
        store.writeRequest({ ...request, messageId: 'bad', expiresAt: 'not a date' }),
      ).rejects.toThrow('invalid');
      await expect(
        store.writeResponse({ ...response, messageId: 'past' }, { requireRequest: true }),
      ).rejects.toThrow('expired');
      await expect(
        store.writeResponse(
          { ...response, messageId: 'past', payload: { granted: false, timedOut: true } },
          { requireRequest: true },
        ),
      ).rejects.toThrow('expired');
    } finally {
      vi.useRealTimers();
    }
  });
});
