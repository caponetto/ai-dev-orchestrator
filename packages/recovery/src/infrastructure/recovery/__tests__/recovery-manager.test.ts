import { rebuildStateFromEvents } from '@ai-dev-orchestrator/core';
import type { JournalReader, StatePersistence } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { JournalEvent, PersistedState } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { RecoveryManager } from '../recovery-manager';

function makeMockPersistence(state: PersistedState | null = null): StatePersistence {
  return {
    save: vi.fn(),
    load: vi.fn().mockReturnValue(state),
    exists: vi.fn().mockReturnValue(state !== null),
    validate: vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
    probeLock: vi.fn().mockReturnValue({
      exists: false,
      pid: 0,
      pidRunning: false,
      hostname: '',
      unreadable: false,
    }),
    acquireLock: vi.fn().mockReturnValue({
      runId: createRunId('run-1'),
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      lockPath: '/tmp/lock',
      hostname: 'test',
    }),
    releaseLock: vi.fn(),
    reconstructFromJournal: vi.fn().mockReturnValue(null),
  };
}

function makeMockReader(events: readonly JournalEvent[] = []): JournalReader {
  return {
    readAll: () => events,
    query: () => events,
    range: (start: string, end: string) =>
      events.filter((e) => e.timestamp >= start && e.timestamp <= end),
    tail: (n: number) => events.slice(-n),
  };
}

function makeState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    runId: createRunId('run-1'),
    schemaVersion: 1,
    currentState: 'IMPLEMENTATION',
    previousState: 'PLANNING',
    stateEnteredAt: new Date().toISOString(),
    transitionCount: 2,
    stateHistory: ['INTAKE', 'PLANNING', 'IMPLEMENTATION'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    persistedAt: new Date().toISOString(),
    persistenceVersion: 1,
    checksum: 'sha256:valid',
    ...overrides,
  };
}

function makeRunStartedEvent(seq = 1): JournalEvent {
  return {
    timestamp: new Date().toISOString(),
    runId: 'run-1',
    sequence: seq,
    type: 'run_started',
    data: {
      kind: 'run_lifecycle',
      workflowName: 'default',
      workflowVersion: '1.0.0',
    },
  };
}

function makeTransitionEvent(from: string, to: string, seq: number): JournalEvent {
  return {
    timestamp: new Date().toISOString(),
    runId: 'run-1',
    sequence: seq,
    type: 'state_transition',
    data: {
      kind: 'state_transition',
      from,
      to,
      trigger: 'completion',
      durationMs: 100,
      guardsEvaluated: 1,
      guardsPassed: 1,
      governanceRequired: false,
    },
  };
}

function makeWorkerDispatchedEvent(workerId: string, stateId: string, seq: number): JournalEvent {
  return {
    timestamp: new Date().toISOString(),
    runId: 'run-1',
    sequence: seq,
    type: 'worker_dispatched',
    data: {
      kind: 'worker',
      workerId,
      role: 'implementer',
      stateId,
      status: 'dispatched',
    },
  };
}

function makeWorkerCompletedEvent(workerId: string, stateId: string, seq: number): JournalEvent {
  return {
    timestamp: new Date().toISOString(),
    runId: 'run-1',
    sequence: seq,
    type: 'worker_completed',
    data: {
      kind: 'worker',
      workerId,
      role: 'implementer',
      stateId,
      status: 'completed',
    },
  };
}

function makeWorkerFailedEvent(
  workerId: string,
  stateId: string,
  error: string,
  seq: number,
): JournalEvent {
  return {
    timestamp: new Date().toISOString(),
    runId: 'run-1',
    sequence: seq,
    type: 'worker_failed',
    data: {
      kind: 'worker',
      workerId,
      role: 'implementer',
      stateId,
      status: 'failed',
      error,
    },
  };
}

function makeErrorEvent(errorCode: string, message: string, seq: number): JournalEvent {
  return {
    timestamp: new Date().toISOString(),
    runId: 'run-1',
    sequence: seq,
    type: 'error',
    data: {
      kind: 'error',
      errorCode,
      message,
      recoverable: true,
    },
  };
}

