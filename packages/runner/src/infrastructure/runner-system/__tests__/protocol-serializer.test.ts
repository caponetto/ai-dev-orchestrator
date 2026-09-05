import {
  PROTOCOL_VERSION,
  createProtocolMessage,
  resetMessageCounter,
} from '@ai-dev-orchestrator/agent-protocol';
import { describe, expect, it, beforeEach } from 'vitest';

import { serializeMessage, deserializeMessage } from '../protocol-serializer';
import type { ParseSuccess, ParseFailure } from '../protocol-serializer';

describe('protocol-serializer', () => {
  beforeEach(() => {
    resetMessageCounter();
  });

  describe('serializeMessage', () => {
    it('produces a JSON string with no embedded newlines', () => {
      const msg = createProtocolMessage('progress', {
        phase: 'test',
        detail: 'line1\nline2',
      });
      const serialized = serializeMessage(msg);
      expect(serialized).not.toContain('\n');
      expect(JSON.parse(serialized)).toEqual(msg);
    });
  });

  describe('round-trip', () => {
    it('deserialize(serialize(msg)) returns ok with the same message', () => {
      const original = createProtocolMessage('handshake', {
        capabilities: ['permission_request'],
      });
      const line = serializeMessage(original);
      const result = deserializeMessage(line);

      expect(result.status).toBe('ok');
      const { message } = result as ParseSuccess;
      expect(message.protocol).toBe(original.protocol);
      expect(message.messageId).toBe(original.messageId);
      expect(message.type).toBe(original.type);
      expect(message.payload).toEqual(original.payload);
    });

    it('preserves replyTo through round-trip', () => {
      const original = createProtocolMessage('permission_response', { granted: true }, 'req-123');
      const line = serializeMessage(original);
      const result = deserializeMessage(line) as ParseSuccess;

      expect(result.status).toBe('ok');
      expect(result.message.replyTo).toBe('req-123');
    });

    it('round-trips all agent-to-orchestrator types', () => {
      const messages = [
        createProtocolMessage('handshake', { capabilities: [] }),
        createProtocolMessage('progress', { phase: 'a', detail: 'b' }),
        createProtocolMessage('permission_request', {
          action: 'file_write',
          resource: 'x',
          detail: 'y',
          riskLevel: 'low',
        }),
        createProtocolMessage('clarification_request', { question: 'q', context: 'c' }),
        createProtocolMessage('artifact', { artifactType: 'code', content: 'x', isFinal: true }),
        createProtocolMessage('log', { level: 'info', message: 'hi' }),
        createProtocolMessage('done', { summary: 'ok' }),
        createProtocolMessage('error', { code: 'ERR', message: 'fail', recoverable: false }),
      ];

      for (const msg of messages) {
        const result = deserializeMessage(serializeMessage(msg));
        expect(result.status).toBe('ok');
        expect((result as ParseSuccess).message.type).toBe(msg.type);
      }
    });

    it('round-trips all orchestrator-to-agent types', () => {
      const messages = [
        createProtocolMessage('handshake_ack', { sessionId: 's1' }),
        createProtocolMessage('permission_response', { granted: false }),
        createProtocolMessage('clarification_response', { answer: 'yes' }),
        createProtocolMessage('abort', { reason: 'cancel' }),
      ];

      for (const msg of messages) {
        const result = deserializeMessage(serializeMessage(msg));
        expect(result.status).toBe('ok');
        expect((result as ParseSuccess).message.type).toBe(msg.type);
      }
    });
  });

  describe('malformed JSON', () => {
    it('returns invalid_json for non-JSON text', () => {
      const result = deserializeMessage('not json at all') as ParseFailure;
      expect(result.status).toBe('invalid_json');
      expect(result.detail).toContain('JSON parse error');
    });

    it('returns invalid_json for empty string', () => {
      const result = deserializeMessage('') as ParseFailure;
      expect(result.status).toBe('invalid_json');
      expect(result.detail).toBe('Empty line');
    });

    it('returns invalid_json for whitespace-only string', () => {
      const result = deserializeMessage('   ') as ParseFailure;
      expect(result.status).toBe('invalid_json');
    });
  });

  describe('invalid envelope', () => {
    it('returns invalid_envelope for JSON array', () => {
      const result = deserializeMessage('[1,2,3]') as ParseFailure;
      expect(result.status).toBe('invalid_envelope');
      expect(result.detail).toBe('Not a JSON object');
    });

    it('returns invalid_envelope for missing protocol', () => {
      const result = deserializeMessage(
        JSON.stringify({ messageId: '1', timestamp: 't', type: 'done', payload: {} }),
      ) as ParseFailure;
      expect(result.status).toBe('invalid_envelope');
      expect(result.detail).toContain('protocol');
    });

    it('returns invalid_envelope for missing messageId', () => {
      const result = deserializeMessage(
        JSON.stringify({ protocol: PROTOCOL_VERSION, timestamp: 't', type: 'done', payload: {} }),
      ) as ParseFailure;
      expect(result.status).toBe('invalid_envelope');
      expect(result.detail).toContain('messageId');
    });

    it('returns invalid_envelope for empty messageId', () => {
      const result = deserializeMessage(
        JSON.stringify({
          protocol: PROTOCOL_VERSION,
          messageId: '',
          timestamp: 't',
          type: 'done',
          payload: {},
        }),
      ) as ParseFailure;
      expect(result.status).toBe('invalid_envelope');
    });

    it('returns invalid_envelope for missing timestamp', () => {
      const result = deserializeMessage(
        JSON.stringify({ protocol: PROTOCOL_VERSION, messageId: '1', type: 'done', payload: {} }),
      ) as ParseFailure;
      expect(result.status).toBe('invalid_envelope');
      expect(result.detail).toContain('timestamp');
    });

    it('returns invalid_envelope for missing type', () => {
      const result = deserializeMessage(
        JSON.stringify({
          protocol: PROTOCOL_VERSION,
          messageId: '1',
          timestamp: 't',
          payload: {},
        }),
      ) as ParseFailure;
      expect(result.status).toBe('invalid_envelope');
      expect(result.detail).toContain('type');
    });

    it('returns invalid_envelope for missing payload', () => {
      const result = deserializeMessage(
        JSON.stringify({
          protocol: PROTOCOL_VERSION,
          messageId: '1',
          timestamp: 't',
          type: 'done',
        }),
      ) as ParseFailure;
      expect(result.status).toBe('invalid_envelope');
      expect(result.detail).toContain('payload');
    });

    it('returns invalid_envelope for array payload', () => {
      const result = deserializeMessage(
        JSON.stringify({
          protocol: PROTOCOL_VERSION,
          messageId: '1',
          timestamp: 't',
          type: 'done',
          payload: [],
        }),
      ) as ParseFailure;
      expect(result.status).toBe('invalid_envelope');
    });

    it('returns invalid_envelope for non-string replyTo', () => {
      const result = deserializeMessage(
        JSON.stringify({
          protocol: PROTOCOL_VERSION,
          messageId: '1',
          timestamp: 't',
          type: 'done',
          payload: {},
          replyTo: 123,
        }),
      ) as ParseFailure;
      expect(result.status).toBe('invalid_envelope');
      expect(result.detail).toContain('replyTo');
    });
  });

  describe('version mismatch', () => {
    it('returns version_mismatch for wrong protocol version', () => {
      const result = deserializeMessage(
        JSON.stringify({
          protocol: 'ado/agent/v99',
          messageId: '1',
          timestamp: 't',
          type: 'done',
          payload: {},
        }),
      ) as ParseFailure;
      expect(result.status).toBe('version_mismatch');
      expect(result.detail).toContain('v99');
    });
  });

  describe('reply correlation', () => {
    it('accepts valid replyTo matching a known outbound ID', () => {
      const msg = createProtocolMessage('permission_response', { granted: true }, 'outbound-1');
      const line = serializeMessage(msg);
      const result = deserializeMessage(line, new Set(['outbound-1']));
      expect(result.status).toBe('ok');
    });

    it('rejects replyTo not in knownOutboundIds', () => {
      const msg = createProtocolMessage('permission_response', { granted: true }, 'unknown-id');
      const line = serializeMessage(msg);
      const result = deserializeMessage(line, new Set(['outbound-1'])) as ParseFailure;
      expect(result.status).toBe('invalid_reply');
      expect(result.detail).toContain('unknown-id');
    });

    it('skips replyTo validation when knownOutboundIds is not provided', () => {
      const msg = createProtocolMessage('permission_response', { granted: true }, 'any-id');
      const line = serializeMessage(msg);
      const result = deserializeMessage(line);
      expect(result.status).toBe('ok');
    });

    it('accepts messages without replyTo regardless of knownOutboundIds', () => {
      const msg = createProtocolMessage('progress', { phase: 'test', detail: 'ok' });
      const line = serializeMessage(msg);
      const result = deserializeMessage(line, new Set(['outbound-1']));
      expect(result.status).toBe('ok');
    });
  });

  describe('unknown message type', () => {
    it('returns unknown_type for unrecognized type string', () => {
      const result = deserializeMessage(
        JSON.stringify({
          protocol: PROTOCOL_VERSION,
          messageId: '1',
          timestamp: 't',
          type: 'future_type_v3',
          payload: {},
        }),
      ) as ParseFailure;
      expect(result.status).toBe('unknown_type');
      expect(result.detail).toContain('future_type_v3');
    });
  });
});
