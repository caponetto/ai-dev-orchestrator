import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { FileBackedLiveRequestStore } from '../file-backed-live-request-store';
import type { LiveRequest, LiveResponse } from '../file-backed-live-request-store';

describe('FileBackedLiveRequestStore', () => {
  let baseDir: string;
  let store: FileBackedLiveRequestStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'live-req-'));
    store = new FileBackedLiveRequestStore(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const makeRequest = (overrides?: Partial<LiveRequest>): LiveRequest => ({
    runId: 'run-1',
    messageId: 'msg-1',
    kind: 'permission',
    createdAt: '2026-01-01T00:00:00Z',
    payload: { action: 'file_write', resource: 'src/main.ts' },
    ...overrides,
  });

  const makeResponse = (overrides?: Partial<LiveResponse>): LiveResponse => ({
    runId: 'run-1',
    messageId: 'msg-1',
    respondedAt: '2026-01-01T00:00:01Z',
    payload: { granted: true, reason: 'Approved by user' },
    ...overrides,
  });

  describe('writeRequest', () => {
    it('creates a JSON file under live-requests/', async () => {
      await store.writeRequest(makeRequest());

      const filePath = join(baseDir, 'run-1', 'live-requests', 'msg-1.json');
      const content = JSON.parse(await readFile(filePath, 'utf-8')) as {
        runId: string;
        messageId: string;
        kind: string;
      };
      expect(content.runId).toBe('run-1');
      expect(content.messageId).toBe('msg-1');
      expect(content.kind).toBe('permission');
    });

    it('creates directories if they do not exist', async () => {
      await store.writeRequest(makeRequest({ runId: 'new-run' }));

      const files = await readdir(join(baseDir, 'new-run', 'live-requests'));
      expect(files).toContain('msg-1.json');
    });
  });

  describe('writeResponse', () => {
    it('creates a JSON file under live-responses/', async () => {
      await store.writeResponse(makeResponse());

      const filePath = join(baseDir, 'run-1', 'live-responses', 'msg-1.json');
      const content = JSON.parse(await readFile(filePath, 'utf-8')) as {
        payload: { granted: boolean };
      };
      expect(content.payload.granted).toBe(true);
    });
  });

  describe('awaitResponse', () => {
    it('returns the response when it exists before the timeout', async () => {
      await store.writeResponse(makeResponse());

      const result = await store.awaitResponse('run-1', 'msg-1', 5_000);
      if (result === null) {
        throw new Error('expected non-null result');
      }
      expect(result.messageId).toBe('msg-1');
      expect(result.payload).toEqual({ granted: true, reason: 'Approved by user' });
    });

    it('returns null when response does not arrive before timeout', async () => {
      const result = await store.awaitResponse('run-1', 'msg-1', 200);
      expect(result).toBeNull();
    });

    it('picks up a response written during the polling interval', async () => {
      setTimeout(() => {
        void store.writeResponse(makeResponse());
      }, 100);

      const result = await store.awaitResponse('run-1', 'msg-1', 5_000);
      if (result === null) {
        throw new Error('expected non-null result');
      }
      expect(result.messageId).toBe('msg-1');
    });
  });

  describe('listPendingRequests', () => {
    it('returns empty array when no requests exist', async () => {
      const pending = await store.listPendingRequests('run-1');
      expect(pending).toEqual([]);
    });

    it('returns requests that have no corresponding response', async () => {
      await store.writeRequest(makeRequest({ messageId: 'msg-1' }));
      await store.writeRequest(makeRequest({ messageId: 'msg-2', kind: 'clarification' }));

      const pending = await store.listPendingRequests('run-1');
      expect(pending).toHaveLength(2);
    });

    it('excludes requests that have a corresponding response', async () => {
      await store.writeRequest(makeRequest({ messageId: 'msg-1' }));
      await store.writeRequest(makeRequest({ messageId: 'msg-2' }));
      await store.writeResponse(makeResponse({ messageId: 'msg-1' }));

      const pending = await store.listPendingRequests('run-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].messageId).toBe('msg-2');
    });

    it('excludes expired requests', async () => {
      await store.writeRequest(
        makeRequest({
          messageId: 'msg-expired',
          expiresAt: '2020-01-01T00:00:00Z',
        }),
      );
      await store.writeRequest(makeRequest({ messageId: 'msg-active' }));

      const pending = await store.listPendingRequests('run-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].messageId).toBe('msg-active');
    });

    it('includes requests with future expiresAt', async () => {
      await store.writeRequest(
        makeRequest({
          messageId: 'msg-future',
          expiresAt: '2099-01-01T00:00:00Z',
        }),
      );

      const pending = await store.listPendingRequests('run-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].messageId).toBe('msg-future');
    });

    it('excludes timed-out requests that have a terminal response', async () => {
      await store.writeRequest(
        makeRequest({
          messageId: 'msg-timeout',
          expiresAt: '2099-01-01T00:00:00Z',
        }),
      );
      await store.writeRequest(makeRequest({ messageId: 'msg-active' }));

      let pending = await store.listPendingRequests('run-1');
      expect(pending).toHaveLength(2);

      await store.writeResponse(
        makeResponse({
          messageId: 'msg-timeout',
          payload: { timedOut: true, granted: false },
        }),
      );

      pending = await store.listPendingRequests('run-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].messageId).toBe('msg-active');
    });

    it('returns results sorted by createdAt', async () => {
      await store.writeRequest(
        makeRequest({
          messageId: 'msg-b',
          createdAt: '2026-01-01T00:00:02Z',
        }),
      );
      await store.writeRequest(
        makeRequest({
          messageId: 'msg-a',
          createdAt: '2026-01-01T00:00:01Z',
        }),
      );

      const pending = await store.listPendingRequests('run-1');
      expect(pending[0].messageId).toBe('msg-a');
      expect(pending[1].messageId).toBe('msg-b');
    });
  });

  describe('cleanupResolved', () => {
    it('removes resolved request+response pairs', async () => {
      await store.writeRequest(makeRequest({ messageId: 'msg-1' }));
      await store.writeRequest(makeRequest({ messageId: 'msg-2' }));
      await store.writeResponse(makeResponse({ messageId: 'msg-1' }));

      const cleaned = await store.cleanupResolved('run-1');
      expect(cleaned).toBe(1);

      const pending = await store.listPendingRequests('run-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].messageId).toBe('msg-2');

      const reqFiles = await readdir(join(baseDir, 'run-1', 'live-requests'));
      expect(reqFiles).toEqual(['msg-2.json']);
    });

    it('returns 0 when no resolved pairs exist', async () => {
      await store.writeRequest(makeRequest({ messageId: 'msg-1' }));

      const cleaned = await store.cleanupResolved('run-1');
      expect(cleaned).toBe(0);
    });

    it('returns 0 when run directory does not exist', async () => {
      const cleaned = await store.cleanupResolved('nonexistent-run');
      expect(cleaned).toBe(0);
    });

    it('skips non-json files', async () => {
      await store.writeRequest(makeRequest({ messageId: 'msg-1' }));
      await store.writeResponse(makeResponse({ messageId: 'msg-1' }));

      // Add a non-json file to the requests directory
      const reqDir = join(baseDir, 'run-1', 'live-requests');
      await writeFile(join(reqDir, 'notes.txt'), 'not a request');

      const cleaned = await store.cleanupResolved('run-1');
      expect(cleaned).toBe(1);
    });

    it('returns 0 when response directory does not exist', async () => {
      await store.writeRequest(makeRequest({ messageId: 'msg-1' }));
      // No response directory created
      const cleaned = await store.cleanupResolved('run-1');
      expect(cleaned).toBe(0);
    });
  });

  describe('listPendingRequests edge cases', () => {
    it('skips non-json files in requests directory', async () => {
      await store.writeRequest(makeRequest({ messageId: 'msg-1' }));

      const reqDir = join(baseDir, 'run-1', 'live-requests');
      await writeFile(join(reqDir, 'notes.txt'), 'not a request');

      const pending = await store.listPendingRequests('run-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].messageId).toBe('msg-1');
    });

    it('skips files that fail schema validation', async () => {
      await store.writeRequest(makeRequest({ messageId: 'msg-valid' }));

      const reqDir = join(baseDir, 'run-1', 'live-requests');
      await writeFile(join(reqDir, 'msg-bad.json'), JSON.stringify({ invalid: true }));

      const pending = await store.listPendingRequests('run-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].messageId).toBe('msg-valid');
    });

    it('handles missing response directory gracefully', async () => {
      await store.writeRequest(makeRequest({ messageId: 'msg-1' }));
      // No responses directory exists
      const pending = await store.listPendingRequests('run-1');
      expect(pending).toHaveLength(1);
    });
  });
});
