import { EventEmitter } from 'node:events';

import type { AgentSessionRef } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { LocalAgentSessionHost } from '../local-agent-session-host';
import type { StdioProtocolTransport } from '../stdio-protocol-transport';

function makeRef(overrides: Partial<AgentSessionRef> = {}): AgentSessionRef {
  return {
    sessionId: 'sess-1',
    runId: 'run-1',
    stateId: 'IMPL',
    role: 'implementer',
    transport: 'stdio',
    ...overrides,
  };
}

function makeProcess(): EventEmitter & {
  pid: number;
  exitCode: null | number;
  signalCode: null | string;
  kill: ReturnType<typeof vi.fn>;
} {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    exitCode: null | number;
    signalCode: null | string;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.pid = 12345;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.kill = vi.fn();
  return proc;
}

function makeTransport(): StdioProtocolTransport & {
  _messageHandler: ((msg: unknown) => void) | null;
  _rawLineHandler: ((line: string) => void) | null;
  _stderrHandler: ((data: string) => void) | null;
} {
  return {
    _messageHandler: null,
    _rawLineHandler: null,
    _stderrHandler: null,
    onMessage: vi.fn().mockImplementation(function (
      this: ReturnType<typeof makeTransport>,
      cb: (msg: unknown) => void,
    ) {
      this._messageHandler = cb;
    }),
    onRawLine: vi.fn().mockImplementation(function (
      this: ReturnType<typeof makeTransport>,
      cb: (line: string) => void,
    ) {
      this._rawLineHandler = cb;
    }),
    onStderr: vi.fn().mockImplementation(function (
      this: ReturnType<typeof makeTransport>,
      cb: (data: string) => void,
    ) {
      this._stderrHandler = cb;
    }),
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as ReturnType<typeof makeTransport>;
}

vi.mock('../cli-agent-runner', () => ({
  extractUsageFromRawLine: vi.fn().mockReturnValue(null),
}));

describe('LocalAgentSessionHost', () => {
  let proc: ReturnType<typeof makeProcess>;
  let transport: ReturnType<typeof makeTransport>;
  let host: LocalAgentSessionHost;

  beforeEach(() => {
    vi.clearAllMocks();
    proc = makeProcess();
    transport = makeTransport();
    host = new LocalAgentSessionHost(makeRef(), proc as never, transport, Date.now());
  });

  it('starts in running state', () => {
    expect(host.state).toBe('running');
  });

  it('exposes the ref', () => {
    expect(host.ref.sessionId).toBe('sess-1');
  });

  it('exposes pid from the underlying process', () => {
    expect(host.pid).toBe(12345);
  });

  it('starts with no pending requests', () => {
    expect(host.pendingRequests).toHaveLength(0);
  });

  it('isAlive returns true when process has not exited', () => {
    expect(host.isAlive()).toBe(true);
  });

  it('isAlive returns false when process has exited', () => {
    proc.exitCode = 0;
    expect(host.isAlive()).toBe(false);
  });

  describe('stream handlers', () => {
    it('adds and invokes stream handlers on raw lines', () => {
      const handler = vi.fn();
      host.addStreamHandler(handler);
      transport._rawLineHandler?.('some output');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('removes stream handlers', () => {
      const handler = vi.fn();
      host.addStreamHandler(handler);
      host.removeStreamHandler(handler);
      transport._rawLineHandler?.('some output');
      expect(handler).not.toHaveBeenCalled();
    });

    it('swallows errors from handlers', () => {
      const badHandler = vi.fn().mockImplementation(() => {
        throw new Error('handler crash');
      });
      host.addStreamHandler(badHandler);
      expect(() => transport._rawLineHandler?.('output')).not.toThrow();
    });
  });

  describe('sendHumanResponse', () => {
    it('returns false when no pending request matches', () => {
      expect(host.sendHumanResponse('nonexistent', {})).toBe(false);
    });
  });

  describe('abort', () => {
    it('transitions state to aborted', () => {
      host.abort('test reason');
      expect(host.state).toBe('aborted');
    });

    it('sends abort message via transport', () => {
      host.abort('reason');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(transport.send).toHaveBeenCalled();
    });

    it('is idempotent for terminal states', () => {
      host.abort('first');
      host.abort('second');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(transport.send).toHaveBeenCalledTimes(1);
    });

    it('kills the process', () => {
      host.abort('reason');
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('done message handling', () => {
    it('transitions to completed on done message', () => {
      transport._messageHandler?.({
        type: 'done',
        timestamp: '2026-01-01T00:00:00Z',
        messageId: 'msg-1',
        payload: { summary: 'Task completed' },
      });
      expect(host.state).toBe('completed');
    });
  });

  describe('error message handling', () => {
    it('transitions to failed on error message', () => {
      transport._messageHandler?.({
        type: 'error',
        timestamp: '2026-01-01T00:00:00Z',
        messageId: 'msg-1',
        payload: { code: 'ERR_001', message: 'Something went wrong' },
      });
      expect(host.state).toBe('failed');
    });
  });

  describe('process exit handling', () => {
    it('transitions to failed on unexpected exit without artifact', () => {
      proc.emit('exit', 1, null);
      expect(host.state).toBe('failed');
    });
  });

  describe('permission_request handling', () => {
    it('adds pending request and transitions to awaiting_human', () => {
      transport._messageHandler?.({
        type: 'permission_request',
        timestamp: '2026-01-01T00:00:00Z',
        messageId: 'perm-1',
        payload: { action: 'write', resource: '/tmp/file', riskLevel: 'low' },
      });
      expect(host.state).toBe('awaiting_human');
      expect(host.pendingRequests).toHaveLength(1);
      expect(host.pendingRequests[0].kind).toBe('permission');
    });
  });

  describe('clarification_request handling', () => {
    it('adds pending request and transitions to awaiting_human', () => {
      transport._messageHandler?.({
        type: 'clarification_request',
        timestamp: '2026-01-01T00:00:00Z',
        messageId: 'clar-1',
        payload: { question: 'Which framework?' },
      });
      expect(host.state).toBe('awaiting_human');
      expect(host.pendingRequests).toHaveLength(1);
      expect(host.pendingRequests[0].kind).toBe('clarification');
    });
  });

  describe('waitForAdvance', () => {
    it('resolves immediately when already completed', async () => {
      transport._messageHandler?.({
        type: 'done',
        timestamp: '2026-01-01T00:00:00Z',
        messageId: 'msg-1',
        payload: { summary: 'done' },
      });
      const result = await host.waitForAdvance();
      expect(result.kind).toBe('completed');
    });

    it('resolves immediately when already failed', async () => {
      transport._messageHandler?.({
        type: 'error',
        timestamp: '2026-01-01T00:00:00Z',
        messageId: 'msg-1',
        payload: { code: 'ERR', message: 'fail' },
      });
      const result = await host.waitForAdvance();
      expect(result.kind).toBe('failed');
    });
  });
});