describe('RecoveryManager', () => {
  describe('clean_load', () => {
    it('returns no-recovery-needed when state loads cleanly', () => {
      const state = makeState();
      const sp = makeMockPersistence(state);
      const reader = makeMockReader();
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.recovered).toBe(false);
      expect(result.scenario).toBe('clean_load');
      expect(result.state).toEqual(state);
    });
  });

  describe('concurrent_execution during clean_load', () => {
    it('returns concurrent_execution when checkpoint loads but lock is held by another process', () => {
      const state = makeState();
      const sp = makeMockPersistence(state);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 99999,
        pidRunning: true,
        hostname: '',
        unreadable: false,
      });
      const reader = makeMockReader();
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('concurrent_execution');
      expect(result.recovered).toBe(false);
      expect(result.state).toBeNull();
      expect(result.warnings.some((w) => w.includes('Another instance'))).toBe(true);
    });

    it('returns concurrent_execution when checkpoint loads but lock is unreadable', () => {
      const state = makeState();
      const sp = makeMockPersistence(state);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 0,
        pidRunning: false,
        hostname: '',
        unreadable: true,
      });
      const reader = makeMockReader();
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('concurrent_execution');
      expect(result.recovered).toBe(false);
      expect(result.state).toBeNull();
      expect(result.warnings.some((w) => w.includes('unreadable'))).toBe(true);
    });

    it('returns concurrent_execution when checkpoint loads but lock is held by foreign host', () => {
      const state = makeState();
      const sp = makeMockPersistence(state);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 99999,
        pidRunning: false,
        hostname: 'remote-server-42',
        unreadable: false,
      });
      const reader = makeMockReader();
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('concurrent_execution');
      expect(result.recovered).toBe(false);
      expect(result.state).toBeNull();
    });
  });

  describe('state_corruption', () => {
    it('falls back to journal when primary load throws', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('corrupt');
      });
      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeTransitionEvent('INTAKE', 'PLANNING', 2),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.recovered).toBe(true);
      expect(result.state?.currentState).toBe('PLANNING');
    });

    it('returns unrecoverable when all sources fail', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('corrupt');
      });
      const reader = makeMockReader([]);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.recovered).toBe(false);
      expect(result.state).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('crash_during_worker', () => {
    it('detects crash during worker via dispatched but never completed worker and stale lock', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 99999,
        pidRunning: false,
        hostname: '',
        unreadable: false,
      });

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeTransitionEvent('INTAKE', 'IMPLEMENTATION', 2),
        makeWorkerDispatchedEvent('worker-1', 'IMPLEMENTATION', 3),
        // No completion event — crash during worker
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('crash_during_worker');
      expect(result.recovered).toBe(true);
      expect(result.discardedWork).toContain('Worker "worker-1" was in-progress at time of crash');
    });
  });

  describe('crash_during_transition', () => {
    it('detects crash during transition via incomplete transition and stale lock', () => {
      const backupState = makeState({ currentState: 'PLANNING' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 99999,
        pidRunning: false,
        hostname: '',
        unreadable: false,
      });

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeTransitionEvent('INTAKE', 'PLANNING', 2),
        makeWorkerDispatchedEvent('w-1', 'PLANNING', 3),
        makeWorkerCompletedEvent('w-1', 'PLANNING', 4),
        // Transition is the last event — incomplete
        makeTransitionEvent('PLANNING', 'IMPLEMENTATION', 5),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('crash_during_transition');
      expect(result.recovered).toBe(true);
      expect(result.warnings.some((w) => w.includes('Incomplete transition'))).toBe(true);
      expect(result.discardedWork.some((d) => d.includes('PLANNING'))).toBe(true);
    });
  });

  describe('provider_timeout', () => {
    it('detects provider timeout via worker failure with timeout error', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeTransitionEvent('INTAKE', 'IMPLEMENTATION', 2),
        makeWorkerDispatchedEvent('worker-1', 'IMPLEMENTATION', 3),
        makeWorkerFailedEvent('worker-1', 'IMPLEMENTATION', 'Provider timeout exceeded', 4),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('provider_timeout');
      expect(result.recovered).toBe(true);
      expect(result.warnings.some((w) => w.includes('timeout'))).toBe(true);
      expect(result.discardedWork.some((d) => d.includes('worker-1'))).toBe(true);
    });

    it('detects provider timeout via error event with PROVIDER_TIMEOUT code', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeErrorEvent('PROVIDER_TIMEOUT', 'Request timed out', 2),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('provider_timeout');
      expect(result.recovered).toBe(true);
    });
  });

  describe('invalid_structured_output', () => {
    it('detects structured output validation failure', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeWorkerDispatchedEvent('worker-1', 'IMPLEMENTATION', 2),
        makeWorkerFailedEvent(
          'worker-1',
          'IMPLEMENTATION',
          'structured_output validation_failed',
          3,
        ),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('invalid_structured_output');
      expect(result.recovered).toBe(true);
      expect(result.warnings.some((w) => w.includes('Structured output'))).toBe(true);
      expect(result.discardedWork).toContain('Invalid structured output from failed worker');
    });

    it('detects structured output failure via error event', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeErrorEvent('STRUCTURED_OUTPUT_INVALID', 'Output did not match schema', 2),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('invalid_structured_output');
      expect(result.recovered).toBe(true);
    });
  });

  describe('partial_artifact', () => {
    it('detects partial artifact via error event', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeErrorEvent('PARTIAL_ARTIFACT', 'Artifact write incomplete', 2),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('partial_artifact');
      expect(result.recovered).toBe(true);
      expect(result.warnings.some((w) => w.includes('Partial'))).toBe(true);
      expect(result.discardedWork).toContain('Artifacts from interrupted write may be incomplete');
    });
  });

  describe('interrupted_workflow', () => {
    it('detects interrupted workflow via stale lock with no specific failure pattern', () => {
      const backupState = makeState({ currentState: 'PLANNING' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 99999,
        pidRunning: false,
        hostname: '',
        unreadable: false,
      });

      // Minimal journal with no failure patterns — just stale lock
      const events: JournalEvent[] = [makeRunStartedEvent(1)];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('interrupted_workflow');
      expect(result.recovered).toBe(true);
      expect(result.warnings.some((w) => w.includes('interrupted'))).toBe(true);
    });
  });

  describe('concurrent_execution', () => {
    it('refuses to start when active lock with running PID exists', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 12345,
        pidRunning: true,
        hostname: '',
        unreadable: false,
      });

      const events: JournalEvent[] = [makeRunStartedEvent(1)];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('concurrent_execution');
      expect(result.recovered).toBe(false);
      expect(result.state).toBeNull();
      expect(result.warnings.some((w) => w.includes('Another instance'))).toBe(true);
    });

    it('treats foreign-host lock as concurrent execution (cannot verify PID remotely)', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 99999,
        pidRunning: false,
        hostname: 'remote-server-42',
        unreadable: false,
      });

      const events: JournalEvent[] = [makeRunStartedEvent(1)];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('concurrent_execution');
      expect(result.recovered).toBe(false);
    });

    it('treats unreadable lock as concurrent execution during scenario detection', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 0,
        pidRunning: false,
        hostname: '',
        unreadable: true,
      });

      const events: JournalEvent[] = [makeRunStartedEvent(1)];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('concurrent_execution');
      expect(result.recovered).toBe(false);
    });
  });

  describe('disk_full', () => {
    it('detects disk full via write errors in journal', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(null);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeErrorEvent('ENOSPC', 'No space left on device', 2),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('disk_full');
      expect(result.recovered).toBe(false);
      expect(result.warnings.some((w) => w.includes('Disk write errors'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('cleanup'))).toBe(true);
    });

    it('detects disk full via worker failure with ENOSPC error', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(null);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeWorkerDispatchedEvent('w-1', 'IMPL', 2),
        makeWorkerFailedEvent('w-1', 'IMPL', 'ENOSPC: write error', 3),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('disk_full');
      expect(result.recovered).toBe(false);
    });
  });

  describe('network_partition', () => {
    it('detects network partition via consecutive network errors', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeErrorEvent('NETWORK_ERROR', 'Connection refused', 2),
        makeErrorEvent('NETWORK_ERROR', 'Connection refused', 3),
        makeErrorEvent('NETWORK_ERROR', 'Connection refused', 4),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('network_partition');
      expect(result.recovered).toBe(true);
      expect(result.warnings.some((w) => w.includes('network errors'))).toBe(true);
      expect(result.discardedWork).toContain('In-flight requests at time of failure');
    });

    it('detects network partition via consecutive worker failures with network errors', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeWorkerDispatchedEvent('w-1', 'IMPL', 2),
        makeWorkerFailedEvent('w-1', 'IMPL', 'ECONNREFUSED', 3),
        makeWorkerDispatchedEvent('w-2', 'IMPL', 4),
        makeWorkerFailedEvent('w-2', 'IMPL', 'ECONNREFUSED', 5),
        makeWorkerDispatchedEvent('w-3', 'IMPL', 6),
        makeWorkerFailedEvent('w-3', 'IMPL', 'ECONNREFUSED', 7),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('network_partition');
      expect(result.recovered).toBe(true);
    });
  });

  describe('partial_artifact via error message', () => {
    it('detects partial artifact via message containing "partial artifact"', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeErrorEvent('WRITE_ERROR', 'Detected partial artifact in output directory', 2),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('partial_artifact');
      expect(result.recovered).toBe(true);
      expect(result.discardedWork).toContain('Artifacts from interrupted write may be incomplete');
    });
  });

  describe('disk_full via worker error messages', () => {
    it('detects disk full via worker failure with "disk full" error', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(null);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeWorkerDispatchedEvent('w-1', 'IMPL', 2),
        makeWorkerFailedEvent('w-1', 'IMPL', 'disk full: no space remaining', 3),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('disk_full');
      expect(result.recovered).toBe(false);
    });

    it('detects disk full via DISK_FULL error event code', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(null);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeErrorEvent('DISK_FULL', 'Cannot write state file', 2),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('disk_full');
    });
  });

  describe('network_partition via ETIMEDOUT', () => {
    it('detects network partition via consecutive ETIMEDOUT worker failures', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeWorkerDispatchedEvent('w-1', 'IMPL', 2),
        makeWorkerFailedEvent('w-1', 'IMPL', 'ETIMEDOUT', 3),
        makeWorkerDispatchedEvent('w-2', 'IMPL', 4),
        makeWorkerFailedEvent('w-2', 'IMPL', 'ETIMEDOUT', 5),
        makeWorkerDispatchedEvent('w-3', 'IMPL', 6),
        makeWorkerFailedEvent('w-3', 'IMPL', 'ETIMEDOUT', 7),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('network_partition');
      expect(result.recovered).toBe(true);
      expect(result.discardedWork).toContain('In-flight requests at time of failure');
    });
  });

  describe('probeLock (non-destructive detection)', () => {
    it('uses probeLock instead of acquireLock for lock detection', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const events: JournalEvent[] = [makeRunStartedEvent(1)];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      manager.detectAndRecover(createRunId('run-1'));

      /* eslint-disable @typescript-eslint/unbound-method */
      expect(sp.probeLock).toHaveBeenCalledWith(createRunId('run-1'));
      expect(sp.acquireLock).not.toHaveBeenCalled();
      expect(sp.releaseLock).not.toHaveBeenCalled();
      /* eslint-enable @typescript-eslint/unbound-method */
    });

    it('returns correct PID from probe when lock is held', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 42,
        pidRunning: true,
        hostname: '',
        unreadable: false,
      });

      const events: JournalEvent[] = [makeRunStartedEvent(1)];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('concurrent_execution');
      expect(result.recovered).toBe(false);
    });

    it('returns no lock without side effects', () => {
      const state = makeState();
      const sp = makeMockPersistence(state);
      const reader = makeMockReader();
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('clean_load');
      /* eslint-disable @typescript-eslint/unbound-method */
      expect(sp.acquireLock).not.toHaveBeenCalled();
      expect(sp.releaseLock).not.toHaveBeenCalled();
      /* eslint-enable @typescript-eslint/unbound-method */
    });
  });

  describe('state_corruption as fallback', () => {
    it('defaults to state_corruption when primary fails with no other evidence', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(null);
      // No lock held
      const events: JournalEvent[] = [makeRunStartedEvent(1)];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('state_corruption');
    });
  });

  describe('provider_timeout with TIMEOUT in error', () => {
    it('detects provider timeout via worker failure with uppercase TIMEOUT', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeWorkerDispatchedEvent('worker-1', 'IMPLEMENTATION', 2),
        makeWorkerFailedEvent('worker-1', 'IMPLEMENTATION', 'REQUEST_TIMEOUT exceeded', 3),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('provider_timeout');
      expect(result.recovered).toBe(true);
    });
  });

  describe('scenario priority', () => {
    it('prioritizes disk_full over network_partition', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(null);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeErrorEvent('ENOSPC', 'Disk full', 2),
        makeErrorEvent('NETWORK_ERROR', 'Connection refused', 3),
        makeErrorEvent('NETWORK_ERROR', 'Connection refused', 4),
        makeErrorEvent('NETWORK_ERROR', 'Connection refused', 5),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('disk_full');
    });

    it('prioritizes concurrent_execution over other scenarios', () => {
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (sp.probeLock as ReturnType<typeof vi.fn>).mockReturnValue({
        exists: true,
        pid: 12345,
        pidRunning: true,
        hostname: '',
        unreadable: false,
      });

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeErrorEvent('PROVIDER_TIMEOUT', 'Timed out', 2),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('concurrent_execution');
      expect(result.recovered).toBe(false);
    });

    it('prioritizes network_partition over provider_timeout', () => {
      const backupState = makeState({ currentState: 'IMPLEMENTATION' });
      const sp = makeMockPersistence(null);
      (sp.load as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('corrupt');
        })
        .mockReturnValueOnce(backupState);

      const events: JournalEvent[] = [
        makeRunStartedEvent(1),
        makeErrorEvent('PROVIDER_TIMEOUT', 'Timed out', 2),
        makeErrorEvent('NETWORK_ERROR', 'Connection refused', 3),
        makeErrorEvent('NETWORK_ERROR', 'Connection refused', 4),
        makeErrorEvent('NETWORK_ERROR', 'Connection refused', 5),
      ];
      const reader = makeMockReader(events);
      const manager = new RecoveryManager(sp, reader, rebuildStateFromEvents);

      const result = manager.detectAndRecover(createRunId('run-1'));
      expect(result.scenario).toBe('network_partition');
    });
  });
});
