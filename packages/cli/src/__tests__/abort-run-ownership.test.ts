import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { abortRunState } from '../abort-run';

const roots: string[] = [];
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'abort-owner-'));
  roots.push(root);
  const id = createRunId('run');
  const persistence = new DefaultStatePersistence(root);
  const state: PersistedState = {
    runId: id,
    schemaVersion: 1,
    currentState: 'WAITING_FOR_HUMAN',
    previousState: 'WORK',
    stateEnteredAt: '',
    transitionCount: 1,
    stateHistory: ['WORK', 'WAITING_FOR_HUMAN'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'test',
    workflowVersion: '1',
    persistedAt: '',
    persistenceVersion: 1,
    checksum: '',
    cumulativeInputTokens: 10,
    cumulativeOutputTokens: 5,
    waitingContext: {
      reason: 'approval',
      requiredInput: 'approval',
      requestingState: 'WORK',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: '',
      liveSessionId: 'old-session',
    },
  };
  await persistence.save(state);
  return { root, id, persistence, state };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});
describe('abort ownership and current state validation', () => {
  it.each([true, false])(
    'rejects stale session identity under the lock (replacement exists: %s)',
    async (replacement) => {
      const h = await setup();
      assert(h.state.waitingContext);
      await h.persistence.save({
        ...h.state,
        waitingContext: replacement
          ? { ...h.state.waitingContext, liveSessionId: 'new-session' }
          : undefined,
      });
      const before = readFileSync(join(h.root, h.id, 'state.yaml'), 'utf8');
      const cancel = vi.fn(() => Promise.resolve());
      await expect(
        abortRunState(h.persistence, h.root, h.id, h.state, 'abort', {
          expectedSessionId: 'old-session',
          onOwned: cancel,
        }),
      ).rejects.toThrow('Session ID mismatch');
      expect(cancel).not.toHaveBeenCalled();
      expect(readFileSync(join(h.root, h.id, 'state.yaml'), 'utf8')).toBe(before);
      expect(h.persistence.probeLock(h.id).exists).toBe(false);
    },
  );
  it('does not undo a success committed after the abort request read its initial state', async () => {
    const h = await setup();
    await h.persistence.save({
      ...h.state,
      currentState: 'DONE',
      waitingContext: undefined,
      cumulativeInputTokens: 110,
    });
    const cancel = vi.fn(() => Promise.resolve());
    await abortRunState(h.persistence, h.root, h.id, h.state, 'abort', { onOwned: cancel });
    expect(cancel).not.toHaveBeenCalled();
    expect(h.persistence.load(h.id)).toMatchObject({
      currentState: 'DONE',
      cumulativeInputTokens: 110,
    });
    expect(h.persistence.probeLock(h.id).exists).toBe(false);
  });
  it('cancels only after acquiring ownership and commits the latest usage', async () => {
    const h = await setup();
    await h.persistence.save({ ...h.state, cumulativeInputTokens: 110 });
    const cancel = vi.fn((latest: PersistedState) => {
      expect(h.persistence.probeLock(h.id).pidRunning).toBe(true);
      expect(latest.cumulativeInputTokens).toBe(110);
      return Promise.resolve();
    });
    await abortRunState(h.persistence, h.root, h.id, h.state, 'abort', {
      expectedSessionId: 'old-session',
      onOwned: cancel,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.persistence.load(h.id)).toMatchObject({
      currentState: 'ABORTED',
      cumulativeInputTokens: 110,
      cumulativeOutputTokens: 5,
    });
    expect(h.persistence.probeLock(h.id).exists).toBe(false);
  });
  it('releases ownership and preserves state if an owned callback fails', async () => {
    const h = await setup();
    await expect(
      abortRunState(h.persistence, h.root, h.id, h.state, 'abort', {
        onOwned: () => Promise.reject(new Error('cancel failed')),
      }),
    ).rejects.toThrow('cancel failed');
    expect(h.persistence.load(h.id)?.currentState).toBe('WAITING_FOR_HUMAN');
    expect(h.persistence.probeLock(h.id).exists).toBe(false);
  });
});
