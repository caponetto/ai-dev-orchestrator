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
import { DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { LockHandle } from '@ai-dev-orchestrator/schemas';
import { afterEach, describe, expect, it } from 'vitest';

const fixture = fileURLToPath(
  new URL('../../test/fixtures/ownership-process.mjs', import.meta.url),
);
const roots: string[] = [];
const children: ChildProcess[] = [];
const exits: Promise<unknown>[] = [];
const id = createRunId('ownership');
interface Message {
  type: string;
  success?: boolean;
  error?: string;
  handle?: LockHandle;
}
function rootDir() {
  const root = mkdtempSync(join(tmpdir(), 'run-ownership-'));
  roots.push(root);
  return root;
}
function child(mode: string, root: string) {
  const process = fork(fixture, [mode, root, id], {
    execArgv: ['--import', import.meta.resolve('tsx')],
    silent: true,
  });
  children.push(process);
  let errors = '';
  process.stderr?.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const bus = new EventEmitter();
  const messages: Message[] = [];
  process.on('message', (message: Message) => {
    messages.push(message);
    bus.emit('message');
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    process.on('exit', (code, signal) => {
      resolve({ code, signal });
      bus.emit('message');
    });
  });
  exits.push(exit);
  const next = (...types: string[]) =>
    new Promise<Message>((resolve, reject) => {
      const timeout = setTimeout(() => {
        bus.off('message', check);
        reject(new Error(`Timed out waiting for ${mode}: ${types.join(', ')} ${errors}`));
      }, 20_000);
      const check = () => {
        const index = messages.findIndex((message) => types.includes(message.type));
        if (index >= 0) {
          clearTimeout(timeout);
          bus.off('message', check);
          resolve(messages.splice(index, 1)[0]);
        } else if (process.exitCode !== null || process.signalCode !== null) {
          clearTimeout(timeout);
          bus.off('message', check);
          reject(new Error(`${mode} exited before ${types.join(', ')}: ${errors}`));
        }
      };
      bus.on('message', check);
      check();
    });
  return { process, next, exit, send: (command: string) => process.send(command) };
}
async function seed(root: string, failed = false) {
  const p = child(failed ? 'seed-failed' : 'seed-wait', root);
  await p.next('result');
  expect((await p.exit).code).toBe(0);
}
function businessFiles(root: string) {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === 'run.lock' ||
        entry.name === 'orchestrator.log' ||
        entry.name.includes('.reclaim-')
      ) {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else {
        files[path] = readFileSync(path).toString('base64');
      }
    }
  };
  walk(join(root, '.ai', 'runs', id));
  return files;
}
function persistence(root: string) {
  return new DefaultStatePersistence(join(root, '.ai', 'runs'));
}
function dispatchCount(root: string) {
  const path = join(root, 'dispatches.log');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').length : 0;
}
afterEach(async () => {
  for (const p of children.splice(0)) {
    if (p.exitCode === null && p.signalCode === null) {
      p.kill('SIGKILL');
    }
  }
  await Promise.all(exits.splice(0));
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('run ownership across synchronized processes', () => {
  it.each([
    ['resume', 'resume'],
    ['retry', 'retry'],
    ['resume', 'engine-abort'],
  ])(
    'allows one %s owner and rejects an active %s contender without business writes',
    async (mode, contender) => {
      const root = rootDir();
      await seed(root, mode === 'retry');
      const sessions = join(root, '.ai', 'runs', id, 'sessions');
      mkdirSync(sessions, { recursive: true });
      writeFileSync(
        join(sessions, 'orphan.json'),
        JSON.stringify({
          ref: {
            sessionId: 'orphan',
            runId: id,
            stateId: 'WORK',
            role: 'planner',
            transport: 'stdio',
          },
          state: 'running',
          reconnect: { type: 'stdio', pid: 999999 },
          pendingRequests: [],
          createdAt: '',
          updatedAt: '',
          lastProtocolTimestamp: '',
        }),
      );
      const initial = businessFiles(root);
      const winner = child(mode, root);
      const loser = child(contender, root);
      await Promise.all([winner.next('ready'), loser.next('ready')]);
      expect(businessFiles(root)).toEqual(initial);
      winner.send('go');
      await winner.next('dispatch');
      const before = businessFiles(root);
      const lock = readFileSync(join(root, '.ai', 'runs', id, 'run.lock'), 'utf8');
      loser.send('go');
      expect(await loser.next('result')).toMatchObject({ success: false });
      await loser.exit;
      expect(businessFiles(root)).toEqual(before);
      expect(readFileSync(join(root, '.ai', 'runs', id, 'run.lock'), 'utf8')).toBe(lock);
      winner.send('finish');
      const outcome = await winner.next('result');
      expect(outcome, JSON.stringify(outcome)).toMatchObject({ success: true, finalState: 'DONE' });
      await winner.exit;
      expect(dispatchCount(root)).toBe(1);
      expect(persistence(root).load(id)).toMatchObject({
        currentState: 'DONE',
        cumulativeInputTokens: 110,
        cumulativeOutputTokens: 55,
      });
      expect(persistence(root).probeLock(id).exists).toBe(false);
    },
    60_000,
  );

  it('rejects a preloaded journal cursor after journal-only progress by another owner', async () => {
    const root = rootDir();
    await seed(root);
    const idle = child('resume', root);
    await idle.next('ready');
    const store = persistence(root);
    const lock = store.acquireLock(id);
    const journal = new DefaultJournalWriter(join(root, '.ai', 'runs', id, 'journal.md'), id);
    journal.append({
      runId: id,
      sequence: 0,
      timestamp: new Date().toISOString(),
      type: 'error',
      data: {
        kind: 'error',
        errorCode: 'owner_progress',
        message: 'Durable journal-only progress',
        recoverable: true,
      },
    });
    store.releaseLock(lock);
    const before = businessFiles(root);
    idle.send('go');
    expect(await idle.next('result')).toMatchObject({
      success: false,
      error: expect.stringContaining('changed') as unknown,
    });
    await idle.exit;
    expect(businessFiles(root)).toEqual(before);
    expect(dispatchCount(root)).toBe(0);
  }, 60_000);

  it.each(['resume', 'engine-abort'])(
    'rejects an idle %s context after a different owner finishes',
    async (mode) => {
      const root = rootDir();
      await seed(root);
      const idle = child(mode, root);
      const winner = child('resume', root);
      await Promise.all([idle.next('ready'), winner.next('ready')]);
      winner.send('go');
      await winner.next('dispatch');
      winner.send('finish');
      expect(await winner.next('result')).toMatchObject({ success: true, finalState: 'DONE' });
      await winner.exit;
      const before = businessFiles(root);
      idle.send('go');
      expect(await idle.next('result')).toMatchObject({
        success: false,
        error: expect.stringContaining('changed') as unknown,
      });
      await idle.exit;
      expect(businessFiles(root)).toEqual(before);
      expect(dispatchCount(root)).toBe(1);
      expect(persistence(root).load(id)?.currentState).toBe('DONE');
      expect(persistence(root).probeLock(id).exists).toBe(false);
    },
    60_000,
  );

  it('does not let a preloaded retry undo an abort committed by another owner', async () => {
    const root = rootDir();
    await seed(root, true);
    const idle = child('retry', root);
    const abort = child('engine-abort', root);
    await Promise.all([idle.next('ready'), abort.next('ready')]);
    abort.send('go');
    expect(await abort.next('result')).toMatchObject({ success: true, finalState: 'ABORTED' });
    await abort.exit;
    const before = businessFiles(root);
    idle.send('go');
    expect(await idle.next('result')).toMatchObject({
      success: false,
      error: expect.stringContaining('changed') as unknown,
    });
    await idle.exit;
    expect(businessFiles(root)).toEqual(before);
    expect(dispatchCount(root)).toBe(0);
    expect(persistence(root).load(id)).toMatchObject({
      currentState: 'ABORTED',
      cumulativeInputTokens: 10,
      cumulativeOutputTokens: 5,
    });
  }, 60_000);

  it('has one winner when two processes race to reclaim a dead owner', async () => {
    const root = rootDir();
    const dead = child('lock-crash', root);
    await dead.next('ready');
    dead.send('go');
    expect((await dead.exit).code).toBe(73);
    const a = child('lock', root);
    const b = child('lock', root);
    await Promise.all([a.next('ready'), b.next('ready')]);
    a.send('go');
    b.send('go');
    const results = await Promise.all([a.next('owned', 'result'), b.next('owned', 'result')]);
    expect(results.filter((message) => message.type === 'owned')).toHaveLength(1);
    const winner = results[0].type === 'owned' ? a : b;
    const loser = winner === a ? b : a;
    await loser.exit;
    expect(persistence(root).probeLock(id)).toMatchObject({ exists: true, pidRunning: true });
    winner.send('release');
    expect(await winner.next('result')).toMatchObject({ success: true });
    await winner.exit;
    expect(persistence(root).probeLock(id).exists).toBe(false);
  }, 60_000);

  it.each(['publish-crash', 'reclaim-crash'])(
    'fails closed after a hard exit during %s',
    async (mode) => {
      const root = rootDir();
      if (mode === 'reclaim-crash') {
        const owner = child('lock-crash', root);
        await owner.next('ready');
        owner.send('go');
        expect((await owner.exit).code).toBe(73);
      }
      const crashed = child(mode, root);
      await crashed.next('ready');
      crashed.send('go');
      expect((await crashed.exit).code).toBe(73);
      const lockPath = join(root, '.ai', 'runs', id, 'run.lock');
      const before = readFileSync(lockPath, 'utf8');
      const contender = child('lock', root);
      await contender.next('ready');
      contender.send('go');
      expect(await contender.next('result')).toMatchObject({ success: false });
      await contender.exit;
      expect(readFileSync(lockPath, 'utf8')).toBe(before);
      expect(dispatchCount(root)).toBe(0);
    },
    60_000,
  );
});
