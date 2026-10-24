import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import { createRunId } from '@ai-dev-orchestrator/ports';
import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import { afterEach, describe, expect, it, assert } from 'vitest';

const fixture = fileURLToPath(
  new URL('../../test/fixtures/live-permission-process.mjs', import.meta.url),
);
const roots: string[] = [];
const children: ChildProcess[] = [];
const exits: Promise<unknown>[] = [];
function rootDir() {
  const root = mkdtempSync(join(tmpdir(), 'live-permission-process-'));
  roots.push(root);
  return root;
}
function child(root: string, mode: string, target = 'DONE', decision = 'grant') {
  const process = fork(fixture, [root, mode, target, decision], {
    execArgv: ['--import', import.meta.resolve('tsx')],
    silent: true,
  });
  children.push(process);
  let output = '';
  let errors = '';
  let ready = false;
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
  });
  const exit = new Promise<number | null>((resolve) => {
    process.once('close', resolve);
  });
  exits.push(exit);
  return {
    exit,
    output: () => output,
    errors: () => errors,
    release: () => {
      writeFileSync(join(root, `release-${String(process.pid)}`), 'go');
    },
    ready: async () => {
      const deadline = Date.now() + 15_000;
      while (!ready) {
        if (Date.now() > deadline || process.exitCode !== null) {
          throw new Error(`Permission child not ready: ${errors}`);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}
async function seedSession(root: string) {
  const runDir = join(root, '.ai', 'runs', 'permission');
  mkdirSync(runDir, { recursive: true });
  const transition = {
    target: 'DONE',
    trigger: 'completion',
    guards: [],
    priority: 0,
    governanceRequired: false,
  };
  writeFileSync(
    join(runDir, 'workflow-definition.json'),
    JSON.stringify({
      name: 'permission',
      version: '1',
      initialState: 'WORK',
      terminalStates: ['DONE', 'FAILED', 'ABORTED'],
      states: {
        WORK: { type: 'action', description: '', transitions: [transition] },
        WAITING_FOR_HUMAN: { type: 'wait', description: '', transitions: [] },
        DONE: { type: 'terminal', description: '', transitions: [] },
        FAILED: { type: 'terminal', description: '', transitions: [] },
        ABORTED: { type: 'terminal', description: '', transitions: [] },
      },
    }),
  );
  writeFileSync(join(runDir, 'sources.json'), '[]');
  const persistence = new DefaultStatePersistence(join(root, '.ai', 'runs'));
  const now = new Date().toISOString();
  const state: PersistedState = {
    runId: createRunId('permission'),
    schemaVersion: 2,
    currentState: 'WAITING_FOR_HUMAN',
    previousState: 'WORK',
    repoRoot: root,
    stateEnteredAt: now,
    transitionCount: 1,
    stateHistory: ['WORK', 'WAITING_FOR_HUMAN'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'permission',
    workflowVersion: '1',
    persistedAt: now,
    persistenceVersion: 1,
    checksum: '',
    waitingContext: {
      reason: 'live_session_awaiting_human',
      requiredInput: 'approval',
      requestingState: 'WORK',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: now,
      liveSessionId: 'session',
      pendingRequestId: 'selected',
      liveRequestType: 'permission',
      sessionTransport: 'remote',
    },
  };
  await persistence.save(state);
  return { persistence, state, runDir };
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
describe('live permission real processes', () => {
  it('has one winner when separate processes grant and deny the same request simultaneously', async () => {
    const root = rootDir();
    const store = new FileBackedLiveRequestStore(join(root, '.ai', 'runs'));
    await store.writeRequest({
      runId: 'permission',
      messageId: 'selected',
      kind: 'permission',
      createdAt: '',
      payload: {},
    });
    const grant = child(root, 'writer', 'hold', 'grant');
    const deny = child(root, 'writer', 'hold', 'deny');
    await Promise.all([grant.ready(), deny.ready()]);
    grant.release();
    deny.release();
    const codes = await Promise.all([grant.exit, deny.exit]);
    expect([...codes].sort()).toEqual([0, 1]);
    expect((await store.awaitResponse('permission', 'selected', 0))?.payload).toEqual({
      granted: codes[0] === 0,
    });
  }, 30_000);
  it('uses a newer journal request instead of a stale raw permission checkpoint', async () => {
    const root = rootDir();
    const f = await seedSession(root);
    const wait = f.state.waitingContext;
    assert(wait);
    const persistedAt = new Date(Date.parse(f.state.persistedAt) + 1000).toISOString();
    new DefaultJournalWriter(join(f.runDir, 'journal.md'), 'permission').append({
      timestamp: persistedAt,
      runId: 'permission',
      sequence: 0,
      type: 'workflow_checkpoint',
      data: {
        kind: 'workflow_checkpoint',
        state: {
          ...f.state,
          persistedAt,
          waitingContext: { ...wait, pendingRequestId: 'new-request' },
        },
      },
    });
    const p = child(root, 'session');
    expect(await p.exit).toBe(1);
    expect(existsSync(join(root, 'delivered.jsonl'))).toBe(false);
  }, 30_000);
  it.each(
    ['DONE', 'FAILED', 'ABORTED', 'WAITING_FOR_HUMAN'].flatMap((target) =>
      ['grant', 'deny'].map((decision) => ({ target, decision })),
    ),
  )(
    'reports $target after $decision and delivers the selected identity',
    async ({ target, decision }) => {
      const root = rootDir();
      const f = await seedSession(root);
      const p = child(root, 'session', target, decision);
      const code = target === 'FAILED' ? 3 : target === 'ABORTED' ? 4 : 0;
      expect(await p.exit, p.errors()).toBe(code);
      expect(JSON.parse(p.output())).toMatchObject({
        finalState: target,
        exitCode: code,
        action: decision === 'grant' ? 'granted' : 'denied',
      });
      expect(JSON.parse(readFileSync(join(root, 'delivered.jsonl'), 'utf8'))).toMatchObject({
        sessionId: 'session',
        requestId: 'selected',
        payload: { granted: decision === 'grant' },
      });
      expect(f.persistence.load(createRunId('permission'))?.currentState).toBe(target);
      expect(f.persistence.probeLock(createRunId('permission')).exists).toBe(false);
    },
    30_000,
  );
  it('does not send a response when the attached session has advanced to a different request', async () => {
    const root = rootDir();
    const f = await seedSession(root);
    const p = child(root, 'session', 'changed');
    expect(await p.exit).toBe(3);
    expect(existsSync(join(root, 'delivered.jsonl'))).toBe(false);
    expect(f.persistence.load(createRunId('permission'))?.waitingContext?.pendingRequestId).toBe(
      'new-request',
    );
  }, 30_000);
  it('does not rebind a selected request when bootstrap loads a replacement session', async () => {
    const root = rootDir();
    const f = await seedSession(root);
    const p = child(root, 'bootstrap-race');
    await p.ready();
    const wait = f.state.waitingContext;
    assert(wait);
    await f.persistence.save({
      ...f.state,
      waitingContext: { ...wait, liveSessionId: 'replacement', pendingRequestId: 'new-request' },
    });
    p.release();
    expect(await p.exit).toBe(3);
    expect(existsSync(join(root, 'delivered.jsonl'))).toBe(false);
  }, 30_000);
  it('keeps one cross-process decision immutable through cleanup and a delayed conflicting writer', async () => {
    const root = rootDir();
    const store = new FileBackedLiveRequestStore(join(root, '.ai', 'runs'));
    await store.writeRequest({
      runId: 'permission',
      messageId: 'selected',
      kind: 'permission',
      createdAt: '',
      payload: {},
    });
    const late = child(root, 'writer', 'hold', 'deny');
    await late.ready();
    const winner = child(root, 'writer', 'now', 'grant');
    expect(await winner.exit).toBe(0);
    const cleanup = child(root, 'cleanup');
    expect(await cleanup.exit).toBe(0);
    late.release();
    expect(await late.exit).toBe(1);
    const duplicate = child(root, 'file');
    expect(await duplicate.exit, duplicate.errors()).toBe(0);
    expect(JSON.parse(duplicate.output())).toMatchObject({ outcome: 'already_responded' });
    expect(await store.listPendingRequests('permission')).toEqual([]);
  }, 30_000);
});
