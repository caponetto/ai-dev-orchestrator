import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), hostname: vi.fn(() => 'test-host') };
});

vi.mock('../workspace-paths', () => ({
  getJournalPath: vi.fn((runDir: string) => `${runDir}/journal.md`),
}));

const mockLoad = vi.fn();
const mockReconstruct = vi.fn();

vi.mock('@ai-orchestrator/core', () => ({
  DefaultStatePersistence: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.load = mockLoad;
    this.reconstructFromJournal = mockReconstruct;
  }),
}));

vi.mock('@ai-orchestrator/workflow', () => ({
  DefaultJournalReader: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.readAll = vi.fn().mockReturnValue([]);
  }),
}));

import { recoverRunState, readLockMetadata, terminateRunFromLock } from '../run-state-recovery';

describe('recoverRunState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad.mockReturnValue(null);
    mockReconstruct.mockReturnValue(null);
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it('returns checkpoint state when available', () => {
    const checkpointState = { runId: 'run-1', currentState: 'IMPL' };
    mockLoad.mockReturnValue(checkpointState);

    const result = recoverRunState('/runs', 'run-1');
    expect(result.source).toBe('checkpoint');
    expect(result.state).toBe(checkpointState);
  });

  it('falls through to journal when checkpoint load throws', () => {
    mockLoad.mockImplementation(() => {
      throw new Error('corrupt');
    });
    const journalState = { runId: 'run-1', currentState: 'REVIEW' };
    mockReconstruct.mockReturnValue(journalState);

    const result = recoverRunState('/runs', 'run-1');
    expect(result.source).toBe('journal');
    expect(result.state).toBe(journalState);
  });

  it('falls through to lock when both checkpoint and journal fail', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      'pid: 1234\nacquiredAt: "2025-01-01T00:00:00Z"\nhostname: test-host',
    );

    const result = recoverRunState('/runs', 'run-1');
    expect(result.source).toBe('lock');
    expect(result.lock).toEqual({
      pid: 1234,
      acquiredAt: '2025-01-01T00:00:00Z',
      hostname: 'test-host',
    });
    expect(result.state).not.toBeNull();
  });

  it('returns null state when no recovery source exists', () => {
    const result = recoverRunState('/runs', 'run-1');
    expect(result).toEqual({ state: null, source: null, lock: null });
  });
});

describe('readLockMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses valid lock YAML', () => {
    vi.mocked(readFileSync).mockReturnValue(
      'pid: 5678\nacquiredAt: "2025-06-01T12:00:00Z"\nhostname: prod-host',
    );
    const result = readLockMetadata('/runs/run-1/run.lock');
    expect(result).toEqual({
      pid: 5678,
      acquiredAt: '2025-06-01T12:00:00Z',
      hostname: 'prod-host',
    });
  });

  it('returns null when file read fails', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = readLockMetadata('/nonexistent');
    expect(result).toBeNull();
  });

  it('returns undefined fields for non-matching types', () => {
    vi.mocked(readFileSync).mockReturnValue('pid: "not-a-number"\nacquiredAt: 42');
    const result = readLockMetadata('/runs/run-1/run.lock');
    expect(result?.pid).toBeUndefined();
    expect(result?.acquiredAt).toBeUndefined();
  });
});

describe('terminateRunFromLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  it('does nothing when lock is null', () => {
    terminateRunFromLock(null);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('does nothing when lock has no pid', () => {
    terminateRunFromLock({ acquiredAt: '2025-01-01T00:00:00Z' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('does nothing when hostname does not match', () => {
    vi.mocked(hostname).mockReturnValue('test-host');
    terminateRunFromLock({ pid: 1234, hostname: 'other-host' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('kills the process group when hostname matches', () => {
    vi.mocked(hostname).mockReturnValue('test-host');
    terminateRunFromLock({ pid: 1234, hostname: 'test-host' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(process.kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
  });

  it('falls back to killing the pid if group kill fails', () => {
    vi.mocked(hostname).mockReturnValue('test-host');
    vi.spyOn(process, 'kill')
      .mockImplementationOnce(() => {
        throw new Error('ESRCH');
      })
      .mockImplementation(() => true);

    terminateRunFromLock({ pid: 1234, hostname: 'test-host' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(process.kill).toHaveBeenCalledWith(1234, 'SIGTERM');
  });
});
