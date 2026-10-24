import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { OwnedProcess } from '../owned-process';

const fixture = fileURLToPath(new URL('../../test/fixtures/process-tree.mjs', import.meta.url));
const roots: string[] = [];
const owned: OwnedProcess[] = [];
function running(pid: number): boolean {
  try {
    const stat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    return stat.length > 0 && !stat.startsWith('Z');
  } catch {
    return false;
  }
}
afterEach(async () => {
  for (const owner of owned.splice(0)) {
    owner.kill();
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});
describe.skipIf(process.platform === 'win32')(
  'private process groups with real descendants',
  () => {
    it.each([
      { parentExit: false, closedPipes: false },
      { parentExit: true, closedPipes: false },
      { parentExit: true, closedPipes: true },
    ])(
      'cleans descendants with $parentExit parent exit and $closedPipes closed pipes',
      async ({ parentExit, closedPipes }) => {
        const root = await mkdtemp(join(tmpdir(), 'owned-tree-'));
        roots.push(root);
        const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          detached: true,
        });
        const sentinelOwner = new OwnedProcess(sentinel, { ownsGroup: true, graceMs: 100 });
        owned.push(sentinelOwner);
        const child = spawn(process.execPath, [fixture], {
          detached: true,
          env: {
            ...process.env,
            TREE_ROOT: root,
            TREE_PARENT_EXIT: parentExit ? '1' : '0',
            TREE_CLOSED_PIPES: closedPipes ? '1' : '0',
          },
        });
        const owner = new OwnedProcess(child, { ownsGroup: true, graceMs: 150 });
        owned.push(owner);
        try {
          await vi.waitFor(() => {
            expect(existsSync(join(root, 'leaf.beat'))).toBe(true);
          });
          const parent = Number(readFileSync(join(root, 'parent.pid'), 'utf8'));
          const leaf = Number(readFileSync(join(root, 'leaf.pid'), 'utf8'));
          if (!parentExit) {
            owner.kill();
          }
          await owner.closed;
          await vi.waitFor(() => {
            expect(running(parent)).toBe(false);
            expect(running(leaf)).toBe(false);
          });
          assert(sentinel.pid);
          expect(running(sentinel.pid)).toBe(true);
        } finally {
          owner.kill();
          sentinelOwner.kill();
          await Promise.all([owner.closed, sentinelOwner.closed]);
        }
      },
      10000,
    );
  },
);
