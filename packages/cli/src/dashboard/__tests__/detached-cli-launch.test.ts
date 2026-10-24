import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnDetachedCli } from '../detached-cli-launch';

const real = vi.hoisted(() => ({
  spawn: null as typeof spawn | null,
  close: null as typeof closeSync | null,
}));
vi.mock('node:child_process', async (load) => {
  const actual = await load<{ spawn: typeof spawn }>();
  real.spawn = actual.spawn;
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
vi.mock('node:fs', async (load) => {
  const actual = await load<{ openSync: typeof openSync; closeSync: typeof closeSync }>();
  real.close = actual.closeSync;
  return { ...actual, openSync: vi.fn(actual.openSync), closeSync: vi.fn(actual.closeSync) };
});
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'control-launch-'));
  assert(real.spawn);
  assert(real.close);
  vi.mocked(spawn).mockReset().mockImplementation(real.spawn);
  vi.mocked(closeSync).mockReset().mockImplementation(real.close);
  vi.mocked(openSync).mockClear();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
function fakeChild() {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
  return child;
}
describe('detached CLI launch acknowledgement', () => {
  it('acknowledges real OS spawn even when the child immediately fails, without claiming execution success', async () => {
    const entry = join(root, 'exit.mjs');
    writeFileSync(entry, 'process.exit(47);');
    const pending = spawnDetachedCli(root, [], join(root, 'stderr.log'), 'receipt', entry);
    const child = vi.mocked(spawn).mock.results[0];
    assert(child.type === 'return');
    const exited = new Promise<number | null>((resolve) => child.value.once('exit', resolve));
    await expect(pending).resolves.toBeUndefined();
    expect(await exited).toBe(47);
    expect(closeSync).toHaveBeenCalledTimes(1);
  });
  it('rejects a real asynchronous spawn error when an existing file is used as cwd', async () => {
    const notDirectory = join(root, 'file');
    writeFileSync(notDirectory, 'not a directory');
    await expect(
      spawnDetachedCli(notDirectory, [], join(root, 'stderr.log'), undefined, 'unused.mjs'),
    ).rejects.toThrow();
    expect(closeSync).toHaveBeenCalledTimes(1);
  });
  it('waits for spawn, falls back to the temporary cwd, and closes no nonexistent descriptor', async () => {
    const child = fakeChild();
    let settled = false;
    const pending = spawnDetachedCli(join(root, 'missing'), ['retry', 'run']).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(child.unref).not.toHaveBeenCalled();
    child.emit('spawn');
    await pending;
    expect(child.unref).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [process.argv[1], 'retry', 'run'],
      expect.objectContaining({ cwd: tmpdir() }),
    );
    expect(closeSync).not.toHaveBeenCalled();
  });
  it('closes the parent log descriptor when spawn throws synchronously', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('spawn unavailable');
    });
    await expect(spawnDetachedCli(root, [], join(root, 'stderr.log'))).rejects.toThrow(
      'spawn unavailable',
    );
    expect(closeSync).toHaveBeenCalledTimes(1);
  });
  it('closes the descriptor on an emitted spawn error and never unrefs a failed launch', async () => {
    const child = fakeChild();
    const pending = spawnDetachedCli(root, [], join(root, 'stderr.log'));
    const rejected = expect(pending).rejects.toThrow('spawn denied');
    child.emit('error', new Error('spawn denied'));
    await rejected;
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(child.unref).not.toHaveBeenCalled();
  });
  it('does not spawn when opening the diagnostic log fails', async () => {
    await expect(spawnDetachedCli(root, [], join(root, 'missing', 'stderr.log'))).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
    expect(closeSync).not.toHaveBeenCalled();
  });
  it('does not turn an observed launch into failure when descriptor cleanup fails', async () => {
    const child = fakeChild();
    vi.mocked(closeSync).mockImplementationOnce((fd) => {
      assert(real.close);
      real.close(fd);
      throw new Error('cleanup failed');
    });
    const pending = spawnDetachedCli(root, [], join(root, 'stderr.log'));
    child.emit('spawn');
    await expect(pending).resolves.toBeUndefined();
    expect(closeSync).toHaveBeenCalledOnce();
  });
});
