import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';

import { rebuildStateFromEvents } from '@ai-dev-orchestrator/core';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { StatePersistence } from '@ai-dev-orchestrator/ports';
import type { JournalEvent, PersistedState } from '@ai-dev-orchestrator/schemas';
import { persistedStateSchema } from '@ai-dev-orchestrator/schemas';
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

vi.mock('@ai-dev-orchestrator/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DefaultStatePersistence: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.load = mockLoad;
    this.reconstructFromJournal = mockReconstruct;
  }),
}));

vi.mock('@ai-dev-orchestrator/workflow', () => ({
  DefaultJournalReader: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.readAll = vi.fn().mockReturnValue([]);
  }),
}));

import {
  loadLatestRunState,
  recoverRunState,
  readLockMetadata,
  terminateRunFromLock,
} from '../run-state-recovery';

describe('loadLatestRunState', () => {
  function state(overrides: Partial<PersistedState> = {}): PersistedState {
    return {
      runId: createRunId('run-1'),
      schemaVersion: 2,
      currentState: 'WORK',
      previousState: null,
      stateEnteredAt: '2026-01-01T00:00:00.000Z',
      transitionCount: 1,
      stateHistory: ['WORK'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'test',
      workflowVersion: '1',
      persistedAt: '2026-01-01T00:00:00.000Z',
      persistenceVersion: 1,
      checksum: '',
      ...overrides,
    };
  }
  function event(snapshot: PersistedState, sequence: number): JournalEvent {
    return {
      runId: snapshot.runId,
      timestamp: snapshot.persistedAt,
      sequence,
      type: 'workflow_checkpoint',
      data: { kind: 'workflow_checkpoint', state: snapshot },
    };
  }
  function persistence(checkpoint: PersistedState | null) {
    return {
      load: vi.fn().mockReturnValue(checkpoint),
      reconstructFromJournal:
        vi.fn<StatePersistence['reconstructFromJournal']>(rebuildStateFromEvents),
    };
  }

  it('prefers a completed cleanup cursor in the journal even within the same millisecond', () => {
    const checkpoint = state({
      pendingTerminalState: 'DONE',
      entryActionContinuation: { stateId: 'DONE', completedResults: [], nextActionIndex: 0 },
    });
    const newer = state({
      ...checkpoint,
      entryActionContinuation: {
        stateId: 'DONE',
        completedResults: [{ action: { type: 'notify_human', params: {} }, success: true }],
        nextActionIndex: 1,
      },
    });
    const result = loadLatestRunState(persistence(checkpoint), checkpoint.runId, [
      event(persistedStateSchema.parse(checkpoint), 1),
      event(persistedStateSchema.parse(newer), 2),
    ]);
    expect(result.source).toBe('journal');
    expect(result.state?.entryActionContinuation?.nextActionIndex).toBe(1);
  });

  it('replays completed workers after the last checkpoint without losing earlier snapshot fields', () => {
    const checkpoint = state({ repoRoot: '/cloned', cumulativeInputTokens: 20 });
    const completion: JournalEvent = {
      runId: checkpoint.runId,
      sequence: 2,
      timestamp: checkpoint.persistedAt,
      type: 'worker_completed',
      data: {
        kind: 'worker',
        workerId: 'worker',
        role: 'planner',
        stateId: 'WORK',
        status: 'success',
        inputTokens: 10,
      },
    };
    const result = loadLatestRunState(persistence(checkpoint), checkpoint.runId, [
      completion,
      event(checkpoint, 1),
    ]);
    expect(result.state).toMatchObject({ repoRoot: '/cloned', cumulativeInputTokens: 30 });
  });

  it('preserves a checkpoint rewritten for retry after the latest journal snapshot', () => {
    const old = state({ currentState: 'ABORTED' });
    const checkpoint = state({ persistedAt: '2026-01-01T00:00:01.000Z' });
    expect(loadLatestRunState(persistence(checkpoint), checkpoint.runId, [event(old, 1)])).toEqual({
      state: checkpoint,
      source: 'checkpoint',
    });
  });

  it('uses a newer journal snapshot when the checkpoint has no matching journal event', () => {
    const checkpoint = state();
    const newer = state({ currentState: 'DONE', persistedAt: '2026-01-01T00:00:01.000Z' });
    expect(
      loadLatestRunState(persistence(checkpoint), checkpoint.runId, [event(newer, 2)]).state
        ?.currentState,
    ).toBe('DONE');
  });

  it('uses an identical final checkpoint without replay and ignores other runs', () => {
    const checkpoint = state();
    const store = persistence(checkpoint);
    expect(
      loadLatestRunState(store, checkpoint.runId, [
        event(checkpoint, 1),
        event(state({ runId: createRunId('other') }), 2),
      ]).source,
    ).toBe('checkpoint');
    expect(vi.mocked(store).reconstructFromJournal).not.toHaveBeenCalled();
  });

  it('retains the checkpoint if reconstruction is unavailable', () => {
    const checkpoint = state();
    const store = persistence(checkpoint);
    vi.mocked(store).reconstructFromJournal.mockReturnValue(null);
    expect(
      loadLatestRunState(store, checkpoint.runId, [
        event(checkpoint, 1),
        event(state({ currentState: 'DONE' }), 2),
      ]).state,
    ).toBe(checkpoint);
  });
});

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
