import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultJournalReader, DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { abortRunState, writeAbortJournalEntries } from '../abort-run';

describe('abort journal ordering', () => {
  it('appends after a sparse existing sequence so replay cannot overwrite an abort with an older checkpoint', () => {
    const root = mkdtempSync(join(tmpdir(), 'abort-replay-'));
    try {
      const runId = createRunId('abort-replay');
      const state: PersistedState = {
        runId,
        schemaVersion: 2,
        currentState: 'WORK',
        previousState: null,
        stateEnteredAt: '2026-10-23T00:00:00Z',
        transitionCount: 1,
        stateHistory: ['WORK'],
        iterationCounts: {},
        activeArtifacts: [],
        lastProducedArtifact: null,
        workflowName: 'test',
        workflowVersion: '1',
        persistedAt: '2026-10-23T00:00:00Z',
        persistenceVersion: 1,
        checksum: '',
        cumulativeInputTokens: 30,
        cumulativeOutputTokens: 20,
      };
      const path = join(root, runId, 'journal.md');
      new DefaultJournalWriter(path, runId, 90).append({
        timestamp: state.persistedAt,
        runId,
        sequence: 0,
        type: 'workflow_checkpoint',
        data: { kind: 'workflow_checkpoint', state },
      });

      writeAbortJournalEntries(root, runId, state, 'Stop the run');

      const events = new DefaultJournalReader(path).readAll();
      expect(events.map((event) => event.sequence)).toEqual([91, 92, 93]);
      expect(new DefaultStatePersistence(root).reconstructFromJournal(runId, events)).toMatchObject(
        { currentState: 'ABORTED', cumulativeInputTokens: 30, cumulativeOutputTokens: 20 },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite a live owner and releases its own lock after aborting fresh progress', async () => {
    const root = mkdtempSync(join(tmpdir(), 'abort-owner-'));
    vi.useFakeTimers();
    try {
      const runId = createRunId('abort-owner');
      const persistence = new DefaultStatePersistence(root);
      // Reuse a real checkpoint shape without depending on workflow configuration.
      const state: PersistedState = {
        runId,
        schemaVersion: 2,
        currentState: 'WORK',
        previousState: null,
        stateEnteredAt: new Date().toISOString(),
        transitionCount: 1,
        stateHistory: ['WORK'],
        iterationCounts: {},
        activeArtifacts: [],
        lastProducedArtifact: null,
        workflowName: 'test',
        workflowVersion: '1',
        persistedAt: new Date().toISOString(),
        persistenceVersion: 1,
        checksum: '',
        cumulativeInputTokens: 30,
      };
      await persistence.save(state);
      const owner = persistence.acquireLock(runId);
      const pending = abortRunState(persistence, root, runId, state, 'test');
      const rejection = expect(pending).rejects.toThrow('already active');
      await vi.advanceTimersByTimeAsync(2000);
      await rejection;
      expect(persistence.load(runId)?.currentState).toBe('WORK');
      expect(persistence.probeLock(runId).pidRunning).toBe(true);

      await persistence.save({ ...state, currentState: 'NEW_WORK', cumulativeInputTokens: 70 });
      persistence.releaseLock(owner);
      await abortRunState(persistence, root, runId, state, 'test');
      expect(persistence.load(runId)).toMatchObject({
        currentState: 'ABORTED',
        previousState: 'NEW_WORK',
        cumulativeInputTokens: 70,
      });
      expect(persistence.probeLock(runId).exists).toBe(false);
    } finally {
      vi.useRealTimers();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
