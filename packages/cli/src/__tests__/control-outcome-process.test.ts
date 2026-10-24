import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import { afterEach, describe, expect, it } from 'vitest';

const fixture = fileURLToPath(
  new URL('../../test/fixtures/control-outcome-process.mjs', import.meta.url),
);
const roots: string[] = [];
const children: ChildProcess[] = [];
const exits: Promise<unknown>[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  await Promise.all(exits.splice(0));
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});
describe('observed abort outcomes across processes', () => {
  it.each(['DONE', 'ABORTED', 'apply'])(
    'reports the outcome observed under ownership (%s)',
    async (outcome) => {
      const root = mkdtempSync(join(tmpdir(), 'control-outcome-'));
      roots.push(root);
      const id = createRunId('run');
      const store = new DefaultStatePersistence(join(root, '.ai', 'runs'));
      const state: PersistedState = {
        runId: id,
        schemaVersion: 1,
        currentState: 'WAITING_FOR_HUMAN',
        previousState: 'WORK',
        stateEnteredAt: new Date().toISOString(),
        transitionCount: 1,
        stateHistory: ['WORK', 'WAITING_FOR_HUMAN'],
        iterationCounts: {},
        activeArtifacts: [],
        lastProducedArtifact: null,
        workflowName: 'test',
        workflowVersion: '1',
        persistedAt: new Date().toISOString(),
        persistenceVersion: 1,
        checksum: '',
        cumulativeInputTokens: 110,
        cumulativeOutputTokens: 55,
      };
      await store.save(state);
      const child = fork(fixture, [root, id], {
        execArgv: ['--import', import.meta.resolve('tsx')],
        silent: true,
      });
      children.push(child);
      const exit = new Promise<number | null>((resolve) => child.once('exit', resolve));
      exits.push(exit);
      let errors = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        errors += chunk.toString();
      });
      const result = new Promise<{ code: number; output: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Child outcome timed out: ${errors}`));
        }, 25_000);
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('message', (message: { type: string; code: number; output: string }) => {
          if (message.type === 'before-acquire') {
            void (async () => {
              if (outcome !== 'apply') {
                const lock = store.acquireLock(id);
                try {
                  await store.save({ ...state, currentState: outcome });
                } finally {
                  store.releaseLock(lock);
                }
              }
              writeFileSync(join(root, 'continue'), 'go');
            })().catch((error: unknown) => {
              clearTimeout(timer);
              reject(error instanceof Error ? error : new Error(String(error)));
            });
          } else if (message.type === 'result') {
            clearTimeout(timer);
            resolve(message);
          }
        });
      });
      const observed = await result;
      expect(await exit).toBe(observed.code);
      const finalState = outcome === 'apply' ? 'ABORTED' : outcome;
      expect(observed.code).toBe(outcome === 'apply' ? 4 : 0);
      expect(JSON.parse(observed.output)).toMatchObject(
        outcome === 'apply'
          ? { status: 'aborted', finalState: 'ABORTED', previousState: 'WAITING_FOR_HUMAN' }
          : { status: 'already_terminal', state: outcome },
      );
      expect(store.load(id)).toMatchObject({
        currentState: finalState,
        cumulativeInputTokens: 110,
        cumulativeOutputTokens: 55,
      });
      const journal = join(root, '.ai', 'runs', id, 'journal.md');
      if (outcome === 'apply') {
        expect(readFileSync(journal, 'utf8')).toContain('run_aborted');
      } else {
        expect(existsSync(journal)).toBe(false);
      }
      expect(store.probeLock(id).exists).toBe(false);
    },
    60_000,
  );
});
