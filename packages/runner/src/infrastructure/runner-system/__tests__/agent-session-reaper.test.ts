import type { AgentSessionStore } from '@ai-orchestrator/ports';
import type { AgentSessionSnapshot } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { AgentSessionReaper } from '../agent-session-reaper';
import type { ReaperPolicy } from '../agent-session-reaper';

function makeStore(snapshots: AgentSessionSnapshot[]): AgentSessionStore {
  const data = new Map(snapshots.map((s) => [s.ref.sessionId, { ...s }]));

  return {
    saveSnapshot: vi.fn().mockImplementation((snapshot: AgentSessionSnapshot) => {
      data.set(snapshot.ref.sessionId, { ...snapshot });
    }),
    loadSnapshot: vi.fn().mockImplementation((sessionId: string) => {
      return data.get(sessionId) ?? null;
    }),
    listByRun: vi.fn().mockImplementation(() => {
      return [...data.values()];
    }),
    listAll: vi.fn().mockImplementation(() => {
      return [...data.values()];
    }),
    removeSnapshot: vi.fn().mockImplementation((sessionId: string) => {
      return data.delete(sessionId);
    }),
  };
}

function makeSnapshot(overrides: Partial<AgentSessionSnapshot> = {}): AgentSessionSnapshot {
  return {
    ref: {
      sessionId: 'sess-1',
      runId: 'run-1',
      stateId: 'IMPL',
      role: 'implementer',
      transport: 'stdio',
    },
    state: 'running',
    pendingRequests: [],
    lastProtocolTimestamp: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const DEFAULT_POLICY: ReaperPolicy = {
  retentionMs: 60_000,
  reapOrphans: true,
  reapTerminal: true,
};

describe('AgentSessionReaper', () => {
  describe('scanAndMark', () => {
    it('marks stdio sessions with dead processes as orphaned', async () => {
      const store = makeStore([
        makeSnapshot({
          reconnect: { type: 'stdio', pid: 99999 },
        }),
      ]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY, () => false);

      const result = await reaper.scanAndMark('run-1');

      expect(result.scanned).toBe(1);
      expect(result.orphaned).toBe(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(store.saveSnapshot)).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'orphaned' }),
      );
    });

    it('leaves sessions with alive processes untouched', async () => {
      const store = makeStore([
        makeSnapshot({
          reconnect: { type: 'stdio', pid: 12345 },
        }),
      ]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY, () => true);

      const result = await reaper.scanAndMark('run-1');

      expect(result.scanned).toBe(1);
      expect(result.orphaned).toBe(0);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(store.saveSnapshot)).not.toHaveBeenCalled();
    });

    it('skips already terminal sessions', async () => {
      const store = makeStore([
        makeSnapshot({
          state: 'completed',
          reconnect: { type: 'stdio', pid: 99999 },
        }),
      ]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY, () => false);

      const result = await reaper.scanAndMark('run-1');

      expect(result.orphaned).toBe(0);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(store.saveSnapshot)).not.toHaveBeenCalled();
    });

    it('skips already orphaned sessions', async () => {
      const store = makeStore([
        makeSnapshot({
          state: 'orphaned',
          reconnect: { type: 'stdio', pid: 99999 },
        }),
      ]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY, () => false);

      const result = await reaper.scanAndMark('run-1');

      expect(result.orphaned).toBe(0);
    });

    it('marks remote sessions with expired leases as orphaned', async () => {
      const store = makeStore([
        makeSnapshot({
          ref: {
            sessionId: 'sess-r1',
            runId: 'run-1',
            stateId: 'IMPL',
            role: 'implementer',
            transport: 'remote',
          },
          reconnect: {
            type: 'remote',
            remoteSessionId: 'remote-1',
            reconnectUrl: 'https://example.com/reconnect',
            leaseExpiresAt: '2020-01-01T00:00:00Z',
          },
        }),
      ]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY);

      const result = await reaper.scanAndMark('run-1');

      expect(result.orphaned).toBe(1);
    });

    it('leaves remote sessions with valid leases untouched', async () => {
      const future = new Date(Date.now() + 3_600_000).toISOString();
      const store = makeStore([
        makeSnapshot({
          ref: {
            sessionId: 'sess-r2',
            runId: 'run-1',
            stateId: 'IMPL',
            role: 'implementer',
            transport: 'remote',
          },
          reconnect: {
            type: 'remote',
            remoteSessionId: 'remote-2',
            reconnectUrl: 'https://example.com/reconnect',
            leaseExpiresAt: future,
          },
        }),
      ]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY);

      const result = await reaper.scanAndMark('run-1');

      expect(result.orphaned).toBe(0);
    });

    it('marks sessions without reconnect metadata as orphaned', async () => {
      const store = makeStore([makeSnapshot()]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY);

      const result = await reaper.scanAndMark('run-1');

      expect(result.orphaned).toBe(1);
    });
  });

  describe('reap', () => {
    it('removes orphaned sessions when policy allows', async () => {
      const store = makeStore([makeSnapshot({ state: 'orphaned' })]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY);

      const result = await reaper.reap('run-1');

      expect(result.reaped).toBe(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(store.removeSnapshot)).toHaveBeenCalledWith('sess-1', 'run-1');
    });

    it('removes terminal sessions beyond retention', async () => {
      const oldDate = new Date(Date.now() - 120_000).toISOString();
      const store = makeStore([
        makeSnapshot({
          state: 'completed',
          updatedAt: oldDate,
          reconnect: { type: 'stdio', pid: 12345 },
        }),
      ]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY, () => true);

      const result = await reaper.reap('run-1');

      expect(result.reaped).toBe(1);
    });

    it('keeps terminal sessions within retention', async () => {
      const recentDate = new Date().toISOString();
      const store = makeStore([
        makeSnapshot({
          state: 'completed',
          updatedAt: recentDate,
          reconnect: { type: 'stdio', pid: 12345 },
        }),
      ]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY, () => true);

      const result = await reaper.reap('run-1');

      expect(result.reaped).toBe(0);
    });

    it('removes expired sessions regardless of state', async () => {
      const store = makeStore([
        makeSnapshot({
          state: 'running',
          expiresAt: '2020-01-01T00:00:00Z',
          reconnect: { type: 'stdio', pid: 12345 },
        }),
      ]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY, () => true);

      const result = await reaper.reap('run-1');

      expect(result.reaped).toBe(1);
    });

    it('does not remove orphaned sessions when policy disallows', async () => {
      const store = makeStore([makeSnapshot({ state: 'orphaned' })]);
      const policy: ReaperPolicy = { ...DEFAULT_POLICY, reapOrphans: false };
      const reaper = new AgentSessionReaper(store, policy);

      const result = await reaper.reap('run-1');

      expect(result.reaped).toBe(0);
    });

    it('is idempotent - second reap on empty store does nothing', async () => {
      const store = makeStore([makeSnapshot({ state: 'orphaned' })]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY);

      const first = await reaper.reap('run-1');
      expect(first.reaped).toBe(1);

      const second = await reaper.reap('run-1');
      expect(second.reaped).toBe(0);
      expect(second.scanned).toBe(0);
    });

    it('scans and marks before reaping in a single call', async () => {
      const store = makeStore([
        makeSnapshot({
          reconnect: { type: 'stdio', pid: 99999 },
        }),
      ]);
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY, () => false);

      const result = await reaper.reap('run-1');

      expect(result.orphaned).toBe(1);
      expect(result.reaped).toBe(1);
    });

    it('reports errors without crashing', async () => {
      const store = makeStore([makeSnapshot({ state: 'orphaned' })]);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(store.removeSnapshot).mockRejectedValueOnce(new Error('disk full'));
      const reaper = new AgentSessionReaper(store, DEFAULT_POLICY);

      const result = await reaper.reap('run-1');

      expect(result.reaped).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('disk full');
    });
  });
});
