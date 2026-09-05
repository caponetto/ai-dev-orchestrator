import type { AgentSessionSnapshot, SessionPendingRequest } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import type { AgentSessionRegistry } from '../agent-session-registry';
import { AgentSessionRequestRouter } from '../agent-session-request-router';
import type { LiveRequestStore } from '../file-backed-live-request-store';

function makePendingRequest(overrides: Partial<SessionPendingRequest> = {}): SessionPendingRequest {
  return {
    requestId: 'req-1',
    kind: 'clarification',
    createdAt: '2026-01-01T00:00:00Z',
    payload: { question: 'What do you want?' },
    ...overrides,
  } as SessionPendingRequest;
}

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

function makeRegistry(overrides: Partial<AgentSessionRegistry> = {}): AgentSessionRegistry {
  return {
    get: vi.fn().mockReturnValue(null),
    listActiveByRun: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as AgentSessionRegistry;
}

function makeLegacyStore(): LiveRequestStore {
  return {} as LiveRequestStore;
}

describe('AgentSessionRequestRouter', () => {
  describe('resolve by sessionId', () => {
    it('returns session result when sessionId and pending request match', () => {
      const pending = makePendingRequest({ requestId: 'req-1' });
      const snap = makeSnapshot({ pendingRequests: [pending] });
      const registry = makeRegistry({ get: vi.fn().mockReturnValue(snap) });
      const router = new AgentSessionRequestRouter(registry);

      const result = router.resolve('run-1', { sessionId: 'sess-1' });
      expect(result.kind).toBe('session');
      if (result.kind === 'session') {
        expect(result.sessionId).toBe('sess-1');
        expect(result.request).toBe(pending);
      }
    });

    it('returns not_found when session does not exist', () => {
      const registry = makeRegistry();
      const router = new AgentSessionRequestRouter(registry);
      const result = router.resolve('run-1', { sessionId: 'nonexistent' });
      expect(result.kind).toBe('not_found');
    });

    it('returns not_found when session runId does not match', () => {
      const snap = makeSnapshot({
        ref: { sessionId: 'sess-1', runId: 'run-2', stateId: 'A', role: 'r', transport: 'stdio' },
      });
      const registry = makeRegistry({ get: vi.fn().mockReturnValue(snap) });
      const router = new AgentSessionRequestRouter(registry);
      const result = router.resolve('run-1', { sessionId: 'sess-1' });
      expect(result.kind).toBe('not_found');
    });

    it('returns not_found when no pending requests', () => {
      const snap = makeSnapshot({ pendingRequests: [] });
      const registry = makeRegistry({ get: vi.fn().mockReturnValue(snap) });
      const router = new AgentSessionRequestRouter(registry);
      const result = router.resolve('run-1', { sessionId: 'sess-1' });
      expect(result.kind).toBe('not_found');
    });

    it('matches by messageId within a session', () => {
      const pending = makePendingRequest({ requestId: 'msg-42' });
      const snap = makeSnapshot({ pendingRequests: [pending] });
      const registry = makeRegistry({ get: vi.fn().mockReturnValue(snap) });
      const router = new AgentSessionRequestRouter(registry);

      const result = router.resolve('run-1', { sessionId: 'sess-1', messageId: 'msg-42' });
      expect(result.kind).toBe('session');
    });
  });

  describe('resolve by messageId (no sessionId)', () => {
    it('finds the session with the matching pending request', () => {
      const pending = makePendingRequest({ requestId: 'msg-99' });
      const snap = makeSnapshot({ pendingRequests: [pending] });
      const registry = makeRegistry({ listActiveByRun: vi.fn().mockReturnValue([snap]) });
      const router = new AgentSessionRequestRouter(registry);

      const result = router.resolve('run-1', { messageId: 'msg-99' });
      expect(result.kind).toBe('session');
    });

    it('falls back to legacy store when no session matches by messageId', () => {
      const registry = makeRegistry({ listActiveByRun: vi.fn().mockReturnValue([]) });
      const router = new AgentSessionRequestRouter(registry, makeLegacyStore());
      const result = router.resolve('run-1', { messageId: 'msg-unknown' });
      expect(result.kind).toBe('legacy');
    });

    it('returns not_found when no legacy store and no match', () => {
      const registry = makeRegistry({ listActiveByRun: vi.fn().mockReturnValue([]) });
      const router = new AgentSessionRequestRouter(registry);
      const result = router.resolve('run-1', { messageId: 'msg-unknown' });
      expect(result.kind).toBe('not_found');
    });
  });

  describe('resolve with no opts', () => {
    it('returns session when exactly one active session has pending requests', () => {
      const pending = makePendingRequest();
      const snap = makeSnapshot({ pendingRequests: [pending] });
      const registry = makeRegistry({ listActiveByRun: vi.fn().mockReturnValue([snap]) });
      const router = new AgentSessionRequestRouter(registry);

      const result = router.resolve('run-1');
      expect(result.kind).toBe('session');
    });

    it('returns ambiguous when multiple sessions have pending requests', () => {
      const snap1 = makeSnapshot({
        ref: { sessionId: 's1', runId: 'run-1', stateId: 'A', role: 'r', transport: 'stdio' },
        pendingRequests: [makePendingRequest()],
      });
      const snap2 = makeSnapshot({
        ref: { sessionId: 's2', runId: 'run-1', stateId: 'B', role: 'r', transport: 'stdio' },
        pendingRequests: [makePendingRequest({ requestId: 'req-2' })],
      });
      const registry = makeRegistry({ listActiveByRun: vi.fn().mockReturnValue([snap1, snap2]) });
      const router = new AgentSessionRequestRouter(registry);

      const result = router.resolve('run-1');
      expect(result.kind).toBe('ambiguous');
      if (result.kind === 'ambiguous') {
        expect(result.candidates).toHaveLength(2);
      }
    });

    it('falls back to legacy when no sessions have pending requests', () => {
      const registry = makeRegistry({ listActiveByRun: vi.fn().mockReturnValue([]) });
      const router = new AgentSessionRequestRouter(registry, makeLegacyStore());
      const result = router.resolve('run-1');
      expect(result.kind).toBe('legacy');
    });

    it('returns not_found when no legacy store and no pending sessions', () => {
      const registry = makeRegistry({ listActiveByRun: vi.fn().mockReturnValue([]) });
      const router = new AgentSessionRequestRouter(registry);
      const result = router.resolve('run-1');
      expect(result.kind).toBe('not_found');
    });
  });
});
