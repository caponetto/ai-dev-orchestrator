import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRunId } from '@ai-dev-orchestrator/ports';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';

import { LockManager } from '../lock-manager';

const realFs = vi.hoisted(() => ({
  writeFileSync: null as null | typeof writeFileSync,
}));

vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  realFs.writeFileSync = mod.writeFileSync as typeof writeFileSync;
  return { ...mod, writeFileSync: vi.fn(mod.writeFileSync as typeof writeFileSync) };
});

const TEST_DIR = join(tmpdir(), `lock-manager-test-${String(Date.now())}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  vi.mocked(writeFileSync).mockRestore();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('LockManager', () => {
  it('acquires a lock for a run', () => {
    const manager = new LockManager(TEST_DIR);
    const handle = manager.acquire(createRunId('run-001'));

    expect(handle.runId).toBe('run-001');
    expect(handle.pid).toBe(process.pid);
    expect(existsSync(handle.lockPath)).toBe(true);

    manager.release(handle);
  });

  it('releases a lock', () => {
    const manager = new LockManager(TEST_DIR);
    const handle = manager.acquire(createRunId('run-001'));
    manager.release(handle);

    expect(existsSync(handle.lockPath)).toBe(false);
  });

  it('throws RunAlreadyActiveError when locked by current process', () => {
    const manager = new LockManager(TEST_DIR);
    const handle = manager.acquire(createRunId('run-001'));

    expect(() => manager.acquire(createRunId('run-001'))).toThrow('already active');

    manager.release(handle);
  });

  it('removes stale lock from dead process on same host', () => {
    const manager = new LockManager(TEST_DIR);
    const runDir = join(TEST_DIR, 'run-stale');
    mkdirSync(runDir, { recursive: true });

    const staleLock = {
      runId: createRunId('run-stale'),
      pid: 999999,
      acquiredAt: '2020-01-01T00:00:00Z',
      lockPath: join(runDir, 'run.lock'),
      hostname: hostname(),
    };
    writeFileSync(staleLock.lockPath, stringify(staleLock), 'utf8');

    const handle = manager.acquire(createRunId('run-stale'));
    expect(handle.pid).toBe(process.pid);

    manager.release(handle);
  });

  it('handles release of non-existent lock gracefully', () => {
    const manager = new LockManager(TEST_DIR);
    expect(() => {
      manager.release({
        runId: createRunId('run-gone'),
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        lockPath: join(TEST_DIR, 'run-gone', 'run.lock'),
        hostname: hostname(),
      });
    }).not.toThrow();
  });

  it('stores hostname in lock file', () => {
    const manager = new LockManager(TEST_DIR);
    const handle = manager.acquire(createRunId('run-host'));
    expect(handle.hostname).toBe(hostname());
    manager.release(handle);
  });

  it('acquire removes stale lock and succeeds', () => {
    const manager = new LockManager(TEST_DIR);
    const lockPath = join(TEST_DIR, 'run-stale2', 'run.lock');
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(
      lockPath,
      stringify({
        runId: createRunId('run-stale2'),
        pid: 999999,
        acquiredAt: new Date().toISOString(),
        lockPath,
        hostname: hostname(),
      }),
      'utf8',
    );

    const handle = manager.acquire(createRunId('run-stale2'));
    expect(handle.pid).toBe(process.pid);
    manager.release(handle);
  });

  it('throws RunAlreadyActiveError for foreign-host lock and does not delete it', () => {
    const manager = new LockManager(TEST_DIR);
    const lockPath = join(TEST_DIR, 'run-foreign', 'run.lock');
    mkdirSync(dirname(lockPath), { recursive: true });
    const foreignLockData = stringify({
      runId: createRunId('run-foreign'),
      pid: 12345,
      acquiredAt: new Date().toISOString(),
      lockPath,
      hostname: 'remote-server.example.com',
    });
    writeFileSync(lockPath, foreignLockData, 'utf8');

    expect(() => manager.acquire(createRunId('run-foreign'))).toThrow('already active');
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(foreignLockData);
  });

  it('does not remove unreadable lock file and throws LockAcquisitionError', () => {
    const manager = new LockManager(TEST_DIR);
    const lockPath = join(TEST_DIR, 'run-race', 'run.lock');
    mkdirSync(dirname(lockPath), { recursive: true });

    writeFileSync(lockPath, '{{not-valid-yaml', 'utf8');

    expect(() => manager.acquire(createRunId('run-race'))).toThrow('unreadable');
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('{{not-valid-yaml');
  });

  it('probe returns exists:true and unreadable:true when lock file is unreadable', () => {
    const manager = new LockManager(TEST_DIR);
    const lockPath = join(TEST_DIR, 'run-unreadable-probe', 'run.lock');
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, '{{corrupt-yaml', 'utf8');

    const result = manager.probe(createRunId('run-unreadable-probe'));
    expect(result.exists).toBe(true);
    expect(result.pid).toBe(0);
    expect(result.pidRunning).toBe(false);
    expect(result.unreadable).toBe(true);
  });

  it('probe returns exists:false and unreadable:false when no lock file exists', () => {
    const manager = new LockManager(TEST_DIR);
    const result = manager.probe(createRunId('run-no-lock'));
    expect(result.exists).toBe(false);
    expect(result.unreadable).toBe(false);
  });

  it('probe returns unreadable:false for a valid lock file', () => {
    const manager = new LockManager(TEST_DIR);
    const handle = manager.acquire(createRunId('run-readable'));
    const result = manager.probe(createRunId('run-readable'));
    expect(result.exists).toBe(true);
    expect(result.unreadable).toBe(false);
    expect(result.pid).toBe(process.pid);
    manager.release(handle);
  });

  it('uses exclusive create flag for atomicity', () => {
    const manager = new LockManager(TEST_DIR);
    const handle = manager.acquire(createRunId('run-atomic'));

    expect(handle.pid).toBe(process.pid);
    expect(handle.hostname).toBe(hostname());
    expect(existsSync(handle.lockPath)).toBe(true);

    manager.release(handle);
  });

  it('throws LockAcquisitionError on non-EEXIST write failure', () => {
    const manager = new LockManager(TEST_DIR);
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => manager.acquire(createRunId('run-noperm'))).toThrow('permission denied');
  });

  it('throws RunAlreadyActiveError when stale lock retry is contested with EEXIST and a winner lock exists', () => {
    const manager = new LockManager(TEST_DIR);
    const runDir = join(TEST_DIR, 'run-contest');
    mkdirSync(runDir, { recursive: true });

    const lockPath = join(runDir, 'run.lock');

    // Write stale lock (dead process, same host)
    const staleLock = {
      runId: createRunId('run-contest'),
      pid: 999999,
      acquiredAt: '2020-01-01T00:00:00Z',
      lockPath,
      hostname: hostname(),
    };
    if (realFs.writeFileSync) {
      realFs.writeFileSync(lockPath, stringify(staleLock), 'utf8');
    }

    let writeCount = 0;
    vi.mocked(writeFileSync).mockImplementation((...args: Parameters<typeof writeFileSync>) => {
      writeCount++;
      if (writeCount === 1) {
        // First write attempt hits EEXIST (lock file exists)
        const error = new Error('EEXIST: file already exists');
        throw error;
      }
      // Second write (after stale removal): another process won the race
      // Write the winner lock so readLock finds it
      if (realFs.writeFileSync) {
        realFs.writeFileSync(args[0], args[1], args[2]);
      }
      // Now place a different winner lock
      const winner = { ...staleLock, pid: 888888, hostname: hostname() };
      if (realFs.writeFileSync) {
        realFs.writeFileSync(lockPath, stringify(winner), 'utf8');
      }
      // Throw EEXIST to simulate race
      throw new Error('EEXIST: file already exists');
    });

    expect(() => manager.acquire(createRunId('run-contest'))).toThrow('already active');
  });

  it('throws LockAcquisitionError when stale lock retry fails with non-EEXIST error', () => {
    const manager = new LockManager(TEST_DIR);
    const runDir = join(TEST_DIR, 'run-io-err');
    mkdirSync(runDir, { recursive: true });

    const lockPath = join(runDir, 'run.lock');

    // Write stale lock (dead process, same host)
    const staleLock = {
      runId: createRunId('run-io-err'),
      pid: 999999,
      acquiredAt: '2020-01-01T00:00:00Z',
      lockPath,
      hostname: hostname(),
    };
    if (realFs.writeFileSync) {
      realFs.writeFileSync(lockPath, stringify(staleLock), 'utf8');
    }

    let writeCount = 0;
    vi.mocked(writeFileSync).mockImplementation(() => {
      writeCount++;
      if (writeCount === 1) {
        throw new Error('EEXIST: file already exists');
      }
      // Second write: I/O error
      throw new Error('EIO: I/O error');
    });

    expect(() => manager.acquire(createRunId('run-io-err'))).toThrow('I/O error');
  });

  it('probe reports pidRunning false for foreign-host lock regardless of PID', () => {
    const manager = new LockManager(TEST_DIR);
    const lockPath = join(TEST_DIR, 'run-foreign-probe', 'run.lock');
    mkdirSync(dirname(lockPath), { recursive: true });

    const foreignLock = {
      runId: createRunId('run-foreign-probe'),
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      lockPath,
      hostname: 'other-host.example.com',
    };
    writeFileSync(lockPath, stringify(foreignLock), 'utf8');

    const result = manager.probe(createRunId('run-foreign-probe'));
    expect(result.exists).toBe(true);
    expect(result.pidRunning).toBe(false);
    expect(result.hostname).toBe('other-host.example.com');
    expect(result.unreadable).toBe(false);
  });
});
