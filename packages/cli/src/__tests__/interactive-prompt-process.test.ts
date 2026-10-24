import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import type { LiveResponse } from '@ai-dev-orchestrator/runner';
import { afterEach, describe, expect, it, vi } from 'vitest';

const bundle = process.env['INTERACTIVE_PROMPT_TEST_BUNDLE'];
const fixture =
  bundle ??
  fileURLToPath(new URL('../../test/fixtures/interactive-prompt-process.mjs', import.meta.url));
const roots: string[] = [];
const children: {
  child: ChildProcessWithoutNullStreams;
  exit: Promise<number | null>;
  output: () => string;
}[] = [];
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
async function terminal(mode: string) {
  const root = await mkdtemp(join(tmpdir(), 'interactive-terminal-'));
  roots.push(root);
  const command = [
    process.execPath,
    ...(bundle ? [] : ['--import', import.meta.resolve('tsx')]),
    fixture,
    root,
    mode,
  ];
  const args =
    process.platform === 'darwin'
      ? ['-q', '/dev/null', ...command]
      : ['-q', '-e', '-c', command.map(quote).join(' '), '/dev/null'];
  const child = spawn(
    '/bin/sh',
    ['-c', 'cat | /usr/bin/script "$@"', 'interactive-terminal', ...args],
    {
      detached: true,
      stdio: 'pipe',
      env: { ...process.env, TERM: 'xterm', NO_COLOR: '1' },
    },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  children.push({ child, exit, output: () => output });
  return {
    root,
    child,
    exit,
    output: () => output,
    waitFor: async (text: string, times = 1) => {
      await vi.waitFor(
        () => {
          expect(output.split(text).length - 1, output).toBeGreaterThanOrEqual(times);
        },
        { timeout: 8000, interval: 20 },
      );
    },
    finish: async () => {
      await vi.waitFor(
        () => {
          expect(output, output).toContain('TERMINAL_RESULT:');
        },
        { timeout: 8000, interval: 20 },
      );
      child.stdin.end();
      expect(await exit, output).toBe(0);
      const match = /TERMINAL_RESULT:([^\r\n]+)/.exec(output);
      expect(match, output).not.toBeNull();
      return JSON.parse(match?.[1] ?? '{}') as {
        interrupted: boolean;
        permission: LiveResponse | null;
        clarification: LiveResponse | null;
      };
    },
  };
}
afterEach(async () => {
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.destroy();
      if (child.pid) {
        process.kill(-child.pid, 'SIGKILL');
      }
    }
  }
  await Promise.allSettled(children.map(({ exit }) => exit));
  children.length = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe.skipIf(process.platform === 'win32')(
  'interactive requests through a real POSIX terminal',
  () => {
    it('routes terminal Ctrl+C to shutdown without submitting a default response', async () => {
      const session = await terminal('interrupt');
      await session.waitFor('Allow? [Y/n]');
      session.child.stdin.write('\x03');
      const result = await session.finish();
      expect(result.interrupted).toBe(true);
      expect(result.permission).toBeNull();
      expect(result.clarification).toBeNull();
      expect(session.output()).not.toContain('Terminal input closed');
    }, 20_000);
    it('serializes permission and clarification, accepting no as denial', async () => {
      const session = await terminal('normal');
      await session.waitFor('Allow? [Y/n]');
      expect(session.output()).not.toContain('Which database?');
      session.child.stdin.write('no\n');
      await session.waitFor('Live permission response stored');
      await session.waitFor('Which database?');
      session.child.stdin.write('PostgreSQL\n');
      const result = await session.finish();
      expect(result.permission?.payload).toEqual({ granted: false });
      expect(result.clarification?.payload).toEqual({ answer: 'PostgreSQL' });
    }, 20_000);
    it('reopens a failed request and stores the retry without an unhandled rejection', async () => {
      const session = await terminal('retry');
      await session.waitFor('Allow? [Y/n]');
      session.child.stdin.write('yes\n');
      await session.waitFor('fixture storage unavailable');
      expect(session.output()).not.toContain('response stored');
      await session.waitFor('Allow? [Y/n]', 2);
      session.child.stdin.write('no\n');
      await session.waitFor('Which database?');
      session.child.stdin.write('SQLite\n');
      const result = await session.finish();
      expect(result.permission?.payload).toEqual({ granted: false });
      expect(session.output()).not.toContain('Unhandled');
    }, 20_000);
    it('dismisses a question answered externally and keeps the externally stored decision', async () => {
      const session = await terminal('external');
      await session.waitFor('Allow? [Y/n]');
      const store = new FileBackedLiveRequestStore(session.root);
      await store.writeResponse(
        { runId: 'run', messageId: 'permission', respondedAt: '', payload: { granted: true } },
        { requireRequest: true },
      );
      await session.waitFor('no longer pending');
      await session.waitFor('Which database?');
      session.child.stdin.write('SQLite\n');
      const result = await session.finish();
      expect(result.permission?.payload).toEqual({ granted: true });
    }, 20_000);
    it('dismisses expired requests without creating a permission decision', async () => {
      const session = await terminal('expiry');
      await session.waitFor('Allow? [Y/n]');
      await session.waitFor('no longer pending');
      await session.waitFor('Which database?');
      session.child.stdin.write('SQLite\n');
      const result = await session.finish();
      expect(result.permission).toBeNull();
    }, 20_000);
    it('leaves EOF unanswered and offers external response guidance', async () => {
      const session = await terminal('eof');
      await session.waitFor('Allow? [Y/n]');
      session.child.stdin.write('\x04');
      await session.waitFor('Terminal input closed');
      expect(session.output()).not.toContain('Which database?');
      await writeFile(join(session.root, 'stop'), 'stop');
      const result = await session.finish();
      expect(result.permission).toBeNull();
      expect(result.clarification).toBeNull();
    }, 20_000);
    it('stops with an open prompt without creating a default answer', async () => {
      const session = await terminal('stop');
      await session.waitFor('Allow? [Y/n]');
      await writeFile(join(session.root, 'stop'), 'stop');
      const result = await session.finish();
      expect(result.permission).toBeNull();
      expect(result.clarification).toBeNull();
      expect(session.output()).not.toContain('Terminal input closed');
    }, 20_000);
  },
);
