import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { describe, expect, it } from 'vitest';

import { CursorCliAdapter, createCursorCliAdapter } from '../cursor-cli-adapter';

function assertMessage(msg: ProtocolMessage | null): ProtocolMessage {
  expect(msg).not.toBeNull();
  return msg as ProtocolMessage;
}

describe('CursorCliAdapter', () => {
  describe('constructor', () => {
    it('uses streaming args by default', () => {
      const adapter = new CursorCliAdapter();
      expect(adapter.name).toBe('cursor');
      expect(adapter.command).toBe('agent');
      expect(adapter.args).toContain('--print');
      expect(adapter.args).toContain('--force');
      expect(adapter.args).toContain('--trust');
      expect(adapter.args).toContain('--approve-mcps');
      expect(adapter.args).toContain('--output-format');
      expect(adapter.args).toContain('stream-json');
      expect(adapter.getMode()).toBe('streaming');
    });

    it('uses text-only args when configured', () => {
      const adapter = new CursorCliAdapter({ mode: 'text-only' });
      expect(adapter.args).toContain('--print');
      expect(adapter.args).toContain('--force');
      expect(adapter.args).toContain('--trust');
      expect(adapter.args).toContain('--approve-mcps');
      expect(adapter.args).not.toContain('--output-format');
      expect(adapter.getMode()).toBe('text-only');
    });
  });

  describe('translateOutput', () => {
    const adapter = new CursorCliAdapter();

    it('ignores non-JSON lines', () => {
      expect(adapter.translateOutput('plain text')).toBeNull();
      expect(adapter.translateOutput('')).toBeNull();
    });

    it('ignores malformed JSON', () => {
      expect(adapter.translateOutput('{bad json')).toBeNull();
    });

    it('maps system init event to progress', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'gpt-4o',
      });
      const msg = assertMessage(adapter.translateOutput(line));
      expect(msg.type).toBe('progress');
      expect((msg.payload as { detail: string }).detail).toContain('gpt-4o');
    });

    it('ignores non-init system events', () => {
      const line = JSON.stringify({ type: 'system', subtype: 'other' });
      expect(adapter.translateOutput(line)).toBeNull();
    });

    it('maps assistant event with message.content string', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { content: 'thinking...' },
      });
      const msg = assertMessage(adapter.translateOutput(line));
      expect(msg.type).toBe('progress');
      expect((msg.payload as { phase: string }).phase).toBe('generating');
    });

    it('maps assistant event with content array', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'hello' }],
        },
      });
      const msg = assertMessage(adapter.translateOutput(line));
      expect((msg.payload as { detail: string }).detail).toBe('hello');
    });

    it('ignores assistant event with empty content', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { content: '' },
      });
      expect(adapter.translateOutput(line)).toBeNull();
    });

    it('maps tool_call started event', () => {
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        tool_call: { writeToolCall: { args: { path: 'foo.ts' } } },
      });
      const msg = assertMessage(adapter.translateOutput(line));
      expect(msg.type).toBe('progress');
      expect((msg.payload as { phase: string }).phase).toBe('tool_call');
      expect((msg.payload as { detail: string }).detail).toBe('write');
    });

    it('maps tool_call completed event', () => {
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        tool_call: { readToolCall: { args: {} } },
      });
      const msg = assertMessage(adapter.translateOutput(line));
      expect((msg.payload as { phase: string }).phase).toBe('tool_result');
      expect((msg.payload as { detail: string }).detail).toBe('read');
    });

    it('maps result event to done', () => {
      const line = JSON.stringify({
        type: 'result',
        duration_ms: 5432,
      });
      const msg = assertMessage(adapter.translateOutput(line));
      expect(msg.type).toBe('done');
      expect((msg.payload as { summary: string }).summary).toContain('5432');
    });

    it('ignores unknown event types', () => {
      const line = JSON.stringify({ type: 'unknown_event' });
      expect(adapter.translateOutput(line)).toBeNull();
    });
  });

  describe('translateOutput - assistant event edge cases', () => {
    it('returns null when assistant event has no message', () => {
      const adapter = new CursorCliAdapter();
      const line = JSON.stringify({ type: 'assistant' });
      expect(adapter.translateOutput(line)).toBeNull();
    });

    it('returns null when assistant event has empty content array', () => {
      const adapter = new CursorCliAdapter();
      const line = JSON.stringify({
        type: 'assistant',
        message: { content: [] },
      });
      expect(adapter.translateOutput(line)).toBeNull();
    });

    it('returns null when content array has only non-text blocks', () => {
      const adapter = new CursorCliAdapter();
      const line = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'image', url: 'http://x' }] },
      });
      expect(adapter.translateOutput(line)).toBeNull();
    });

    it('returns null when message has no content property', () => {
      const adapter = new CursorCliAdapter();
      const line = JSON.stringify({ type: 'assistant', message: {} });
      expect(adapter.translateOutput(line)).toBeNull();
    });
  });

  describe('translateOutput - tool_call edge cases', () => {
    it('returns null for tool_call with unknown subtype', () => {
      const adapter = new CursorCliAdapter();
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'progress',
        tool_call: { readToolCall: {} },
      });
      expect(adapter.translateOutput(line)).toBeNull();
    });

    it('returns unknown when tool_call payload is missing', () => {
      const adapter = new CursorCliAdapter();
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
      });
      const msg = assertMessage(adapter.translateOutput(line));
      expect((msg.payload as { detail: string }).detail).toBe('unknown');
    });

    it('falls back to tool_call.name when no *ToolCall key found', () => {
      const adapter = new CursorCliAdapter();
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        tool_call: { name: 'custom_tool', args: {} },
      });
      const msg = assertMessage(adapter.translateOutput(line));
      expect((msg.payload as { detail: string }).detail).toBe('custom_tool');
    });

    it('returns unknown when tool_call has no matching key and no name', () => {
      const adapter = new CursorCliAdapter();
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        tool_call: { args: {} },
      });
      const msg = assertMessage(adapter.translateOutput(line));
      expect((msg.payload as { detail: string }).detail).toBe('unknown');
    });
  });

  describe('translateOutput - result event edge cases', () => {
    it('uses completed without duration when duration_ms is missing', () => {
      const adapter = new CursorCliAdapter();
      const line = JSON.stringify({ type: 'result' });
      const msg = assertMessage(adapter.translateOutput(line));
      expect(msg.type).toBe('done');
      expect((msg.payload as { summary: string }).summary).toBe('completed');
    });
  });

  describe('translateOutput - system event edge cases', () => {
    it('uses unknown when system init event has no model', () => {
      const adapter = new CursorCliAdapter();
      const line = JSON.stringify({ type: 'system', subtype: 'init' });
      const msg = assertMessage(adapter.translateOutput(line));
      expect((msg.payload as { detail: string }).detail).toContain('unknown');
    });
  });

  describe('translateInput', () => {
    it('always returns null (no stdin support)', () => {
      const adapter = new CursorCliAdapter();
      // Cursor CLI does not support stdin responses
      const result = adapter.translateInput({
        protocol: 'ado/agent/v1',
        messageId: 'test-1',
        timestamp: new Date().toISOString(),
        type: 'permission_response',
        payload: { granted: true },
      });
      expect(result).toBeNull();
    });
  });
});

describe('createCursorCliAdapter', () => {
  it('creates streaming adapter when structuredIO is true', () => {
    const adapter = createCursorCliAdapter({
      structuredIO: true,
      permissionEvents: false,
      clarificationEvents: false,
      stdinResponses: false,
    });
    expect(adapter.getMode()).toBe('streaming');
  });

  it('creates text-only adapter when structuredIO is false', () => {
    const adapter = createCursorCliAdapter({
      structuredIO: false,
      permissionEvents: false,
      clarificationEvents: false,
      stdinResponses: false,
    });
    expect(adapter.getMode()).toBe('text-only');
  });
});
