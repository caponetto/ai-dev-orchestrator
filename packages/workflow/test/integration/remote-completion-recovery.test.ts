import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultJournalReader } from '@ai-dev-orchestrator/journal';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import {
  COMPLETION_RUN_ID,
  createRemoteCompletionHarness,
} from '../fixtures/remote-completion-harness';

const directories: string[] = [];
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'remote-completion-'));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('remote completion recovery with real persistence', () => {
  it.each(['', '{}'])(
    'does not report success for missing or invalid required output (%j)',
    async (content) => {
      const h = await createRemoteCompletionHarness(await directory());
      await h.controller.start(h.config);
      await h.complete(content);
      expect(
        (await h.controller.resume({ type: 'approval', content: 'continue' })).finalState,
      ).toBe('FAILED');
      expect(h.persistence.load(COMPLETION_RUN_ID)).toMatchObject({
        currentState: 'FAILED',
        cumulativeInputTokens: 30,
        cumulativeOutputTokens: 20,
      });
      expect(await h.artifacts.list({})).toEqual([]);
      expect(h.dispatches()).toBe(1);
    },
  );

  it('keeps completed output and writes the normal report when a custom report path is blocked', async () => {
    const root = await directory();
    const h = await createRemoteCompletionHarness(root);
    const blocked = join(root, 'blocked');
    await writeFile(blocked, 'not a directory');
    h.config.reportOutputPath = join(blocked, 'report.md');
    await h.controller.start(h.config);
    await h.complete();
    expect((await h.controller.resume({ type: 'approval', content: 'continue' })).finalState).toBe(
      'DONE',
    );
    expect(await readFile(join(root, COMPLETION_RUN_ID, 'report.md'), 'utf8')).toContain(
      COMPLETION_RUN_ID,
    );
    expect(h.persistence.load(COMPLETION_RUN_ID)?.cumulativeInputTokens).toBe(30);
    expect(h.dispatches()).toBe(1);
  });
  it.each(['before-artifact', 'after-artifact', 'after-worker-journal'] as const)(
    'recovers %s with the same artifacts and usage as uninterrupted execution',
    async (window) => {
      const baseline = await createRemoteCompletionHarness(await directory());
      await baseline.controller.start(baseline.config);
      await baseline.complete();
      expect(
        (await baseline.controller.resume({ type: 'approval', content: 'continue' })).finalState,
      ).toBe('DONE');
      const expected = await baseline.artifacts.list({});

      const root = await directory();
      const interrupted = await createRemoteCompletionHarness(root);
      expect((await interrupted.controller.start(interrupted.config)).finalState).toBe(
        'WAITING_FOR_HUMAN',
      );
      await interrupted.complete();
      await interrupted.supervisor.finalize(interrupted.ref.sessionId);
      if (window !== 'before-artifact') {
        let stopped = false;
        const append = interrupted.journal.append.bind(interrupted.journal);
        vi.spyOn(interrupted.journal, 'append').mockImplementation((event) => {
          if (stopped) {
            throw new Error('injected process termination');
          }
          if (event.type === 'worker_completed') {
            if (window === 'after-worker-journal') {
              append(event);
            }
            stopped = true;
            throw new Error('injected process termination');
          }
          append(event);
        });
        await expect(
          interrupted.controller.resume({ type: 'approval', content: 'continue' }),
        ).rejects.toThrow('process termination');
      }
      // Recreate every component; only the files can supply completion/output/cursors.
      const restored = await createRemoteCompletionHarness(root);
      const events = new DefaultJournalReader(restored.journalPath).readAll();
      const state = restored.persistence.reconstructFromJournal(COMPLETION_RUN_ID, events);
      assert(state);
      restored.controller.restore(restored.config, state);
      const result = state.waitingContext
        ? await restored.controller.resume({ type: 'approval', content: 'continue' })
        : await restored.controller.retry();
      expect(result.finalState).toBe('DONE');
      expect(await restored.artifacts.list({})).toEqual(expected);
      expect(restored.persistence.load(COMPLETION_RUN_ID)).toMatchObject({
        currentState: 'DONE',
        cumulativeInputTokens: 30,
        cumulativeOutputTokens: 20,
        workerMetricsByRole: { planner: { inputTokens: 30, outputTokens: 20, dispatches: 2 } },
      });
      for (const ref of expected) {
        expect((await restored.artifacts.verify(ref)).valid).toBe(true);
      }
      expect(restored.dispatches()).toBe(1);
      expect(restored.sent).toEqual([]);
      expect(restored.persistence.probeLock(COMPLETION_RUN_ID).exists).toBe(false);
    },
  );

  it('retains DONE and exact usage when final manifest writing fails', async () => {
    const h = await createRemoteCompletionHarness(await directory());
    await h.controller.start(h.config);
    await h.complete();
    const write = h.manifestWriter.write.bind(h.manifestWriter);
    vi.spyOn(h.manifestWriter, 'write').mockImplementation((id, manifest) => {
      if (manifest.status === 'completed') {
        throw new Error('final manifest unavailable');
      }
      write(id, manifest);
    });
    await expect(h.controller.resume({ type: 'approval', content: 'continue' })).rejects.toThrow(
      'final manifest unavailable',
    );
    expect(h.persistence.load(COMPLETION_RUN_ID)).toMatchObject({
      currentState: 'DONE',
      cumulativeInputTokens: 30,
      cumulativeOutputTokens: 20,
    });
    const replay = h.persistence.reconstructFromJournal(
      COMPLETION_RUN_ID,
      new DefaultJournalReader(h.journalPath).readAll(),
    );
    expect(replay?.currentState).toBe('DONE');
    expect(await h.artifacts.list({})).toHaveLength(1);
    expect(h.dispatches()).toBe(1);
    expect(h.persistence.probeLock(COMPLETION_RUN_ID).exists).toBe(false);
  });
});
