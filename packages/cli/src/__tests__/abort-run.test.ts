import type { PersistedState, RunId } from '@ai-dev-orchestrator/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAbortedState, writeAbortJournalEntries } from '../abort-run';

vi.mock('../workspace-paths', () => ({
  getJournalPath: vi.fn((runDir: string) => `${runDir}/journal.md`),
}));

const mockAppend = vi.fn();

vi.mock('@ai-dev-orchestrator/journal', () => ({
  DefaultJournalWriter: vi.fn().mockImplementation(function (this: { append: typeof mockAppend }) {
    this.append = mockAppend;
  }),
}));

function makeState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    runId: 'run-test-001' as RunId,
    schemaVersion: 1,
    currentState: 'IMPLEMENTING',
    previousState: 'PLANNING',
    stateEnteredAt: '2026-08-01T10:00:00.000Z',
    transitionCount: 3,
    stateHistory: ['INTAKE', 'PLANNING', 'IMPLEMENTING'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    persistedAt: '2026-08-01T10:00:00.000Z',
    persistenceVersion: 1,
    checksum: '',
    ...overrides,
  };
}

describe('buildAbortedState', () => {
  it('produces correct aborted state from input', () => {
    const state = makeState({ currentState: 'PLANNING', transitionCount: 2 });
    const aborted = buildAbortedState(state);

    expect(aborted.currentState).toBe('ABORTED');
    expect(aborted.previousState).toBe('PLANNING');
    expect(aborted.stateHistory).toEqual([...state.stateHistory, 'ABORTED']);
    expect(aborted.transitionCount).toBe(3);
    expect(aborted.persistedAt).toBeDefined();
    // Original state properties are preserved
    expect(aborted.runId).toBe(state.runId);
    expect(aborted.workflowName).toBe(state.workflowName);
  });

  it('preserves all non-overridden fields', () => {
    const state = makeState({
      iterationCounts: { IMPLEMENTING: 2 },
      workflowVersion: '2.0.0',
    });
    const aborted = buildAbortedState(state);

    expect(aborted.iterationCounts).toEqual({ IMPLEMENTING: 2 });
    expect(aborted.workflowVersion).toBe('2.0.0');
    expect(aborted.schemaVersion).toBe(1);
  });
});

describe('writeAbortJournalEntries', () => {
  beforeEach(() => {
    mockAppend.mockClear();
  });

  it('calculates duration from stateEnteredAt', () => {
    const enteredAt = new Date(Date.now() - 5000).toISOString();
    const state = makeState({ stateEnteredAt: enteredAt });

    writeAbortJournalEntries('/tmp/runs', 'run-test-001', state, 'test abort');

    expect(mockAppend).toHaveBeenCalledTimes(2);

    const transitionEntry = mockAppend.mock.calls[0][0] as {
      type: string;
      data: { durationMs: number };
    };
    expect(transitionEntry.type).toBe('state_transition');
    expect(transitionEntry.data.durationMs).toBeGreaterThan(0);
  });

  it('uses 0 duration when stateEnteredAt is empty', () => {
    const state = makeState({ stateEnteredAt: '' });

    writeAbortJournalEntries('/tmp/runs', 'run-test-001', state, 'test abort');

    expect(mockAppend).toHaveBeenCalledTimes(2);

    const transitionEntry = mockAppend.mock.calls[0][0] as {
      type: string;
      data: { durationMs: number };
    };
    expect(transitionEntry.type).toBe('state_transition');
    expect(transitionEntry.data.durationMs).toBe(0);
  });

  it('writes state_transition and run_aborted journal entries', () => {
    const state = makeState({ transitionCount: 5 });

    writeAbortJournalEntries('/tmp/runs', 'run-test-001', state, 'Killed via CLI');

    expect(mockAppend).toHaveBeenCalledTimes(2);

    const transitionEntry = mockAppend.mock.calls[0][0] as {
      type: string;
      sequence: number;
      data: { kind: string; from: string; to: string };
    };
    expect(transitionEntry.type).toBe('state_transition');
    expect(transitionEntry.sequence).toBe(5);
    expect(transitionEntry.data.kind).toBe('state_transition');
    expect(transitionEntry.data.from).toBe('IMPLEMENTING');
    expect(transitionEntry.data.to).toBe('ABORTED');

    const abortEntry = mockAppend.mock.calls[1][0] as {
      type: string;
      sequence: number;
      data: { kind: string; reason: string; status: string };
    };
    expect(abortEntry.type).toBe('run_aborted');
    expect(abortEntry.sequence).toBe(6);
    expect(abortEntry.data.kind).toBe('run_lifecycle');
    expect(abortEntry.data.reason).toBe('Killed via CLI');
    expect(abortEntry.data.status).toBe('aborted');
  });
});
