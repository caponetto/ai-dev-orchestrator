import { describe, expect, it } from 'vitest';

import {
  narrowClaudeCodeEvent,
  parseClaudeCodeEvent,
  parseCursorEvent,
  parseOpenCodeEvent,
} from '../external-event-types';

describe('narrowClaudeCodeEvent', () => {
  it('returns event for valid claude code event types', () => {
    const types = [
      'assistant',
      'result',
      'error',
      'tool_use',
      'tool_result',
      'permission_request',
      'permission',
      'control_request',
      'sdk_control_request',
      'clarification_request',
      'clarification',
      'input_request',
    ];
    for (const type of types) {
      const result = narrowClaudeCodeEvent({ type });
      expect(result).not.toBeNull();
      expect(result?.type).toBe(type);
    }
  });

  it('returns null for non-string type', () => {
    expect(narrowClaudeCodeEvent({ type: 123 })).toBeNull();
    expect(narrowClaudeCodeEvent({})).toBeNull();
    expect(narrowClaudeCodeEvent({ type: null })).toBeNull();
  });

  it('returns null for unknown event type', () => {
    expect(narrowClaudeCodeEvent({ type: 'unknown_type' })).toBeNull();
    expect(narrowClaudeCodeEvent({ type: 'system' })).toBeNull();
    expect(narrowClaudeCodeEvent({ type: 'heartbeat' })).toBeNull();
  });
});

describe('parseClaudeCodeEvent', () => {
  it('parses valid claude code JSON event', () => {
    const result = parseClaudeCodeEvent('{"type": "result", "result": "done"}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('result');
  });

  it('returns null for non-JSON lines', () => {
    expect(parseClaudeCodeEvent('plain text')).toBeNull();
    expect(parseClaudeCodeEvent('')).toBeNull();
    expect(parseClaudeCodeEvent('  ')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseClaudeCodeEvent('{broken')).toBeNull();
    expect(parseClaudeCodeEvent('{"type": "result"')).toBeNull();
  });

  it('returns null for valid JSON with unknown type', () => {
    expect(parseClaudeCodeEvent('{"type": "unknown"}')).toBeNull();
  });

  it('handles whitespace-padded input', () => {
    const result = parseClaudeCodeEvent('  {"type": "error", "error": "fail"}  ');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('error');
  });

  it('returns null for JSON arrays', () => {
    expect(parseClaudeCodeEvent('[1, 2, 3]')).toBeNull();
  });
});

describe('parseCursorEvent', () => {
  it('parses valid cursor JSON event', () => {
    const result = parseCursorEvent('{"type": "system", "subtype": "init"}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('system');
  });

  it('parses cursor assistant event', () => {
    const result = parseCursorEvent('{"type": "assistant", "message": {"content": "hi"}}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('assistant');
  });

  it('parses cursor tool_call event', () => {
    const result = parseCursorEvent('{"type": "tool_call", "subtype": "started"}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('tool_call');
  });

  it('parses cursor result event', () => {
    const result = parseCursorEvent('{"type": "result", "duration_ms": 1234}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('result');
  });

  it('returns null for non-JSON lines', () => {
    expect(parseCursorEvent('plain text')).toBeNull();
    expect(parseCursorEvent('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseCursorEvent('{broken')).toBeNull();
  });

  it('returns null for valid JSON with non-cursor event type', () => {
    expect(parseCursorEvent('{"type": "error"}')).toBeNull();
    expect(parseCursorEvent('{"type": "permission_request"}')).toBeNull();
  });

  it('returns null for JSON without type field', () => {
    expect(parseCursorEvent('{"data": "test"}')).toBeNull();
  });

  it('returns null for non-string type', () => {
    expect(parseCursorEvent('{"type": 42}')).toBeNull();
  });

  it('handles whitespace-padded input', () => {
    const result = parseCursorEvent('  {"type": "result"}  ');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('result');
  });
});

describe('parseOpenCodeEvent', () => {
  it('parses step_start event', () => {
    const result = parseOpenCodeEvent(
      '{"type": "step_start", "part": {"id": "p1", "type": "step-start"}}',
    );
    expect(result).not.toBeNull();
    expect(result?.type).toBe('step_start');
  });

  it('parses text event', () => {
    const result = parseOpenCodeEvent(
      '{"type": "text", "part": {"id": "p2", "type": "text", "text": "hello"}}',
    );
    expect(result).not.toBeNull();
    expect(result?.type).toBe('text');
  });

  it('parses tool_use event', () => {
    const result = parseOpenCodeEvent(
      '{"type": "tool_use", "part": {"type": "tool", "tool": "read"}}',
    );
    expect(result).not.toBeNull();
    expect(result?.type).toBe('tool_use');
  });

  it('parses step_finish event with tokens', () => {
    const result = parseOpenCodeEvent(
      JSON.stringify({
        type: 'step_finish',
        part: {
          id: 'p3',
          reason: 'stop',
          tokens: {
            total: 100,
            input: 80,
            output: 20,
            reasoning: 0,
            cache: { read: 10, write: 0 },
          },
        },
      }),
    );
    expect(result).not.toBeNull();
    expect(result?.type).toBe('step_finish');
  });

  it('parses error event', () => {
    const result = parseOpenCodeEvent(
      '{"type": "error", "error": {"name": "Err", "message": "boom"}}',
    );
    expect(result).not.toBeNull();
    expect(result?.type).toBe('error');
  });

  it('returns null for non-JSON or unknown types', () => {
    expect(parseOpenCodeEvent('plain text')).toBeNull();
    expect(parseOpenCodeEvent('{"type": "other_event"}')).toBeNull();
    expect(parseOpenCodeEvent('{broken')).toBeNull();
  });
});
