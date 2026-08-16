import type { AgentSessionSupervisor, SessionAdvanceResult } from '@ai-orchestrator/ports';
import type { AgentSessionSnapshot, AgentSessionState } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { CompositeAgentSessionSupervisor } from '../composite-agent-session-supervisor';

function makeSnapshot(sessionId = 'sess-1', runId = 'run-1'): AgentSessionSnapshot {
  return {
    ref: { sessionId, runId, stateId: 'IMPL', role: 'implementer', transport: 'stdio' },
    state: 'running',
    pendingRequests: [],
    lastProtocolTimestamp: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  return result as AgentSessionSnapshot;
}

function makeDelegate(overrides: Partial<AgentSessionSupervisor> = {}): AgentSessionSupervisor {
  return {
    createSession: vi.fn(),
    attach: vi.fn().mockResolvedValue(null),
    sendHumanResponse: vi.fn().mockResolvedValue(false),
    waitForAdvance: vi.fn().mockResolvedValue({ kind: 'failed', error: 'not found' }),
    pause: vi.fn().mockResolvedValue(false),
    abort: vi.fn().mockResolvedValue(false),
    finalize: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockResolvedValue(null),
    getState: vi.fn().mockReturnValue(null),
    listByRun: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('CompositeAgentSessionSupervisor', () => {
  it('throws on createSession', () => {
    const composite = new CompositeAgentSessionSupervisor([]);
    expect(() =>
      composite.createSession({
        sessionId: 's',
        runId: 'r',
        stateId: 'A',
        role: 'r',
        transport: 'stdio',
      }),
    ).toThrow('createSession must be called on a specific supervisor');
  });

  describe('attach', () => {
    it('returns first matching handle from delegates', async () => {
      const handle = { sessionId: 'sess-1' };
      const d1 = makeDelegate();
      const d2 = makeDelegate({ attach: vi.fn().mockResolvedValue(handle) });
      const composite = new CompositeAgentSessionSupervisor([d1, d2]);

      const result = await composite.attach('sess-1');
      expect(result).toBe(handle);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(d1.attach).toHaveBeenCalled();
    });

    it('returns null when no delegate matches', async () => {
      const composite = new CompositeAgentSessionSupervisor([makeDelegate()]);
      expect(await composite.attach('unknown')).toBeNull();
    });
  });

  describe('sendHumanResponse', () => {
    it('returns true when a delegate handles the response', async () => {
      const d1 = makeDelegate();
      const d2 = makeDelegate({ sendHumanResponse: vi.fn().mockResolvedValue(true) });
      const composite = new CompositeAgentSessionSupervisor([d1, d2]);

      expect(await composite.sendHumanResponse('sess-1', 'req-1', {})).toBe(true);
    });

    it('returns false when no delegate handles it', async () => {
      const composite = new CompositeAgentSessionSupervisor([makeDelegate()]);
      expect(await composite.sendHumanResponse('s', 'r', {})).toBe(false);
    });
  });

  describe('waitForAdvance', () => {
    it('delegates to the supervisor that owns the session', async () => {
      const advanceResult: SessionAdvanceResult = { kind: 'completed' };
      const d = makeDelegate({
        getState: vi.fn<[], AgentSessionState | null>().mockReturnValue('running'),
        waitForAdvance: vi.fn().mockResolvedValue(advanceResult),
      });
      const composite = new CompositeAgentSessionSupervisor([d]);

      const result = await composite.waitForAdvance('sess-1');
      expect(result.kind).toBe('completed');
    });

    it('returns failed when no delegate owns the session', async () => {
      const composite = new CompositeAgentSessionSupervisor([makeDelegate()]);
      const result = await composite.waitForAdvance('unknown');
      expect(result.kind).toBe('failed');
    });
  });

  describe('pause', () => {
    it('returns true when a delegate pauses the session', async () => {
      const d = makeDelegate({ pause: vi.fn().mockResolvedValue(true) });
      const composite = new CompositeAgentSessionSupervisor([d]);
      expect(await composite.pause('sess-1')).toBe(true);
    });

    it('returns false when no delegate owns the session', async () => {
      const composite = new CompositeAgentSessionSupervisor([makeDelegate()]);
      expect(await composite.pause('unknown')).toBe(false);
    });
  });

  describe('abort', () => {
    it('returns true when a delegate aborts the session', async () => {
      const d = makeDelegate({ abort: vi.fn().mockResolvedValue(true) });
      const composite = new CompositeAgentSessionSupervisor([d]);
      expect(await composite.abort('sess-1', 'test reason')).toBe(true);
    });

    it('returns false when no delegate handles it', async () => {
      const composite = new CompositeAgentSessionSupervisor([makeDelegate()]);
      expect(await composite.abort('unknown', 'reason')).toBe(false);
    });
  });

  describe('finalize', () => {
    it('finalizes via the owning delegate', async () => {
      const d = makeDelegate({
        getState: vi.fn<[], AgentSessionState | null>().mockReturnValue('completed'),
        finalize: vi.fn().mockResolvedValue(undefined),
      });
      const composite = new CompositeAgentSessionSupervisor([d]);
      await composite.finalize('sess-1');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(d.finalize).toHaveBeenCalledWith('sess-1');
    });

    it('does nothing when no delegate owns the session', async () => {
      const d = makeDelegate();
      const composite = new CompositeAgentSessionSupervisor([d]);
      await composite.finalize('unknown');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(d.finalize).not.toHaveBeenCalled();
    });
  });

  describe('getSnapshot', () => {
    it('returns snapshot from the first matching delegate', async () => {
      const snap = makeSnapshot();
      const d = makeDelegate({ getSnapshot: vi.fn().mockResolvedValue(snap) });
      const composite = new CompositeAgentSessionSupervisor([d]);
      expect(await composite.getSnapshot('sess-1')).toBe(snap);
    });

    it('returns null when no delegate has the session', async () => {
      const composite = new CompositeAgentSessionSupervisor([makeDelegate()]);
      expect(await composite.getSnapshot('unknown')).toBeNull();
    });
  });

  describe('getState', () => {
    it('returns state from the first matching delegate', () => {
      const d1 = makeDelegate();
      const d2 = makeDelegate({ getState: vi.fn().mockReturnValue('running') });
      const composite = new CompositeAgentSessionSupervisor([d1, d2]);
      expect(composite.getState('sess-1')).toBe('running');
    });

    it('returns null when no delegate has the session', () => {
      const composite = new CompositeAgentSessionSupervisor([makeDelegate()]);
      expect(composite.getState('unknown')).toBeNull();
    });
  });

  describe('listByRun', () => {
    it('deduplicates sessions across delegates', async () => {
      const snap = makeSnapshot('sess-1');
      const d1 = makeDelegate({ listByRun: vi.fn().mockResolvedValue([snap]) });
      const d2 = makeDelegate({ listByRun: vi.fn().mockResolvedValue([snap]) });
      const composite = new CompositeAgentSessionSupervisor([d1, d2]);

      const result = await composite.listByRun('run-1');
      expect(result).toHaveLength(1);
    });

    it('merges sessions from different delegates', async () => {
      const snap1 = makeSnapshot('sess-1');
      const snap2 = makeSnapshot('sess-2');
      const d1 = makeDelegate({ listByRun: vi.fn().mockResolvedValue([snap1]) });
      const d2 = makeDelegate({ listByRun: vi.fn().mockResolvedValue([snap2]) });
      const composite = new CompositeAgentSessionSupervisor([d1, d2]);

      const result = await composite.listByRun('run-1');
      expect(result).toHaveLength(2);
    });
  });
});
