import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentSessionSnapshot } from '@ai-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentSessionRegistry } from '../agent-session-registry';
import { AgentSessionRequestRouter } from '../agent-session-request-router';
import { DefaultAgentSessionStore } from '../default-agent-session-store';

function makeSnapshot(
  overrides: Partial<AgentSessionSnapshot> & { ref: AgentSessionSnapshot['ref'] },
): AgentSessionSnapshot {
  return {
    state: 'running',
    pendingRequests: [],
    lastProtocolTimestamp: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const REF_A = {
  sessionId: 'sess-a',
  runId: 'run-1',
  stateId: 'IMPL',
  role: 'implementer',
  transport: 'stdio' as const,
};

const REF_B = {
  sessionId: 'sess-b',
  runId: 'run-1',
  stateId: 'REVIEW',
  role: 'static_reviewer',
  transport: 'remote' as const,
};

const REF_C = {
  sessionId: 'sess-c',
  runId: 'run-2',
  stateId: 'IMPL',
  role: 'implementer',
  transport: 'stdio' as const,
};

describe('DefaultAgentSessionStore', () => {
  let dir: string;
  let store: DefaultAgentSessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-store-'));
    store = new DefaultAgentSessionStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a snapshot through save and load', async () => {
    const snap = makeSnapshot({ ref: REF_A, state: 'awaiting_human' });
    await store.saveSnapshot(snap);
    const loaded = await store.loadSnapshot('sess-a', 'run-1');
    expect(loaded).toEqual(snap);
  });

  it('overwrites a snapshot on re-save', async () => {
    await store.saveSnapshot(makeSnapshot({ ref: REF_A, state: 'running' }));
    await store.saveSnapshot(makeSnapshot({ ref: REF_A, state: 'completed' }));
    const loaded = await store.loadSnapshot('sess-a', 'run-1');
    expect(loaded?.state).toBe('completed');
  });

  it('returns null for non-existent snapshot', async () => {
    const loaded = await store.loadSnapshot('nonexistent', 'run-1');
    expect(loaded).toBeNull();
  });

  it('lists sessions by run', async () => {
    await store.saveSnapshot(makeSnapshot({ ref: REF_A }));
    await store.saveSnapshot(makeSnapshot({ ref: REF_B }));
    await store.saveSnapshot(makeSnapshot({ ref: REF_C }));

    const run1 = await store.listByRun('run-1');
    expect(run1).toHaveLength(2);
    const ids = run1.map((s) => s.ref.sessionId).sort();
    expect(ids).toEqual(['sess-a', 'sess-b']);

    const run2 = await store.listByRun('run-2');
    expect(run2).toHaveLength(1);
  });

  it('lists all sessions across runs', async () => {
    await store.saveSnapshot(makeSnapshot({ ref: REF_A }));
    await store.saveSnapshot(makeSnapshot({ ref: REF_C }));
    const all = await store.listAll();
    expect(all).toHaveLength(2);
  });

  it('removes a snapshot', async () => {
    await store.saveSnapshot(makeSnapshot({ ref: REF_A }));
    const removed = await store.removeSnapshot('sess-a', 'run-1');
    expect(removed).toBe(true);
    const loaded = await store.loadSnapshot('sess-a', 'run-1');
    expect(loaded).toBeNull();
  });

  it('returns false when removing non-existent snapshot', async () => {
    const removed = await store.removeSnapshot('nonexistent', 'run-1');
    expect(removed).toBe(false);
  });

  it('returns empty for listing non-existent run', async () => {
    const list = await store.listByRun('nonexistent');
    expect(list).toEqual([]);
  });

  it('returns null when file content fails schema validation', async () => {
    // Write a valid JSON file that does not match the snapshot schema
    const sessDir = join(dir, 'run-1', 'sessions');
    await mkdir(sessDir, { recursive: true });
    await writeFile(join(sessDir, 'sess-bad.json'), JSON.stringify({ invalid: true }));

    const loaded = await store.loadSnapshot('sess-bad', 'run-1');
    expect(loaded).toBeNull();
  });

  it('skips non-json files in listByRun', async () => {
    await store.saveSnapshot(makeSnapshot({ ref: REF_A }));

    // Add a non-json file to the sessions directory
    const sessDir = join(dir, 'run-1', 'sessions');
    await writeFile(join(sessDir, 'README.txt'), 'not a snapshot');

    const list = await store.listByRun('run-1');
    expect(list).toHaveLength(1);
    expect(list[0].ref.sessionId).toBe('sess-a');
  });

  it('skips files that fail schema validation in listByRun', async () => {
    await store.saveSnapshot(makeSnapshot({ ref: REF_A }));

    // Add a json file with invalid schema content
    const sessDir = join(dir, 'run-1', 'sessions');
    await writeFile(join(sessDir, 'sess-invalid.json'), JSON.stringify({ bad: 'data' }));

    const list = await store.listByRun('run-1');
    expect(list).toHaveLength(1);
  });

  it('returns empty from listAll when base directory does not exist', async () => {
    const emptyStore = new DefaultAgentSessionStore(join(dir, 'nonexistent-base'));
    const all = await emptyStore.listAll();
    expect(all).toEqual([]);
  });
});

