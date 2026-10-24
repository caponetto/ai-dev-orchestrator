import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResumeStatePersistence } from '../resume-state-persistence';

const roots: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'resume-owner-'));
  roots.push(root);
  const id = createRunId('run');
  mkdirSync(join(root, id));
  return { root, id, current: new DefaultStatePersistence(root) };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});
describe('resume state ownership', () => {
  it.each(['state.yaml', 'journal.md'])(
    'rejects a stale context when %s changes before lock acquisition',
    (file) => {
      const h = setup();
      const stale = new ResumeStatePersistence(h.root, h.id);
      writeFileSync(join(h.root, h.id, file), 'new owner progress');
      expect(() => stale.acquireLock(h.id)).toThrow('changed');
      expect(h.current.probeLock(h.id).exists).toBe(false);
      expect(readFileSync(join(h.root, h.id, file), 'utf8')).toBe('new owner progress');
    },
  );
  it('refuses active contention without disturbing the winner', () => {
    const h = setup();
    const stale = new ResumeStatePersistence(h.root, h.id);
    const lock = h.current.acquireLock(h.id);
    const original = readFileSync(lock.lockPath, 'utf8');
    expect(() => stale.acquireLock(h.id)).toThrow();
    expect(readFileSync(lock.lockPath, 'utf8')).toBe(original);
    h.current.releaseLock(lock);
  });
  it('records its own progress before release and permits the same context to continue', () => {
    const h = setup();
    const resumed = new ResumeStatePersistence(h.root, h.id);
    const lock = resumed.acquireLock(h.id);
    writeFileSync(join(h.root, h.id, 'journal.md'), 'own progress');
    resumed.releaseLock(lock);
    const next = resumed.acquireLock(h.id);
    resumed.releaseLock(next);
    expect(h.current.probeLock(h.id).exists).toBe(false);
  });
  it('does not refresh an idle context when given an unrelated release handle', () => {
    const h = setup();
    const resumed = new ResumeStatePersistence(h.root, h.id);
    const winner = h.current.acquireLock(h.id);
    writeFileSync(join(h.root, h.id, 'journal.md'), 'winner progress');
    resumed.releaseLock(winner);
    expect(readFileSync(winner.lockPath, 'utf8')).toContain(winner.ownershipToken);
    h.current.releaseLock(winner);
    expect(() => resumed.acquireLock(h.id)).toThrow('changed');
  });
});

it('rejects a different run without acquiring or removing its lock', () => {
  const h = setup();
  const resumed = new ResumeStatePersistence(h.root, h.id);
  expect(() => resumed.acquireLock(createRunId('other'))).toThrow('another run');
  expect(h.current.probeLock(createRunId('other')).exists).toBe(false);
});
it('releases a newly acquired lock when revision inspection fails', () => {
  const h = setup();
  const resumed = new ResumeStatePersistence(h.root, h.id);
  mkdirSync(join(h.root, h.id, 'journal.md'));
  expect(() => resumed.acquireLock(h.id)).toThrow();
  expect(h.current.probeLock(h.id).exists).toBe(false);
});
it('retains ownership if recording its progress fails, allowing an explicit release retry', () => {
  const h = setup();
  const resumed = new ResumeStatePersistence(h.root, h.id);
  const lock = resumed.acquireLock(h.id);
  mkdirSync(join(h.root, h.id, 'journal.md'));
  expect(() => {
    resumed.releaseLock(lock);
  }).toThrow();
  expect(h.current.probeLock(h.id).exists).toBe(true);
  rmSync(join(h.root, h.id, 'journal.md'), { recursive: true });
  resumed.releaseLock(lock);
  expect(h.current.probeLock(h.id).exists).toBe(false);
});

it('journals only while this context owns the run, including late error callbacks', () => {
  const h = setup();
  const resumed = new ResumeStatePersistence(h.root, h.id);
  const append = vi.fn();
  const appendBatch = vi.fn();
  const writer = resumed.guardJournal({ append, appendBatch });
  const event = {
    runId: h.id,
    sequence: 0,
    timestamp: '',
    type: 'error' as const,
    data: {
      kind: 'error' as const,
      errorCode: 'late',
      message: 'late callback',
      recoverable: false,
    },
  };
  writer.append(event);
  writer.appendBatch([event]);
  expect(append).not.toHaveBeenCalled();
  expect(appendBatch).not.toHaveBeenCalled();
  const lock = resumed.acquireLock(h.id);
  writer.append(event);
  writer.appendBatch([event]);
  resumed.releaseLock(lock);
  writer.append(event);
  writer.appendBatch([event]);
  expect(append).toHaveBeenCalledExactlyOnceWith(event);
  expect(appendBatch).toHaveBeenCalledExactlyOnceWith([event]);
});

it('rejects checkpoint writes outside ownership and only saves the bound run', async () => {
  const h = setup();
  const resumed = new ResumeStatePersistence(h.root, h.id);
  const state: PersistedState = {
    runId: h.id,
    schemaVersion: 1,
    currentState: 'WORK',
    previousState: null,
    stateEnteredAt: '',
    transitionCount: 0,
    stateHistory: ['WORK'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'test',
    workflowVersion: '1',
    persistedAt: '',
    persistenceVersion: 1,
    checksum: '',
  };
  await expect(resumed.save(state)).rejects.toThrow('without owning');
  expect(h.current.load(h.id)).toBeNull();
  const lock = resumed.acquireLock(h.id);
  await expect(resumed.save({ ...state, runId: createRunId('other') })).rejects.toThrow(
    'without owning',
  );
  await resumed.save(state);
  resumed.releaseLock(lock);
  await expect(resumed.save({ ...state, currentState: 'ABORTED' })).rejects.toThrow(
    'without owning',
  );
  expect(h.current.load(h.id)?.currentState).toBe('WORK');
});
