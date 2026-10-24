import type * as FsPromises from 'node:fs/promises';
import { link, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { FileBackedLiveRequestStore } from '../file-backed-live-request-store';

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof FsPromises>();
  return { ...fs, link: vi.fn(fs.link) };
});

describe('live request publication failures', () => {
  it.each(['request', 'response'] as const)(
    'reports %s publication failure and removes its temporary file',
    async (kind) => {
      const dir = await mkdtemp(join(tmpdir(), 'live-publication-'));
      try {
        const store = new FileBackedLiveRequestStore(dir);
        vi.mocked(link).mockRejectedValueOnce(
          Object.assign(new Error('publication unavailable'), { code: 'EIO' }),
        );
        await expect(
          kind === 'request'
            ? store.writeRequest({
                runId: 'run',
                messageId: 'request',
                kind: 'permission',
                createdAt: '',
                payload: {},
              })
            : store.writeResponse({
                runId: 'run',
                messageId: 'request',
                respondedAt: '',
                payload: { granted: true },
              }),
        ).rejects.toThrow('publication unavailable');
        expect(
          await readdir(join(dir, 'run', kind === 'request' ? 'live-requests' : 'live-responses')),
        ).toEqual([]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.each(['invalid-json', 'different-run', 'unreadable'] as const)(
    'refuses to answer a request with %s catalog contents',
    async (corruption) => {
      const dir = await mkdtemp(join(tmpdir(), 'live-catalog-'));
      try {
        const path = join(dir, 'run/live-requests/request.json');
        await mkdir(join(dir, 'run/live-requests'), { recursive: true });
        if (corruption === 'unreadable') {
          await mkdir(path);
        } else {
          await writeFile(
            path,
            corruption === 'invalid-json'
              ? '{'
              : JSON.stringify({
                  runId: 'other-run',
                  messageId: 'request',
                  kind: 'permission',
                  createdAt: '',
                  payload: {},
                }),
          );
        }
        const store = new FileBackedLiveRequestStore(dir);
        await expect(
          store.writeResponse({
            runId: 'run',
            messageId: 'request',
            respondedAt: '',
            payload: { granted: true },
          }),
        ).rejects.toThrow(corruption === 'unreadable' ? 'directory' : 'identity');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
