import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentTask } from '@ai-dev-orchestrator/schemas';
import { OwnedProcess } from '@ai-dev-orchestrator/utils/owned-process';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { CliHumanRequestHandler } from '../cli-human-request-handler';
import { executeCliProcess } from '../cli-process-execution';
import { CliProcessRegistry } from '../cli-process-registry';
import { createCliSession } from '../cli-session-execution';
import type { LocalAgentSessionHost } from '../local-agent-session-host';
import type { LocalAgentSessionSupervisor } from '../local-agent-session-supervisor';

const fixture = fileURLToPath(
  new URL('../../../../../utils/test/fixtures/process-tree.mjs', import.meta.url),
);
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (existsSync(join(root, 'parent.pid'))) {
      try {
        process.kill(-Number(readFileSync(join(root, 'parent.pid'), 'utf8')), 'SIGKILL');
      } catch {
        /* Owned group already stopped. */
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});
async function setup(mode: string, timeout = 15000) {
  const root = await mkdtemp(join(tmpdir(), 'agent-tree-'));
  roots.push(root);
  const task: AgentTask = {
    taskId: 'task',
    runId: 'run',
    stateId: 'WORK',
    role: 'planner',
    description: '',
    inputArtifacts: [],
    repoRoot: root,
    runDir: root,
    outputArtifactPath: join(root, 'output.json'),
    constraints: { timeout, requiredOutputType: 'plan' },
    agentConfig: {
      command: process.execPath,
      args: [fixture, root, ...(mode === 'legacy' ? [] : ['protocol', mode])],
    },
  };
  const processes = new CliProcessRegistry();
  const ready = () =>
    vi.waitFor(
      () => {
        expect(existsSync(join(root, 'leaf.beat'))).toBe(true);
      },
      { timeout: 5000 },
    );
  const stopped = () =>
    vi.waitFor(() => {
      for (const name of ['parent.pid', 'leaf.pid']) {
        const pid = Number(readFileSync(join(root, name), 'utf8'));
        let stat = '';
        try {
          stat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
            encoding: 'utf8',
          }).trim();
        } catch {
          /* Reaped. */
        }
        expect(stat === '' || stat.startsWith('Z')).toBe(true);
      }
    });
  return { root, task, processes, ready, stopped };
}
describe.skipIf(process.platform === 'win32')('CLI agent descendant ownership', () => {
  it.each(['cancel', 'timeout', 'done'])(
    'cleans dispatch descendants after %s',
    async (mode) => {
      const test = await setup(
        mode === 'done' ? 'done' : 'legacy',
        mode === 'timeout' ? 800 : 15000,
      );
      const pending = executeCliProcess(test.task, {
        processes: test.processes,
        requests: new CliHumanRequestHandler(),
        config: { command: process.execPath, handshakeTimeoutMs: 500 },
        readOutput: vi.fn().mockResolvedValue({
          taskId: 'task',
          status: 'failure',
          error: 'no output',
          durationMs: 0,
        }),
      });
      await test.ready();
      if (mode === 'cancel') {
        test.processes.killAll();
        test.processes.killAll();
      }
      const result = await pending;
      expect(result.status).toBe(
        mode === 'done' ? 'success' : mode === 'timeout' ? 'timeout' : 'failure',
      );
      await test.stopped();
    },
    18000,
  );

  it.each(['fallback', 'handshake-cancel', 'fallback-cleanup-cancel'])(
    'waits for cleanup before %s',
    async (mode) => {
      const test = await setup('legacy');
      const kill = vi.spyOn(OwnedProcess.prototype, 'kill');
      const fallback = vi.fn(async () => {
        await test.stopped();
        return { taskId: 'task', status: 'success' as const, durationMs: 0 };
      });
      const pending = createCliSession(test.task, {
        processes: test.processes,
        config: { command: process.execPath, handshakeTimeoutMs: 500 },
        getSupervisor: () => undefined,
        dispatchFallback: fallback,
      });
      await test.ready();
      if (mode === 'fallback-cleanup-cancel') {
        await vi.waitFor(() => {
          expect(kill).toHaveBeenCalled();
        });
      }
      if (mode !== 'fallback') {
        test.processes.killAll();
      }
      const result = await pending;
      expect(result.kind).toBe('terminal');
      expect(fallback).toHaveBeenCalledTimes(mode === 'fallback' ? 1 : 0);
      await test.stopped();
    },
    18000,
  );

  it.each(['abort', 'timeout', 'done', 'error', 'registration-error', 'registration-cancel'])(
    'cleans session descendants after %s',
    async (mode) => {
      const test = await setup(mode, mode === 'timeout' ? 800 : 15000);
      let host: LocalAgentSessionHost | undefined;
      const registrationError = new Error('registration failed');
      const supervisor = {
        registerHost: async (value: LocalAgentSessionHost) => {
          host = value;
          if (mode === 'registration-cancel') {
            await test.ready();
            test.processes.killAll();
          }
          if (mode === 'registration-error') {
            await test.ready();
            throw registrationError;
          }
        },
      } as unknown as LocalAgentSessionSupervisor;
      const fallback = vi.fn();
      const pending = createCliSession(test.task, {
        processes: test.processes,
        config: { command: process.execPath, handshakeTimeoutMs: 1000 },
        getSupervisor: () => supervisor,
        dispatchFallback: fallback,
      });
      if (mode === 'registration-error') {
        await expect(pending).rejects.toBe(registrationError);
      } else if (mode === 'registration-cancel') {
        expect(await pending).toMatchObject({
          kind: 'terminal',
          result: { error: 'Agent dispatch cancelled' },
        });
      } else {
        expect((await pending).kind).toBe('session');
        await test.ready();
        assert(host);
        if (mode === 'abort') {
          host.abort('test shutdown');
        }
        const result = await host.resultPromise;
        expect(result.status).toBe(
          mode === 'done' ? 'success' : mode === 'timeout' ? 'timeout' : 'failure',
        );
      }
      expect(fallback).not.toHaveBeenCalled();
      await test.stopped();
    },
    18000,
  );
});
