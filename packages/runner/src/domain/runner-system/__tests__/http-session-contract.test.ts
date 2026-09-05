import { PROTOCOL_VERSION } from '@ai-dev-orchestrator/agent-protocol';
import { describe, it, expect } from 'vitest';

import { parseSubmitResponse, shouldUseProtocolMode } from '../http-session-contract';
import type { AgentSessionDescriptor } from '../http-session-contract';

describe('parseSubmitResponse', () => {
  it('parses minimal response with just taskId', () => {
    const result = parseSubmitResponse({ taskId: 'task-1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.taskId).toBe('task-1');
      expect(result.parsed.session).toBeUndefined();
    }
  });

  it('rejects non-object body', () => {
    expect(parseSubmitResponse('hello').ok).toBe(false);
    expect(parseSubmitResponse(null).ok).toBe(false);
    expect(parseSubmitResponse(42).ok).toBe(false);
  });

  it('rejects missing taskId', () => {
    const result = parseSubmitResponse({ foo: 'bar' });
    expect(result.ok).toBe(false);
  });

  it('rejects empty taskId', () => {
    const result = parseSubmitResponse({ taskId: '' });
    expect(result.ok).toBe(false);
  });

  it('parses response with full session descriptor', () => {
    const result = parseSubmitResponse({
      taskId: 'task-1',
      session: {
        sessionId: 'sess-1',
        protocol: PROTOCOL_VERSION,
        capabilities: ['permission_request'],
        transport: { type: 'websocket', url: 'ws://localhost:8080/ws/sess-1' },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.session?.sessionId).toBe('sess-1');
      expect(result.parsed.session?.protocol).toBe(PROTOCOL_VERSION);
      expect(result.parsed.session?.transport?.type).toBe('websocket');
    }
  });

  it('parses response with transport type none', () => {
    const result = parseSubmitResponse({
      taskId: 'task-1',
      session: {
        sessionId: 'sess-1',
        protocol: PROTOCOL_VERSION,
        transport: { type: 'none' },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.session?.transport?.type).toBe('none');
    }
  });

  it('ignores unknown protocol versions', () => {
    const result = parseSubmitResponse({
      taskId: 'task-1',
      session: {
        sessionId: 'sess-1',
        protocol: 'unknown/v99',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.session?.protocol).toBeUndefined();
    }
  });

  it('rejects session with missing sessionId', () => {
    const result = parseSubmitResponse({
      taskId: 'task-1',
      session: { protocol: PROTOCOL_VERSION },
    });
    expect(result.ok).toBe(false);
  });

  it('ignores malformed transport descriptor', () => {
    const result = parseSubmitResponse({
      taskId: 'task-1',
      session: {
        sessionId: 'sess-1',
        transport: { type: 'websocket' },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.session?.transport).toBeUndefined();
    }
  });
});

describe('shouldUseProtocolMode', () => {
  it('returns true when protocol and websocket transport are advertised', () => {
    const descriptor: AgentSessionDescriptor = {
      sessionId: 'sess-1',
      protocol: PROTOCOL_VERSION,
      transport: { type: 'websocket', url: 'ws://localhost:8080/ws' },
    };
    expect(shouldUseProtocolMode(descriptor)).toBe(true);
  });

  it('returns false when protocol is not set', () => {
    const descriptor: AgentSessionDescriptor = {
      sessionId: 'sess-1',
      transport: { type: 'websocket', url: 'ws://localhost:8080/ws' },
    };
    expect(shouldUseProtocolMode(descriptor)).toBe(false);
  });

  it('returns false when transport is none', () => {
    const descriptor: AgentSessionDescriptor = {
      sessionId: 'sess-1',
      protocol: PROTOCOL_VERSION,
      transport: { type: 'none' },
    };
    expect(shouldUseProtocolMode(descriptor)).toBe(false);
  });

  it('returns false when transport is missing', () => {
    const descriptor: AgentSessionDescriptor = {
      sessionId: 'sess-1',
      protocol: PROTOCOL_VERSION,
    };
    expect(shouldUseProtocolMode(descriptor)).toBe(false);
  });
});
