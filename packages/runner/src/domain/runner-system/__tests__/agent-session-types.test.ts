import type {
  AgentSessionHandle,
  AgentSessionRef,
  AgentSessionSnapshot,
  AgentSessionState,
  RemoteReconnectMeta,
  SessionDispatchOutcome,
  SessionPendingRequest,
  StdioReconnectMeta,
} from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

describe('AgentSessionTypes', () => {
  describe('AgentSessionState', () => {
    it('accepts all valid lifecycle states', () => {
      const states: AgentSessionState[] = [
        'running',
        'awaiting_human',
        'paused',
        'reconnecting',
        'completed',
        'failed',
        'aborted',
        'orphaned',
      ];
      expect(states).toHaveLength(8);
    });
  });

  describe('AgentSessionRef', () => {
    it('holds stable session identity', () => {
      const ref: AgentSessionRef = {
        sessionId: 'sess-1',
        runId: 'run-1',
        stateId: 'IMPLEMENTATION',
        role: 'implementer',
        transport: 'stdio',
      };
      expect(ref.sessionId).toBe('sess-1');
      expect(ref.transport).toBe('stdio');
    });

    it('supports remote transport', () => {
      const ref: AgentSessionRef = {
        sessionId: 'sess-2',
        runId: 'run-1',
        stateId: 'REVIEW',
        role: 'reviewer',
        transport: 'remote',
      };
      expect(ref.transport).toBe('remote');
    });
  });

  describe('SessionPendingRequest', () => {
    it('represents a permission request', () => {
      const req: SessionPendingRequest = {
        requestId: 'msg-1',
        kind: 'permission',
        createdAt: '2026-01-01T00:00:00Z',
        payload: { action: 'write_file', resource: '/src/main.ts', riskLevel: 'medium' },
      };
      expect(req.kind).toBe('permission');
      expect(req.payload['action']).toBe('write_file');
    });

    it('represents a clarification request', () => {
      const req: SessionPendingRequest = {
        requestId: 'msg-2',
        kind: 'clarification',
        createdAt: '2026-01-01T00:00:00Z',
        payload: { question: 'Which database?' },
      };
      expect(req.kind).toBe('clarification');
    });
  });

  describe('ReconnectMeta', () => {
    it('represents stdio reconnect metadata', () => {
      const meta: StdioReconnectMeta = {
        type: 'stdio',
        pid: 12345,
        socketPath: '/tmp/session-1.sock',
      };
      expect(meta.type).toBe('stdio');
      expect(meta.pid).toBe(12345);
    });

    it('represents remote reconnect metadata', () => {
      const meta: RemoteReconnectMeta = {
        type: 'remote',
        remoteSessionId: 'remote-sess-1',
        reconnectUrl: 'https://agent.example.com/sessions/remote-sess-1',
        websocketUrl: 'wss://agent.example.com/ws/remote-sess-1',
        leaseExpiresAt: '2026-01-01T01:00:00Z',
        heartbeatIntervalMs: 30_000,
      };
      expect(meta.type).toBe('remote');
      expect(meta.reconnectUrl).toContain('remote-sess-1');
    });

    it('discriminates via type field', () => {
      const meta: StdioReconnectMeta = {
        type: 'stdio',
        pid: 99,
      };
      expect(meta.type).toBe('stdio');
      expect(meta.pid).toBe(99);
    });
  });

  describe('AgentSessionSnapshot', () => {
    it('is JSON-serializable for persistence', () => {
      const snapshot: AgentSessionSnapshot = {
        ref: {
          sessionId: 'sess-1',
          runId: 'run-1',
          stateId: 'IMPLEMENTATION',
          role: 'implementer',
          transport: 'stdio',
        },
        state: 'awaiting_human',
        pendingRequests: [
          {
            requestId: 'msg-1',
            kind: 'permission',
            createdAt: '2026-01-01T00:00:00Z',
            payload: { action: 'write_file' },
          },
        ],
        lastProtocolTimestamp: '2026-01-01T00:00:01Z',
        reconnect: { type: 'stdio', pid: 12345 },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:01Z',
        workerId: 'worker-1',
      };

      const json = JSON.stringify(snapshot);
      const parsed = JSON.parse(json) as AgentSessionSnapshot;
      expect(parsed.ref.sessionId).toBe('sess-1');
      expect(parsed.state).toBe('awaiting_human');
      expect(parsed.pendingRequests).toHaveLength(1);
      expect(parsed.reconnect?.type).toBe('stdio');
    });
  });

  describe('AgentSessionHandle', () => {
    it('provides runtime session access', () => {
      const handle: AgentSessionHandle = {
        ref: {
          sessionId: 'sess-1',
          runId: 'run-1',
          stateId: 'IMPLEMENTATION',
          role: 'implementer',
          transport: 'stdio',
        },
        state: 'running',
        pendingRequests: [],
      };
      expect(handle.state).toBe('running');
      expect(handle.pendingRequests).toHaveLength(0);
    });
  });

  describe('SessionDispatchOutcome', () => {
    it('accepts all valid outcomes', () => {
      const outcomes: SessionDispatchOutcome[] = ['completed', 'awaiting_human', 'session_active'];
      expect(outcomes).toHaveLength(3);
    });
  });
});
