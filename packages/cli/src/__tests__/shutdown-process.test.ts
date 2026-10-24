import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { createRunId } from '@ai-dev-orchestrator/ports';
import { STATE_FILENAME } from '@ai-dev-orchestrator/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';

const bundle = process.env['SHUTDOWN_TEST_BUNDLE'];
const fixture =
  bundle ?? fileURLToPath(new URL('../../test/fixtures/shutdown-process.mjs', import.meta.url));
const roots: string[] = [];
const children: { child: ChildProcessWithoutNullStreams; exit: Promise<number | null> }[] = [];
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'graceful-shutdown-'));
  roots.push(root);
  return root;
}
function child(root: string, mode: string, terminal = false) {
  const args = [...(bundle ? [] : ['--import', import.meta.resolve('tsx')]), fixture, root, mode];
  const command = [process.execPath, ...args];
  const scriptArgs =
    process.platform === 'darwin'
      ? ['-q', '/dev/null', ...command]
      : ['-q', '-e', '-c', command.map(quote).join(' '), '/dev/null'];
  const child = terminal
    ? spawn('/bin/sh', ['-c', 'cat | /usr/bin/script "$@"', 'shutdown-terminal', ...scriptArgs], {
        stdio: 'pipe',
        detached: true,
        env: { ...process.env, TERM: 'xterm' },
      })
    : spawn(process.execPath, args, { stdio: 'pipe', detached: true });
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  children.push({ child, exit });
  return {
    child,
    exit,
    output: () => output,
    errors: () => errors,
    waitFor: async (text: string) => {
      await vi.waitFor(
        () => {
          expect(output + errors).toContain(text);
        },
        { timeout: 12000, interval: 20 },
      );
    },
    finish: async (code: number) => {
      if (terminal) {
        child.stdin.end();
      }
      expect(await exit, output + errors).toBe(code);
    },
  };
}
async function waitFile(root: string, name: string) {
  await vi.waitFor(
    () => {
      expect(existsSync(join(root, name))).toBe(true);
    },
    { timeout: 12000, interval: 20 },
  );
}
async function state(root: string) {
  const id = await readFile(join(root, 'run-id'), 'utf8');
  const persistence = new DefaultStatePersistence(join(root, '.ai', 'runs'));
  return { id, persistence, state: persistence.load(createRunId(id)) };
}
async function inspect(root: string) {
  const process = child(root, 'inspect');
  await process.finish(0);
  const match = /INSPECT:([^\r\n]+)/.exec(process.output());
  return JSON.parse(match?.[1] ?? '{}') as {
    state: string;
    lock: { exists: boolean; pidRunning: boolean };
    checkpoints: string[];
  };
}
afterEach(async () => {
  for (const { child } of children) {
    child.stdin.destroy();
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* The owned group already exited. */
      }
    }
  }
  await Promise.allSettled(children.splice(0).map(({ exit }) => exit));
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});
describe.skipIf(process.platform === 'win32')(
  'graceful shutdown through actual CLI processes',
  () => {
    it.each(['run-permission', 'run-clarification'])(
      'Ctrl+C during %s aborts without a default response',
      async (mode) => {
        const root = await tempRoot();
        const run = child(root, mode, true);
        await run.waitFor(mode === 'run-permission' ? 'Allow? [Y/n]' : 'Which database?');
        run.child.stdin.write('\x03');
        await run.waitFor('Workflow was aborted');
        await run.finish(4);
        const saved = await state(root);
        expect(saved.state?.currentState).toBe('ABORTED');
        expect(saved.persistence.probeLock(createRunId(saved.id)).exists).toBe(false);
        expect(
          existsSync(join(root, '.ai', 'runs', saved.id, 'live-responses', 'request.json')),
        ).toBe(false);
        expect((await inspect(root)).state).toBe('ABORTED');
      },
      25000,
    );
    it('cancels a SIGTERM-ignoring agent through the actual CLI runner and reaps it', async () => {
      const root = await tempRoot();
      const run = child(root, 'run-stubborn');
      await waitFile(root, 'worker.pid');
      const pid = Number(await readFile(join(root, 'worker.pid'), 'utf8'));
      run.child.kill('SIGTERM');
      await run.finish(4);
      expect(() => process.kill(pid, 0)).toThrow();
      expect(run.output()).toContain('"finalState":"ABORTED"');
      expect((await inspect(root)).lock.exists).toBe(false);
    }, 25000);
    it('cancels session advancement in a fresh permit process and releases ownership', async () => {
      const root = await tempRoot();
      const seed = child(root, 'seed-session');
      await seed.finish(0);
      const resume = child(root, 'resume-session');
      await waitFile(root, 'advancing');
      const started = Date.now();
      resume.child.kill('SIGINT');
      await resume.finish(4);
      expect(Date.now() - started).toBeLessThan(6000);
      expect(resume.errors()).not.toContain('Graceful shutdown timed out');
      expect(resume.output()).toContain('"finalState":"ABORTED"');
      expect(await readFile(join(root, 'session-cancellations'), 'utf8')).toBe('abort\n');
      expect((await inspect(root)).lock.exists).toBe(false);
    }, 25000);
    it('does not print a late storage acknowledgement when a response write crosses shutdown', async () => {
      const root = await tempRoot();
      const run = child(root, 'run-write', true);
      await run.waitFor('Allow? [Y/n]');
      run.child.stdin.write('yes\n');
      await waitFile(root, 'writing');
      const saved = await state(root);
      const lock = saved.persistence.probeLock(createRunId(saved.id));
      process.kill(lock.pid, 'SIGTERM');
      await vi.waitFor(
        async () => {
          expect((await state(root)).state?.currentState).toBe('ABORTED');
        },
        { timeout: 5000, interval: 20 },
      );
      await writeFile(join(root, 'release-write'), 'release');
      await run.waitFor('Workflow was aborted');
      await run.finish(4);
      expect(run.output()).not.toContain('response stored');
      expect(
        JSON.parse(
          await readFile(
            join(root, '.ai', 'runs', saved.id, 'live-responses', 'request.json'),
            'utf8',
          ),
        ),
      ).toMatchObject({ payload: { granted: true } });
    }, 25000);
    it('bounds hung cancellation without resetting its deadline, retains the dead lock, and recovers in a fresh process', async () => {
      const root = await tempRoot();
      const run = child(root, 'run-hung');
      await waitFile(root, 'dispatched');
      const started = Date.now();
      run.child.kill('SIGTERM');
      await vi.waitFor(
        async () => {
          expect((await state(root)).state?.currentState).toBe('ABORTED');
        },
        { timeout: 5000, interval: 20 },
      );
      run.child.kill('SIGINT');
      await run.finish(4);
      expect(Date.now() - started).toBeLessThan(12500);
      expect(run.errors()).toContain('Graceful shutdown timed out');
      expect(JSON.parse(run.errors().trim().split('\n').at(-1) ?? '{}')).toMatchObject({
        error: { code: 4 },
      });
      expect(await readFile(join(root, 'cancellations'), 'utf8')).toBe('cancel\n');
      const observed = await inspect(root);
      expect(observed.state).toBe('ABORTED');
      expect(observed.checkpoints).toContain('ABORTED');
      expect(observed.lock.exists).toBe(true);
      expect(observed.lock.pidRunning).toBe(false);
      const saved = await state(root);
      const checkpointPath = join(root, '.ai', 'runs', saved.id, STATE_FILENAME);
      await rm(checkpointPath, { force: true });
      await rm(checkpointPath + '.bak', { force: true });
      expect((await inspect(root)).state).toBe('ABORTED');
      const recovered = child(root, 'recover');
      await recovered.finish(0);
      expect(recovered.output()).toContain('"finalState":"DONE"');
      expect((await inspect(root)).lock.exists).toBe(false);
    }, 25000);
  },
);
