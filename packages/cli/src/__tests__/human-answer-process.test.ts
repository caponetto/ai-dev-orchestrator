import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultJournalReader, DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import { afterEach, assert, describe, expect, it } from 'vitest';

const fixture = fileURLToPath(
  new URL('../../test/fixtures/human-answer-process.mjs', import.meta.url),
);
const roots: string[] = [];
const children: ChildProcess[] = [];
const exits: Promise<unknown>[] = [];
const id = createRunId('answer');
function child(root: string, mode: string, content = 'accepted') {
  const process = fork(fixture, [root, mode, content], {
    execArgv: ['--import', import.meta.resolve('tsx')],
    silent: true,
  });
  children.push(process);
  const bus = new EventEmitter();
  let ready = false;
  let output = '';
  let errors = '';
  process.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  process.stderr?.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  process.on('message', (message: { type: string }) => {
    if (message.type === 'ready') {
      ready = true;
    }
    bus.emit('update');
  });
  const exit = new Promise<number | null>((resolve) => {
    process.once('exit', (code) => {
      resolve(code);
      bus.emit('update');
    });
  });
  exits.push(exit);
  return {
    process,
    exit,
    output: () => output,
    errors: () => errors,
    ready: () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          bus.off('update', check);
          reject(new Error(`Barrier timed out: ${errors}`));
        }, 20_000);
        const check = () => {
          if (ready) {
            clearTimeout(timer);
            bus.off('update', check);
            resolve();
          } else if (process.exitCode !== null || process.signalCode !== null) {
            clearTimeout(timer);
            bus.off('update', check);
            reject(new Error(`Child exited early: ${errors}`));
          }
        };
        bus.on('update', check);
        check();
      }),
    release: () => {
      writeFileSync(join(root, `release-${String(process.pid)}`), 'go');
    },
  };
}
async function seed() {
  const root = mkdtempSync(join(tmpdir(), 'human-answer-process-'));
  roots.push(root);
  const runDir = join(root, '.ai', 'runs', id);
  mkdirSync(join(runDir, 'artifacts'), { recursive: true });
  const transition = (target: string, trigger: string) => ({
    target,
    trigger,
    guards: [],
    priority: 0,
    governanceRequired: false,
  });
  writeFileSync(
    join(runDir, 'workflow-definition.json'),
    JSON.stringify({
      name: 'answer',
      version: '1',
      initialState: 'WORK',
      terminalStates: ['DONE'],
      states: {
        WORK: { type: 'action', description: '', transitions: [transition('DONE', 'completion')] },
        WAITING_FOR_HUMAN: {
          type: 'wait',
          description: '',
          transitions: [transition('WORK', 'human_input')],
        },
        DONE: { type: 'terminal', description: '', transitions: [] },
      },
    }),
  );
  writeFileSync(join(runDir, 'sources.json'), '[]');
  const timestamp = new Date().toISOString();
  const state: PersistedState = {
    runId: id,
    schemaVersion: 2,
    currentState: 'WAITING_FOR_HUMAN',
    previousState: 'WORK',
    repoRoot: root,
    stateEnteredAt: timestamp,
    transitionCount: 1,
    stateHistory: ['WORK', 'WAITING_FOR_HUMAN'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'answer',
    workflowVersion: '1',
    persistedAt: timestamp,
    persistenceVersion: 1,
    checksum: '',
    waitingContext: {
      reason: 'clarification_needed',
      requiredInput: 'text',
      requestingState: 'WORK',
      waitingSince: 'wait-1',
      autoResumeSafe: false,
      presentedArtifacts: [],
    },
    lastHumanAnswer: {
      stateId: 'WAITING_FOR_HUMAN',
      requestingState: 'WORK',
      waitingSince: 'previous-wait',
      content: 'previous',
    },
  };
  const persistence = new DefaultStatePersistence(join(root, '.ai', 'runs'));
  await persistence.save(state);
  const saved = persistence.load(id);
  assert(saved);
  new DefaultJournalWriter(join(runDir, 'journal.md'), id).append({
    timestamp,
    runId: id,
    sequence: 0,
    type: 'workflow_checkpoint',
    data: { kind: 'workflow_checkpoint', state: saved },
  });
  const path = join(runDir, 'artifacts', 'clarification_answers_v1.md');
  writeFileSync(path, 'previous');
  return { root, runDir, path, state, persistence };
}
function snapshot(runDir: string) {
  return Object.fromEntries(
    ['state.yaml', 'journal.md', 'artifacts/clarification_answers_v1.md'].map((name) => [
      name,
      existsSync(join(runDir, name)) ? readFileSync(join(runDir, name), 'utf8') : null,
    ]),
  );
}
afterEach(async () => {
  for (const process of children.splice(0)) {
    if (process.exitCode === null && process.signalCode === null) {
      process.kill('SIGKILL');
    }
  }
  await Promise.all(exits.splice(0));
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});
describe('human answer persistence across real processes', () => {
  it('keeps an unanswered text wait intact after a crash during transition evaluation', async () => {
    const f = await seed();
    const before = snapshot(f.runDir);
    const crashed = child(f.root, 'crash-evaluation');
    expect(await crashed.exit, crashed.errors()).toBe(77);
    expect(snapshot(f.runDir)).toEqual(before);
    const retried = child(f.root, 'answer');
    expect(await retried.exit, retried.errors()).toBe(0);
    expect(readFileSync(f.path, 'utf8')).toBe('accepted');
    expect(f.persistence.load(id)).toMatchObject({
      currentState: 'DONE',
      lastHumanAnswer: { content: 'accepted' },
    });
  }, 30_000);
  it('recovers a durable accepted answer after a projection I/O error without reporting success prematurely', async () => {
    const f = await seed();
    const failed = child(f.root, 'projection-error');
    expect(await failed.exit).toBe(3);
    expect(failed.output()).not.toContain('answers_received');
    expect(f.persistence.load(id)?.lastHumanAnswer?.content).toBe('accepted');
    expect(readFileSync(f.path, 'utf8')).toBe('previous');
    expect(f.persistence.probeLock(id).exists).toBe(false);
    const recovered = child(f.root, 'resume');
    expect(await recovered.exit, recovered.errors()).toBe(0);
    expect(readFileSync(f.path, 'utf8')).toBe('accepted');
  }, 30_000);
  it('allows one answer owner and leaves the losing process unable to replace its file or durable state', async () => {
    const f = await seed();
    const winner = child(f.root, 'race', 'winner');
    const loser = child(f.root, 'race', 'loser');
    await Promise.all([winner.ready(), loser.ready()]);
    winner.release();
    expect(await winner.exit, winner.errors()).toBe(0);
    const committed = snapshot(f.runDir);
    loser.release();
    expect(await loser.exit).toBe(3);
    expect(snapshot(f.runDir)).toEqual(committed);
    expect(readFileSync(f.path, 'utf8')).toBe('winner');
    expect(f.persistence.probeLock(id).exists).toBe(false);
  }, 30_000);
  it('does not alter artifacts, state, journal or the owner lock when lock acquisition fails', async () => {
    const f = await seed();
    const p = child(f.root, 'contention');
    await p.ready();
    const lock = f.persistence.acquireLock(id);
    const bytes = readFileSync(lock.lockPath, 'utf8');
    const before = snapshot(f.runDir);
    p.release();
    expect(await p.exit).toBe(3);
    expect(snapshot(f.runDir)).toEqual(before);
    expect(readFileSync(lock.lockPath, 'utf8')).toBe(bytes);
    f.persistence.releaseLock(lock);
  }, 30_000);
  it('rejects a wait that changes between the initial read and bootstrap without replacing the old answer', async () => {
    const f = await seed();
    const p = child(f.root, 'bootstrap-race');
    await p.ready();
    const waitingContext = f.state.waitingContext;
    assert(waitingContext);
    await f.persistence.save({
      ...f.state,
      waitingContext: { ...waitingContext, waitingSince: 'wait-2' },
    });
    const before = snapshot(f.runDir);
    p.release();
    expect(await p.exit, p.errors()).toBe(3);
    expect(snapshot(f.runDir)).toEqual(before);
  }, 30_000);
  it.each([
    ['crash-journal', 73],
    ['crash-state', 74],
    ['crash-projection', 75],
    ['crash-temporary', 76],
  ] as const)(
    'recovers accepted answer and projection after %s without another answer',
    async (mode, code) => {
      const f = await seed();
      const crashed = child(f.root, mode);
      expect(await crashed.exit, crashed.errors()).toBe(code);
      expect(readFileSync(f.path, 'utf8')).toBe(
        mode === 'crash-projection' ? 'accepted' : 'previous',
      );
      const events = new DefaultJournalReader(join(f.runDir, 'journal.md')).readAll();
      expect(
        events.some(
          (event) =>
            event.type === 'workflow_checkpoint' &&
            event.data.state.lastHumanAnswer?.content === 'accepted',
        ),
      ).toBe(true);
      const recovered = child(f.root, 'resume');
      expect(await recovered.exit, recovered.errors()).toBe(0);
      expect(f.persistence.load(id)).toMatchObject({
        currentState: 'DONE',
        lastHumanAnswer: { content: 'accepted', waitingSince: 'wait-1' },
      });
      expect(readFileSync(f.path, 'utf8')).toBe('accepted');
      expect(f.persistence.probeLock(id).exists).toBe(false);
      expect(readdirSync(join(f.runDir, 'artifacts'))).toEqual(['clarification_answers_v1.md']);
    },
    30_000,
  );
});