describe('AgentSessionRegistry', () => {
  let dir: string;
  let store: DefaultAgentSessionStore;
  let registry: AgentSessionRegistry;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-registry-'));
    store = new DefaultAgentSessionStore(dir);
    registry = new AgentSessionRegistry(store);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('registers and retrieves by sessionId', async () => {
    const snap = makeSnapshot({ ref: REF_A });
    await registry.register(snap);
    expect(registry.get('sess-a')).toEqual(snap);
  });

  it('lists by run', async () => {
    await registry.register(makeSnapshot({ ref: REF_A }));
    await registry.register(makeSnapshot({ ref: REF_B }));
    await registry.register(makeSnapshot({ ref: REF_C }));

    const run1 = registry.listByRun('run-1');
    expect(run1).toHaveLength(2);
  });

  it('lists active (non-terminal) sessions by run', async () => {
    await registry.register(makeSnapshot({ ref: REF_A, state: 'running' }));
    await registry.register(makeSnapshot({ ref: REF_B, state: 'completed' }));

    const active = registry.listActiveByRun('run-1');
    expect(active).toHaveLength(1);
    expect(active[0].ref.sessionId).toBe('sess-a');
  });

  it('lists by state', async () => {
    await registry.register(makeSnapshot({ ref: REF_A, state: 'awaiting_human' }));
    await registry.register(makeSnapshot({ ref: REF_B, state: 'running' }));

    const awaiting = registry.listByState('awaiting_human');
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0].ref.sessionId).toBe('sess-a');
  });

  it('rebuilds from disk', async () => {
    await store.saveSnapshot(makeSnapshot({ ref: REF_A }));
    await store.saveSnapshot(makeSnapshot({ ref: REF_C }));

    const fresh = new AgentSessionRegistry(store);
    expect(fresh.get('sess-a')).toBeNull();

    await fresh.rebuild();
    expect(fresh.get('sess-a')).not.toBeNull();
    expect(fresh.get('sess-c')).not.toBeNull();
  });

  it('removes from registry and store', async () => {
    await registry.register(makeSnapshot({ ref: REF_A }));
    const removed = await registry.remove('sess-a', 'run-1');
    expect(removed).toBe(true);
    expect(registry.get('sess-a')).toBeNull();
    expect(registry.listByRun('run-1')).toHaveLength(0);

    const onDisk = await store.loadSnapshot('sess-a', 'run-1');
    expect(onDisk).toBeNull();
  });
});

