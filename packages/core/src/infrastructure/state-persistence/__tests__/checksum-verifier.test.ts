import { createRunId } from '@ai-orchestrator/ports';
import type { PersistedState } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { computeStateChecksum, verifyStateChecksum } from '../checksum-verifier';

function makeState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    runId: createRunId('run-001'),
    schemaVersion: 1,
    currentState: 'PLANNING',
    previousState: 'INTAKE',
    stateEnteredAt: '2026-01-01T00:00:00Z',
    transitionCount: 2,
    stateHistory: ['INTAKE', 'PLANNING'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    persistedAt: '2026-01-01T00:00:00Z',
    persistenceVersion: 1,
    checksum: '',
    ...overrides,
  };
}

describe('computeStateChecksum', () => {
  it('returns a sha256-prefixed hex string', () => {
    const checksum = computeStateChecksum(makeState());
    expect(checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('produces deterministic output', () => {
    const state = makeState();
    expect(computeStateChecksum(state)).toBe(computeStateChecksum(state));
  });

  it('changes when state fields change', () => {
    const a = computeStateChecksum(makeState({ transitionCount: 1 }));
    const b = computeStateChecksum(makeState({ transitionCount: 2 }));
    expect(a).not.toBe(b);
  });

  it('ignores the checksum field itself', () => {
    const a = computeStateChecksum(makeState({ checksum: 'foo' }));
    const b = computeStateChecksum(makeState({ checksum: 'bar' }));
    expect(a).toBe(b);
  });
});

describe('verifyStateChecksum', () => {
  it('does not throw when checksum matches', () => {
    const state = makeState();
    const checksum = computeStateChecksum(state);
    expect(() => {
      verifyStateChecksum({ ...state, checksum });
    }).not.toThrow();
  });

  it('throws StateCorruptionError when checksum does not match', () => {
    const state = makeState({ checksum: 'sha256:0000' });
    expect(() => {
      verifyStateChecksum(state);
    }).toThrow('State corruption detected');
  });
});
