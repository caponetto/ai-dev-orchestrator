import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_TO_ORCHESTRATOR_TYPES,
  ALL_MESSAGE_TYPES,
  KNOWN_CAPABILITIES,
  ORCHESTRATOR_TO_AGENT_TYPES,
  PROTOCOL_VERSION,
  createProtocolMessage,
  payloadToRecord,
  resetMessageCounter,
} from '../agent-protocol-types';

afterEach(() => {
  resetMessageCounter();
});

describe('constants', () => {
  it('has correct protocol version', () => {
    expect(PROTOCOL_VERSION).toBe('ado/agent/v1');
  });

  it('defines known capabilities', () => {
    expect(KNOWN_CAPABILITIES).toContain('permission_request');
    expect(KNOWN_CAPABILITIES).toContain('clarification_request');
    expect(KNOWN_CAPABILITIES).toContain('streaming_artifact');
    expect(KNOWN_CAPABILITIES).toContain('structured_log');
    expect(KNOWN_CAPABILITIES).toHaveLength(4);
  });

  it('defines agent-to-orchestrator message types', () => {
    expect(AGENT_TO_ORCHESTRATOR_TYPES).toEqual([
      'handshake',
      'progress',
      'permission_request',
      'clarification_request',
      'artifact',
      'log',
      'done',
      'error',
    ]);
  });

  it('defines orchestrator-to-agent message types', () => {
    expect(ORCHESTRATOR_TO_AGENT_TYPES).toEqual([
      'handshake_ack',
      'permission_response',
      'clarification_response',
      'abort',
    ]);
  });

  it('ALL_MESSAGE_TYPES is the union of both directions', () => {
    expect(ALL_MESSAGE_TYPES).toEqual([
      ...AGENT_TO_ORCHESTRATOR_TYPES,
      ...ORCHESTRATOR_TO_AGENT_TYPES,
    ]);
  });
});

describe('createProtocolMessage', () => {
  it('creates a message with correct structure', () => {
    const msg = createProtocolMessage('handshake', { capabilities: ['permission_request'] });

    expect(msg.protocol).toBe(PROTOCOL_VERSION);
    expect(msg.type).toBe('handshake');
    expect(msg.payload).toEqual({ capabilities: ['permission_request'] });
    expect(msg.messageId).toMatch(/^msg-\d+-[a-z0-9]+$/);
    expect(msg.timestamp).toBeTruthy();
    expect(msg.replyTo).toBeUndefined();
  });

  it('includes replyTo when provided', () => {
    const msg = createProtocolMessage('handshake_ack', { sessionId: 's1' }, 'msg-1-abc');
    expect(msg.replyTo).toBe('msg-1-abc');
  });

  it('omits replyTo key entirely when not provided', () => {
    const msg = createProtocolMessage('done', { summary: 'ok' });
    expect('replyTo' in msg).toBe(false);
  });

  it('increments message counter across calls', () => {
    const msg1 = createProtocolMessage('done', { summary: 'a' });
    const msg2 = createProtocolMessage('done', { summary: 'b' });

    const id1 = msg1.messageId.split('-')[1];
    const id2 = msg2.messageId.split('-')[1];
    expect(Number(id2)).toBeGreaterThan(Number(id1));
  });

  it('generates valid ISO timestamp', () => {
    const msg = createProtocolMessage('done', { summary: 'ok' });
    expect(() => new Date(msg.timestamp)).not.toThrow();
    expect(new Date(msg.timestamp).toISOString()).toBe(msg.timestamp);
  });
});

describe('resetMessageCounter', () => {
  it('resets the counter so next message starts from 1', () => {
    createProtocolMessage('done', { summary: 'a' });
    createProtocolMessage('done', { summary: 'b' });
    resetMessageCounter();

    const msg = createProtocolMessage('done', { summary: 'c' });
    expect(msg.messageId).toMatch(/^msg-1-/);
  });
});

describe('payloadToRecord', () => {
  it('converts a typed payload to a record', () => {
    const payload = { action: 'file_read' as const, resource: '/tmp', detail: 'reading' };
    const record = payloadToRecord(payload);

    expect(record['action']).toBe('file_read');
    expect(record['resource']).toBe('/tmp');
  });

  it('returns a readonly record', () => {
    const record = payloadToRecord({ key: 'value' });
    expect(record['key']).toBe('value');
  });
});