describe('AgentSessionRequestRouter', () => {
  let dir: string;
  let store: DefaultAgentSessionStore;
  let registry: AgentSessionRegistry;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-router-'));
    store = new DefaultAgentSessionStore(dir);
    registry = new AgentSessionRegistry(store);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('routes by explicit sessionId', async () => {
    await registry.register(
      makeSnapshot({
        ref: REF_A,
        state: 'awaiting_human',
        pendingRequests: [
          {
            requestId: 'msg-1',
            kind: 'permission',
            createdAt: '2026-01-01T00:00:00Z',
            payload: {},
          },
        ],
      }),
    );
    const router = new AgentSessionRequestRouter(registry);
    const result = router.resolve('run-1', { sessionId: 'sess-a' });
    expect(result.kind).toBe('session');
    if (result.kind === 'session') {
      expect(result.sessionId).toBe('sess-a');
      expect(result.request.requestId).toBe('msg-1');
    }
  });

  it('routes by messageId across sessions', async () => {
    await registry.register(
      makeSnapshot({
        ref: REF_A,
        state: 'awaiting_human',
        pendingRequests: [
          {
            requestId: 'msg-1',
            kind: 'permission',
            createdAt: '2026-01-01T00:00:00Z',
            payload: {},
          },
        ],
      }),
    );
    await registry.register(
      makeSnapshot({
        ref: REF_B,
        state: 'awaiting_human',
        pendingRequests: [
          {
            requestId: 'msg-2',
            kind: 'clarification',
            createdAt: '2026-01-01T00:00:00Z',
            payload: {},
          },
        ],
      }),
    );

    const router = new AgentSessionRequestRouter(registry);
    const result = router.resolve('run-1', { messageId: 'msg-2' });
    expect(result.kind).toBe('session');
    if (result.kind === 'session') {
      expect(result.sessionId).toBe('sess-b');
    }
  });

  it('convenience-routes when exactly one session has a pending request', async () => {
    await registry.register(
      makeSnapshot({
        ref: REF_A,
        state: 'awaiting_human',
        pendingRequests: [
          {
            requestId: 'msg-1',
            kind: 'permission',
            createdAt: '2026-01-01T00:00:00Z',
            payload: {},
          },
        ],
      }),
    );
    await registry.register(makeSnapshot({ ref: REF_B, state: 'running' }));

    const router = new AgentSessionRequestRouter(registry);
    const result = router.resolve('run-1');
    expect(result.kind).toBe('session');
  });

  it('returns ambiguous when multiple sessions have pending requests', async () => {
    await registry.register(
      makeSnapshot({
        ref: REF_A,
        state: 'awaiting_human',
        pendingRequests: [
          {
            requestId: 'msg-1',
            kind: 'permission',
            createdAt: '2026-01-01T00:00:00Z',
            payload: {},
          },
        ],
      }),
    );
    await registry.register(
      makeSnapshot({
        ref: REF_B,
        state: 'awaiting_human',
        pendingRequests: [
          {
            requestId: 'msg-2',
            kind: 'clarification',
            createdAt: '2026-01-01T00:00:00Z',
            payload: {},
          },
        ],
      }),
    );

    const router = new AgentSessionRequestRouter(registry);
    const result = router.resolve('run-1');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it('falls back to legacy when no session matches and store exists', () => {
    const legacyStore = {
      writeRequest: async () => {},
      writeResponse: async () => {},
      awaitResponse: () => Promise.resolve(null),
      listPendingRequests: () => Promise.resolve([]),
      cleanupResolved: () => Promise.resolve(0),
    };
    const router = new AgentSessionRequestRouter(registry, legacyStore);
    const result = router.resolve('run-1', { messageId: 'msg-unknown' });
    expect(result.kind).toBe('legacy');
  });

  it('returns not_found when no session and no legacy store', () => {
    const router = new AgentSessionRequestRouter(registry);
    const result = router.resolve('run-1');
    expect(result.kind).toBe('not_found');
  });

  it('returns not_found for wrong runId with explicit sessionId', async () => {
    await registry.register(
      makeSnapshot({
        ref: REF_A,
        state: 'awaiting_human',
        pendingRequests: [
          {
            requestId: 'msg-1',
            kind: 'permission',
            createdAt: '2026-01-01T00:00:00Z',
            payload: {},
          },
        ],
      }),
    );
    const router = new AgentSessionRequestRouter(registry);
    const result = router.resolve('run-WRONG', { sessionId: 'sess-a' });
    expect(result.kind).toBe('not_found');
  });
});
