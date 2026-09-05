import type { AgentSessionStore } from '@ai-dev-orchestrator/ports';
import type { AgentSessionSnapshot } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AgentSessionRegistry } from '../agent-session-registry';

function makeSnapshot(
  overrides: Partial<AgentSessionSnapshot> & { ref?: Partial<AgentSessionSnapshot['ref']> } = {},
): AgentSessionSnapshot {
  return {
    ref: {
      sessionId: 'sess-1',
      runId: 'run-1',
      stateId: 'IMPL',
      role: 'implementer',
      transport: 'stdio',
      ...overrides.ref,
    },
    state: 'running',
    pendingRequests: [],
    lastProtocolTimestamp: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
  return result as AgentSessionSnapshot;
}

function makeStore(snapshots: AgentSessionSnapshot[] = []): AgentSessionStore {
  const data = new Map(snapshots.map((s) => [s.ref.sessionId, { ...s }]));
  return {
    saveSnapshot: vi.fn().mockImplementation((snap: AgentSessionSnapshot) => {
      data.set(snap.ref.sessionId, { ...snap });
      return Promise.resolve();
    }),
    loadSnapshot: vi.fn().mockImplementation((id: string) => Promise.resolve(data.get(id) ?? null)),
    listByRun: vi.fn().mockImplementation(() => Promise.resolve([...data.values()])),
    listAll: vi.fn().mockImplementation(() => Promise.resolve([...data.values()])),
    removeSnapshot: vi.fn().mockImplementation((id: string) => Promise.resolve(data.delete(id))),
  };
}

describe('AgentSessionRegistry', () => {
  let store: AgentSessionStore;
  let registry: AgentSessionRegistry;

  beforeEach(() => {
    store = makeStore();
    registry = new AgentSessionRegistry(store);
  });

  describe('register', () => {
    it('saves snapshot to the store and indexes it', async () => {
      const snap = makeSnapshot();
      await registry.register(snap);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(store.saveSnapshot).toHaveBeenCalledWith(snap);
      expect(registry.get('sess-1')).toEqual(snap);
    });

    it('updates an existing session', async () => {
      const snap1 = makeSnapshot({ state: 'running' });
      const snap2 = makeSnapshot({ state: 'completed' });
      await registry.register(snap1);
      await registry.register(snap2);
      expect(registry.get('sess-1')?.state).toBe('completed');
    });
  });

  describe('get', () => {
    it('returns null for unknown session', () => {
      expect(registry.get('nonexistent')).toBeNull();
    });
  });

  describe('listByRun', () => {
    it('returns all sessions for a run', async () => {
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's1', runId: 'run-1', stateId: 'A', role: 'r', transport: 'stdio' },
        }),
      );
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's2', runId: 'run-1', stateId: 'B', role: 'r', transport: 'stdio' },
        }),
      );
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's3', runId: 'run-2', stateId: 'A', role: 'r', transport: 'stdio' },
        }),
      );

      expect(registry.listByRun('run-1')).toHaveLength(2);
      expect(registry.listByRun('run-2')).toHaveLength(1);
    });

    it('returns empty array for unknown run', () => {
      expect(registry.listByRun('no-run')).toHaveLength(0);
    });
  });

  describe('listByState', () => {
    it('returns sessions matching the given state', async () => {
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's1', runId: 'r', stateId: 'A', role: 'r', transport: 'stdio' },
          state: 'running',
        }),
      );
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's2', runId: 'r', stateId: 'B', role: 'r', transport: 'stdio' },
          state: 'completed',
        }),
      );
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's3', runId: 'r', stateId: 'C', role: 'r', transport: 'stdio' },
          state: 'running',
        }),
      );

      expect(registry.listByState('running')).toHaveLength(2);
      expect(registry.listByState('completed')).toHaveLength(1);
      expect(registry.listByState('failed')).toHaveLength(0);
    });
  });

  describe('listActiveByRun', () => {
    it('excludes terminal states (completed, failed, aborted)', async () => {
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's1', runId: 'run-1', stateId: 'A', role: 'r', transport: 'stdio' },
          state: 'running',
        }),
      );
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's2', runId: 'run-1', stateId: 'B', role: 'r', transport: 'stdio' },
          state: 'completed',
        }),
      );
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's3', runId: 'run-1', stateId: 'C', role: 'r', transport: 'stdio' },
          state: 'failed',
        }),
      );
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's4', runId: 'run-1', stateId: 'D', role: 'r', transport: 'stdio' },
          state: 'aborted',
        }),
      );
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 's5', runId: 'run-1', stateId: 'E', role: 'r', transport: 'stdio' },
          state: 'awaiting_human',
        }),
      );

      const active = registry.listActiveByRun('run-1');
      expect(active).toHaveLength(2);
      expect(active.map((s) => s.ref.sessionId).sort()).toEqual(['s1', 's5']);
    });
  });

  describe('remove', () => {
    it('removes session from store and index', async () => {
      await registry.register(makeSnapshot());
      const result = await registry.remove('sess-1', 'run-1');
      expect(result).toBe(true);
      expect(registry.get('sess-1')).toBeNull();
      expect(registry.listByRun('run-1')).toHaveLength(0);
    });

    it('cleans up the run set when last session is removed', async () => {
      await registry.register(makeSnapshot());
      await registry.remove('sess-1', 'run-1');
      expect(registry.listByRun('run-1')).toHaveLength(0);
    });
  });

  describe('rebuild', () => {
    it('rebuilds the index from the store', async () => {
      const snap = makeSnapshot();
      store = makeStore([snap]);
      registry = new AgentSessionRegistry(store);

      await registry.rebuild();
      expect(registry.get('sess-1')).toEqual(snap);
      expect(registry.listByRun('run-1')).toHaveLength(1);
    });

    it('clears existing index before rebuilding', async () => {
      await registry.register(
        makeSnapshot({
          ref: { sessionId: 'old', runId: 'r', stateId: 'A', role: 'r', transport: 'stdio' },
        }),
      );
      store = makeStore([]);
      registry = new AgentSessionRegistry(store);
      await registry.rebuild();
      expect(registry.get('old')).toBeNull();
    });
  });
});
