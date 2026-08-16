import { describe, expect, it } from 'vitest';

import {
  lockFileContentSchema,
  recoveryResultSchema,
  recoveryScenarioSchema,
  shutdownStateSchema,
} from '../recovery-schemas';

describe('recoveryScenarioSchema', () => {
  it.each([
    'clean_load',
    'crash_during_worker',
    'crash_during_transition',
    'provider_timeout',
    'invalid_structured_output',
    'partial_artifact',
    'interrupted_workflow',
    'concurrent_execution',
    'disk_full',
    'state_corruption',
    'network_partition',
  ])('accepts "%s"', (val) => {
    expect(recoveryScenarioSchema.safeParse(val).success).toBe(true);
  });

  it('rejects unknown scenario', () => {
    expect(recoveryScenarioSchema.safeParse('unknown_error').success).toBe(false);
  });
});

describe('recoveryResultSchema', () => {
  it('validates a successful recovery with state', () => {
    const data = {
      scenario: 'crash_during_worker',
      recovered: true,
      state: {
        runId: 'run-123',
        schemaVersion: 1,
        currentState: 'IMPLEMENTATION',
        previousState: null,
        stateEnteredAt: '2026-01-01T00:00:00Z',
        transitionCount: 3,
        stateHistory: ['SPECIFICATION', 'PLANNING', 'IMPLEMENTATION'],
        iterationCounts: {},
        activeArtifacts: [],
        lastProducedArtifact: null,
        workflowName: 'default',
        workflowVersion: '1.0.0',
        persistedAt: '2026-01-01T00:00:00Z',
        persistenceVersion: 1,
        checksum: 'sha256-abc',
      },
      warnings: ['Worker output may be incomplete'],
      discardedWork: ['w-5'],
    };
    expect(recoveryResultSchema.safeParse(data).success).toBe(true);
  });

  it('validates a failed recovery with null state', () => {
    const data = {
      scenario: 'state_corruption',
      recovered: false,
      state: null,
      warnings: ['State file corrupted'],
      discardedWork: [],
    };
    expect(recoveryResultSchema.safeParse(data).success).toBe(true);
  });
});

describe('shutdownStateSchema', () => {
  it('validates a shutdown state', () => {
    const data = {
      requested: true,
      reason: 'signal',
      requestedAt: '2026-01-01T00:00:00Z',
    };
    expect(shutdownStateSchema.safeParse(data).success).toBe(true);
  });

  it.each(['signal', 'timeout', 'abort'])('accepts reason "%s"', (reason) => {
    const data = { requested: true, reason, requestedAt: '2026-01-01T00:00:00Z' };
    expect(shutdownStateSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid reason', () => {
    const data = { requested: true, reason: 'crash', requestedAt: '2026-01-01T00:00:00Z' };
    expect(shutdownStateSchema.safeParse(data).success).toBe(false);
  });
});

describe('lockFileContentSchema', () => {
  it('validates lock file content', () => {
    const data = {
      pid: 12345,
      startedAt: '2026-01-01T00:00:00Z',
      runId: 'run-123',
      hostname: 'dev-machine',
    };
    expect(lockFileContentSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing pid', () => {
    const data = {
      startedAt: '2026-01-01T00:00:00Z',
      runId: 'run-123',
      hostname: 'dev-machine',
    };
    expect(lockFileContentSchema.safeParse(data).success).toBe(false);
  });
});
