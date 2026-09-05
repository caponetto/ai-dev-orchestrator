import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  computeStateChecksum,
  DefaultStatePersistence,
  rebuildStateFromEvents,
  RunAlreadyActiveError,
} from '@ai-dev-orchestrator/core';
import type { JournalReader, JournalWriter } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtifactConsistencyChecker } from '../artifact-consistency-checker';
import { ShutdownCoordinator } from '../shutdown-coordinator';
import { StateReconstructor } from '../state-reconstructor';

function makeValidState(runId: string, currentState: string): PersistedState {
  const state: PersistedState = {
    runId: createRunId(runId),
    schemaVersion: 1,
    currentState,
    previousState: null,
    stateEnteredAt: new Date().toISOString(),
    transitionCount: 0,
    stateHistory: [currentState],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    persistedAt: new Date().toISOString(),
    persistenceVersion: 1,
    checksum: '',
  };
  return { ...state, checksum: computeStateChecksum(state) };
}

describe('Recovery Integration', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join(tmpdir(), `recovery-integration-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('Checkpoint save and recovery cycle', () => {
    it('saves state, corrupts it, and recovers from backup', async () => {
      const persistence = new DefaultStatePersistence(baseDir);
      const state = makeValidState('run-1', 'PLANNING');
      await persistence.save(state);

      const state2 = makeValidState('run-1', 'IMPLEMENTATION');
      await persistence.save(state2);

      const statePath = join(baseDir, 'run-1', 'state.yaml');
      writeFileSync(statePath, 'corrupted garbage', 'utf8');

      expect(() => persistence.load(createRunId('run-1'))).toThrow();
      expect(existsSync(`${statePath}.bak`)).toBe(true);
    });
  });

  describe('Journal reconstruction', () => {
    it('reconstructs state from events when checkpoint is gone', () => {
      const events = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-1',
          sequence: 1,
          type: 'run_started' as const,
          data: {
            kind: 'run_lifecycle' as const,
            workflowName: 'default',
            workflowVersion: '1.0.0',
          },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-1',
          sequence: 2,
          type: 'state_transition' as const,
          data: {
            kind: 'state_transition' as const,
            from: 'INTAKE',
            to: 'PLANNING',
            trigger: 'completion' as const,
            durationMs: 1000,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: false,
          },
        },
      ];

      const reader: JournalReader = {
        readAll: () => events,
        query: () => events,
        range: (start: string, end: string) =>
          events.filter((e) => e.timestamp >= start && e.timestamp <= end),
        tail: (n: number) => events.slice(-n),
      };

      const reconstructor = new StateReconstructor(reader, rebuildStateFromEvents);
      const state = reconstructor.reconstruct(createRunId('run-1'));

      expect(state).not.toBeNull();
      expect(state?.currentState).toBe('PLANNING');
      expect(state?.transitionCount).toBe(1);
    });
  });

  describe('Artifact consistency', () => {
    it('end-to-end: create orphans, verify, repair, verify again', () => {
      const artifactsDir = join(baseDir, 'artifacts');
      mkdirSync(artifactsDir, { recursive: true });

      writeFileSync(join(artifactsDir, 'spec.md'), 'content');
      writeFileSync(join(artifactsDir, 'spec.md.meta.yaml'), 'type: spec');
      writeFileSync(join(artifactsDir, 'orphan.md'), 'lost');
      writeFileSync(join(artifactsDir, 'ghost.md.meta.yaml'), 'type: ghost');

      const checker = new ArtifactConsistencyChecker();

      const report = checker.verify(artifactsDir);
      expect(report.consistent).toBe(false);
      expect(report.orphanContent).toContain('orphan.md');
      expect(report.orphanSidecars).toContain('ghost.md.meta.yaml');

      const repair = checker.repair(artifactsDir);
      expect(repair.deletedFiles).toHaveLength(2);

      const finalReport = checker.verify(artifactsDir);
      expect(finalReport.consistent).toBe(true);
    });
  });

  describe('Shutdown coordinator', () => {
    it('saves state and releases lock on shutdown', async () => {
      const persistence = new DefaultStatePersistence(baseDir);
      const journalWriter: JournalWriter = { append: vi.fn(), appendBatch: vi.fn() };
      const coordinator = new ShutdownCoordinator(persistence, journalWriter, 5000);

      const runDir = join(baseDir, 'run-1');
      mkdirSync(runDir, { recursive: true });
      const lock = persistence.acquireLock(createRunId('run-1'));

      await coordinator.initiateShutdown(createRunId('run-1'), lock, 'IMPLEMENTATION');

      expect(existsSync(lock.lockPath)).toBe(false);
      expect(existsSync(join(runDir, 'state.yaml'))).toBe(true);
    });
  });

  describe('Concurrent lock handling', () => {
    it('acquire → probe → release → probe cycle', () => {
      const persistence = new DefaultStatePersistence(baseDir);
      const runDir = join(baseDir, 'run-lock');
      mkdirSync(runDir, { recursive: true });

      const lock = persistence.acquireLock(createRunId('run-lock'));
      expect(existsSync(lock.lockPath)).toBe(true);

      const probeActive = persistence.probeLock(createRunId('run-lock'));
      expect(probeActive.exists).toBe(true);
      expect(probeActive.pid).toBe(process.pid);
      expect(probeActive.pidRunning).toBe(true);

      persistence.releaseLock(lock);
      expect(existsSync(lock.lockPath)).toBe(false);

      const probeReleased = persistence.probeLock(createRunId('run-lock'));
      expect(probeReleased.exists).toBe(false);
    });

    it('second acquireLock throws RunAlreadyActiveError while lock is held', () => {
      const persistence = new DefaultStatePersistence(baseDir);
      const runDir = join(baseDir, 'run-lock-active');
      mkdirSync(runDir, { recursive: true });

      const lock = persistence.acquireLock(createRunId('run-lock-active'));

      expect(() => persistence.acquireLock(createRunId('run-lock-active'))).toThrow(
        RunAlreadyActiveError,
      );

      persistence.releaseLock(lock);
    });

    it('acquireLock succeeds after prior lock is released', () => {
      const persistence = new DefaultStatePersistence(baseDir);
      const runDir = join(baseDir, 'run-lock-reacquire');
      mkdirSync(runDir, { recursive: true });

      const lock1 = persistence.acquireLock(createRunId('run-lock-reacquire'));
      persistence.releaseLock(lock1);

      const lock2 = persistence.acquireLock(createRunId('run-lock-reacquire'));
      expect(existsSync(lock2.lockPath)).toBe(true);

      persistence.releaseLock(lock2);
    });
  });

  describe('Shutdown with fresh run', () => {
    it('shutdown saves state even when no prior state exists', async () => {
      const persistence = new DefaultStatePersistence(baseDir);
      const journalWriter: JournalWriter = { append: vi.fn(), appendBatch: vi.fn() };
      const coordinator = new ShutdownCoordinator(persistence, journalWriter, 5000);

      const runDir = join(baseDir, 'run-fresh');
      mkdirSync(runDir, { recursive: true });
      const lock = persistence.acquireLock(createRunId('run-fresh'));

      await coordinator.initiateShutdown(createRunId('run-fresh'), lock, 'INTAKE');

      expect(existsSync(lock.lockPath)).toBe(false);
      expect(existsSync(join(runDir, 'state.yaml'))).toBe(true);
    });
  });
});
