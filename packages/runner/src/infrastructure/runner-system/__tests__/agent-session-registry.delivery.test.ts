import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentSessionSnapshot } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { AgentSessionRegistry } from '../agent-session-registry';
import { DefaultAgentSessionStore } from '../default-agent-session-store';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function snapshot(
  state: AgentSessionSnapshot['state'],
  sessionId = 'session',
): AgentSessionSnapshot {
  return {
    ref: { runId: 'run', sessionId, stateId: 'WORK', role: 'planner', transport: 'remote' },
    state,
    pendingRequests:
      state === 'awaiting_human'
        ? [
            {
              requestId: 'permission',
              kind: 'permission',
              createdAt: '',
              payload: { action: 'write', resource: '/file' },
            },
          ]
        : [],
    createdAt: '',
    updatedAt: '',
    lastProtocolTimestamp: '',
  };
}

describe('session snapshot delivery ordering', () => {
  it.each([false, true])(
    'commits newer progress after a pending write (older write fails: %s)',
    async (failFirst) => {
      const dir = await mkdtemp(join(tmpdir(), 'session-delivery-'));
      try {
        const store = new DefaultAgentSessionStore(dir);
        const registry = new AgentSessionRegistry(store);
        const entered = deferred();
        const release = deferred();
        const save = store.saveSnapshot.bind(store);
        let inFlight = 0;
        let maximum = 0;
        vi.spyOn(store, 'saveSnapshot').mockImplementation(async (value) => {
          if (value.ref.sessionId !== 'session') {
            return save(value);
          }
          inFlight += 1;
          maximum = Math.max(maximum, inFlight);
          try {
            if (value.state === 'awaiting_human') {
              entered.resolve();
              await release.promise;
              if (failFirst) {
                throw new Error('injected older snapshot failure');
              }
            }
            await save(value);
          } finally {
            inFlight -= 1;
          }
        });
        const first = registry.register(snapshot('awaiting_human'));
        const rejected = failFirst
          ? expect(first).rejects.toThrow('older snapshot failure')
          : first;
        await entered.promise;
        const second = registry.register(snapshot('running'));
        // A different session can persist while the first session's write is blocked.
        await registry.register(snapshot('running', 'other'));
        release.resolve();
        await Promise.all([rejected, second]);
        expect(maximum).toBe(1);
        expect((await store.loadSnapshot('session', 'run'))?.state).toBe('running');
        expect(registry.get('session')?.pendingRequests).toEqual([]);
        const rebuilt = new AgentSessionRegistry(new DefaultAgentSessionStore(dir));
        await rebuilt.rebuild();
        expect(rebuilt.get('session')?.state).toBe('running');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
