import { createProtocolMessage, PROTOCOL_VERSION } from '@ai-dev-orchestrator/agent-protocol';
import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter, createClaudeCodeAdapter } from '../claude-code-adapter';

describe('ClaudeCodeAdapter', () => {
  describe('constructor', () => {
    it('defaults to experimental mode', () => {
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.getMode()).toBe('experimental');
      expect(adapter.command).toBe('claude');
      expect(adapter.args).toContain('--print');
    });

    it('uses native args when mode is native', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      expect(adapter.getMode()).toBe('native');
      expect(adapter.args).toContain('--input-format');
      expect(adapter.args).toContain('--verbose');
      expect(adapter.args).toContain('--permission-prompt-tool');
      expect(adapter.args).not.toContain('--print');
    });

    it('uses text-only args without --output-format', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'text-only' });
      expect(adapter.getMode()).toBe('text-only');
      expect(adapter.args).toEqual(['--print']);
      expect(adapter.args).not.toContain('--output-format');
    });
  });

  describe('translateOutput', () => {
    it('returns null for non-JSON lines', () => {
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.translateOutput('plain text')).toBeNull();
      expect(adapter.translateOutput('')).toBeNull();
    });

    it('passes through native protocol messages', () => {
      const adapter = new ClaudeCodeAdapter();
      const msg = createProtocolMessage('progress', { phase: 'test', detail: 'hi' });
      const result = adapter.translateOutput(JSON.stringify(msg));
      if (result === null) {
        throw new Error('expected non-null result');
      }
      expect(result.protocol).toBe(PROTOCOL_VERSION);
      expect(result.type).toBe('progress');
    });

    it('maps Claude Code result event to done message', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'result', result: 'Task completed successfully' };
      const result = adapter.translateOutput(JSON.stringify(event));
      if (result === null) {
        throw new Error('expected non-null result');
      }
      expect(result.type).toBe('done');
      expect((result.payload as { summary: string }).summary).toBe('Task completed successfully');
    });

    it('maps Claude Code error event to error message', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'error', error: 'Something broke' };
      const result = adapter.translateOutput(JSON.stringify(event));
      if (result === null) {
        throw new Error('expected non-null result');
      }
      expect(result.type).toBe('error');
      expect((result.payload as { message: string }).message).toBe('Something broke');
    });

    it('maps tool_use event to progress message', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'tool_use', name: 'Read' };
      const result = adapter.translateOutput(JSON.stringify(event));
      if (result === null) {
        throw new Error('expected non-null result');
      }
      expect(result.type).toBe('progress');
      expect((result.payload as { phase: string }).phase).toBe('tool_call');
    });

    it('maps permission_request event to permission_request message', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'Bash', resource: 'rm -rf /' };
      const result = adapter.translateOutput(JSON.stringify(event));
      if (result === null) {
        throw new Error('expected non-null result');
      }
      expect(result.type).toBe('permission_request');
    });

    it('maps clarification_request event when clarificationEvents confirmed', () => {
      const adapter = new ClaudeCodeAdapter({
        mode: 'experimental',
        capabilities: {
          structuredIO: true,
          permissionEvents: true,
          clarificationEvents: true,
          stdinResponses: false,
        },
      });
      const event = {
        type: 'clarification_request',
        question: 'Which database?',
        context: 'setup',
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      if (result === null) {
        throw new Error('expected non-null result');
      }
      expect(result.type).toBe('clarification_request');
      expect((result.payload as { question: string }).question).toBe('Which database?');
      expect((result.payload as { context: string }).context).toBe('setup');
    });

    it('drops clarification_request event when clarificationEvents not confirmed', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'experimental' });
      const event = {
        type: 'clarification_request',
        question: 'Which database?',
        context: 'setup',
      };
      expect(adapter.translateOutput(JSON.stringify(event))).toBeNull();
    });

    it('maps input_request event when clarificationEvents confirmed', () => {
      const adapter = new ClaudeCodeAdapter({
        mode: 'experimental',
        capabilities: {
          structuredIO: true,
          permissionEvents: true,
          clarificationEvents: true,
          stdinResponses: false,
        },
      });
      const event = { type: 'input_request', message: 'Provide credentials' };
      const result = adapter.translateOutput(JSON.stringify(event));
      if (result === null) {
        throw new Error('expected non-null result');
      }
      expect(result.type).toBe('clarification_request');
      expect((result.payload as { question: string }).question).toBe('Provide credentials');
    });

    it('drops input_request event when clarificationEvents not confirmed', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'experimental' });
      const event = { type: 'input_request', message: 'Provide credentials' };
      expect(adapter.translateOutput(JSON.stringify(event))).toBeNull();
    });

    it('drops native protocol clarification_request when clarificationEvents not confirmed', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('clarification_request', {
        question: 'Which DB?',
        context: '',
      });
      expect(adapter.translateOutput(JSON.stringify(msg))).toBeNull();
    });

    it('passes native protocol clarification_request when clarificationEvents confirmed', () => {
      const adapter = new ClaudeCodeAdapter({
        mode: 'native',
        capabilities: {
          structuredIO: true,
          permissionEvents: true,
          clarificationEvents: true,
          stdinResponses: true,
        },
      });
      const msg = createProtocolMessage('clarification_request', {
        question: 'Which DB?',
        context: '',
      });
      const result = adapter.translateOutput(JSON.stringify(msg));
      expect(result).not.toBeNull();
      expect(result?.type).toBe('clarification_request');
    });

    it('passes native protocol permission_request regardless of clarificationEvents', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('permission_request', {
        action: 'file_write',
        resource: '/tmp/x',
        detail: '',
        riskLevel: 'medium',
      });
      const result = adapter.translateOutput(JSON.stringify(msg));
      expect(result).not.toBeNull();
      expect(result?.type).toBe('permission_request');
    });

    it('returns null for unrecognized JSON', () => {
      const adapter = new ClaudeCodeAdapter();
      const result = adapter.translateOutput(JSON.stringify({ unrelated: true }));
      expect(result).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.translateOutput('{broken')).toBeNull();
    });
  });

  describe('translateInput', () => {
    it('maps permission_response to control_response in native mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('permission_response', {
        granted: true,
        externalRequestId: 'req_1',
      });
      const result = adapter.translateInput(msg);
      expect(result).not.toBeNull();
      if (result === null) {
        throw new Error('expected non-null result');
      }
      const parsed = JSON.parse(result) as Record<string, unknown>;
      expect(parsed['type']).toBe('control_response');
    });

    it('drops clarification_response in native mode when clarificationEvents not confirmed', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('clarification_response', { answer: 'yes' });
      expect(adapter.translateInput(msg)).toBeNull();
    });

    it('passes clarification_response in native mode when clarificationEvents confirmed', () => {
      const adapter = new ClaudeCodeAdapter({
        mode: 'native',
        capabilities: {
          structuredIO: true,
          permissionEvents: true,
          clarificationEvents: true,
          stdinResponses: true,
        },
      });
      const msg = createProtocolMessage('clarification_response', { answer: 'yes' });
      const result = adapter.translateInput(msg);
      if (result === null) {
        throw new Error('expected non-null result');
      }
      const parsed = JSON.parse(result) as Record<string, unknown>;
      expect(parsed['protocol']).toBe(PROTOCOL_VERSION);
      expect(parsed['type']).toBe('clarification_response');
    });

    it('maps permission_response in experimental mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'experimental' });
      const msg = createProtocolMessage('permission_response', { granted: false });
      const result = adapter.translateInput(msg);
      if (result === null) {
        throw new Error('expected non-null result');
      }
      const parsed = JSON.parse(result) as { type: string; granted: boolean };
      expect(parsed.type).toBe('permission_response');
      expect(parsed.granted).toBe(false);
    });

    it('maps clarification_response in experimental mode when clarificationEvents confirmed', () => {
      const adapter = new ClaudeCodeAdapter({
        mode: 'experimental',
        capabilities: {
          structuredIO: true,
          permissionEvents: true,
          clarificationEvents: true,
          stdinResponses: false,
        },
      });
      const msg = createProtocolMessage('clarification_response', { answer: 'yes please' });
      const result = adapter.translateInput(msg);
      if (result === null) {
        throw new Error('expected non-null result');
      }
      const parsed = JSON.parse(result) as { type: string; answer: string };
      expect(parsed.type).toBe('clarification_response');
      expect(parsed.answer).toBe('yes please');
    });

    it('drops clarification_response in experimental mode when clarificationEvents not confirmed', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'experimental' });
      const msg = createProtocolMessage('clarification_response', { answer: 'yes please' });
      expect(adapter.translateInput(msg)).toBeNull();
    });

    it('maps abort in experimental mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'experimental' });
      const msg = createProtocolMessage('abort', { reason: 'cancel' });
      const result = adapter.translateInput(msg);
      if (result === null) {
        throw new Error('expected non-null result');
      }
      const parsed = JSON.parse(result) as { type: string };
      expect(parsed.type).toBe('abort');
    });

    it('returns null for unsupported message types in experimental mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'experimental' });
      const msg = createProtocolMessage('handshake_ack', { sessionId: 's1' });
      expect(adapter.translateInput(msg)).toBeNull();
    });

    it('returns null for all message types in text-only mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'text-only' });
      expect(
        adapter.translateInput(createProtocolMessage('permission_response', { granted: true })),
      ).toBeNull();
      expect(
        adapter.translateInput(createProtocolMessage('clarification_response', { answer: 'yes' })),
      ).toBeNull();
      expect(
        adapter.translateInput(createProtocolMessage('abort', { reason: 'cancel' })),
      ).toBeNull();
    });
  });

  describe('sendPrompt', () => {
    it('returns formatted stdin JSON message in native mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const result = adapter.sendPrompt('Do the thing');
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as {
        type: string;
        message: { role: string; content: string };
      };
      expect(parsed.type).toBe('user');
      expect(parsed.message.role).toBe('user');
      expect(parsed.message.content).toBe('Do the thing');
    });

    it('returns null in experimental mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'experimental' });
      expect(adapter.sendPrompt('Do the thing')).toBeNull();
    });

    it('returns null in text-only mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'text-only' });
      expect(adapter.sendPrompt('Do the thing')).toBeNull();
    });
  });

  describe('promptViaStdin', () => {
    it('is true for native mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      expect(adapter.promptViaStdin).toBe(true);
    });

    it('is false for experimental mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'experimental' });
      expect(adapter.promptViaStdin).toBe(false);
    });

    it('is false for text-only mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'text-only' });
      expect(adapter.promptViaStdin).toBe(false);
    });
  });

  describe('translateOutput - control_request events', () => {
    it('maps control_request to permission_request', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'perm_123',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          tool_input: { command: 'rm -rf /' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect(result?.type).toBe('permission_request');
      const payload = result?.payload as {
        action: string;
        resource: string;
        externalRequestId: string;
        toolInput: Record<string, unknown>;
      };
      expect(payload.externalRequestId).toBe('perm_123');
      expect(payload.resource).toBe('rm -rf /');
      expect(payload.toolInput).toEqual({ command: 'rm -rf /' });
    });

    it('maps sdk_control_request to permission_request', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'sdk_control_request',
        request_id: 'perm_456',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/foo.txt' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect(result?.type).toBe('permission_request');
      const payload = result?.payload as { resource: string; externalRequestId: string };
      expect(payload.externalRequestId).toBe('perm_456');
      expect(payload.resource).toBe('/tmp/foo.txt');
    });

    it('returns null for control_request with non-can_use_tool subtype', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'perm_789',
        request: { subtype: 'other_thing' },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).toBeNull();
    });
  });

  describe('translateInput - native mode permission_response', () => {
    it('maps permission_response to control_response format with allow', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('permission_response', {
        granted: true,
        reason: 'Policy allows',
        externalRequestId: 'perm_123',
        toolInput: { command: 'ls' },
      });
      const result = adapter.translateInput(msg);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as {
        type: string;
        request_id: string;
        response: {
          subtype: string;
          request_id: string;
          response: { behavior: string; updatedInput: Record<string, unknown> };
        };
      };
      expect(parsed.type).toBe('control_response');
      expect(parsed.request_id).toBe('perm_123');
      expect(parsed.response.subtype).toBe('success');
      expect(parsed.response.request_id).toBe('perm_123');
      expect(parsed.response.response.behavior).toBe('allow');
      expect(parsed.response.response.updatedInput).toEqual({ command: 'ls' });
    });

    it('maps permission_response to control_response format with deny', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('permission_response', {
        granted: false,
        reason: 'Too risky',
        externalRequestId: 'perm_456',
      });
      const result = adapter.translateInput(msg);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as {
        type: string;
        request_id: string;
        response: {
          subtype: string;
          request_id: string;
          response: { behavior: string; message: string };
        };
      };
      expect(parsed.type).toBe('control_response');
      expect(parsed.request_id).toBe('perm_456');
      expect(parsed.response.subtype).toBe('success');
      expect(parsed.response.request_id).toBe('perm_456');
      expect(parsed.response.response.behavior).toBe('deny');
      expect(parsed.response.response.message).toBe('Too risky');
    });

    it('maps abort in native mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('abort', { reason: 'cancel' });
      const result = adapter.translateInput(msg);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as { type: string };
      expect(parsed.type).toBe('abort');
    });
  });

  describe('translateOutput - assistant event edge cases', () => {
    it('returns null when assistant event has no message', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'assistant' };
      expect(adapter.translateOutput(JSON.stringify(event))).toBeNull();
    });

    it('returns null when assistant event has empty string content', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'assistant', message: { content: '' } };
      expect(adapter.translateOutput(JSON.stringify(event))).toBeNull();
    });

    it('returns null when assistant event has empty content array', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'assistant', message: { content: [] } };
      expect(adapter.translateOutput(JSON.stringify(event))).toBeNull();
    });

    it('returns null when content array has only non-text blocks', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = {
        type: 'assistant',
        message: { content: [{ type: 'image', url: 'http://x' }] },
      };
      expect(adapter.translateOutput(JSON.stringify(event))).toBeNull();
    });

    it('extracts text from content array with mixed block types', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'hello ' },
            { type: 'image', url: 'http://x' },
            { type: 'text', text: 'world' },
          ],
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { detail: string }).detail).toBe('hello world');
    });

    it('returns null when message has no content property', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'assistant', message: {} };
      expect(adapter.translateOutput(JSON.stringify(event))).toBeNull();
    });
  });

  describe('translateOutput - error event edge cases', () => {
    it('falls back to message field when error field is missing', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'error', message: 'fallback error message' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { message: string }).message).toBe('fallback error message');
    });

    it('falls back to unknown error when both error and message are missing', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'error' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { message: string }).message).toBe('unknown error');
    });
  });

  describe('translateOutput - result event edge cases', () => {
    it('uses completed as default summary when result field is missing', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'result' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { summary: string }).summary).toBe('completed');
    });
  });

  describe('translateOutput - tool_result events', () => {
    it('maps tool_result event with tool field to progress with tool_result phase', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'tool_result', tool: 'Write' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { phase: string }).phase).toBe('tool_result');
      expect((result?.payload as { detail: string }).detail).toBe('Write');
    });

    it('falls back to unknown when tool_result has neither name nor tool', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'tool_result' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { detail: string }).detail).toBe('unknown');
    });

    it('falls back to tool field when name is missing on tool_use', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'tool_use', tool: 'Bash' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { detail: string }).detail).toBe('Bash');
    });
  });

  describe('translateOutput - permission event action categorization', () => {
    it('categorizes read tools as file_read', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'Read', resource: '/tmp/file.txt' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('file_read');
    });

    it('categorizes view tools as file_read', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'FileViewer', resource: '/tmp/file.txt' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('file_read');
    });

    it('categorizes cat tools as file_read', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'cat', resource: '/tmp/file.txt' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('file_read');
    });

    it('categorizes write tools as file_write', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'Write', resource: '/tmp/file.txt' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('file_write');
    });

    it('categorizes edit tools as file_write', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'Edit', resource: '/tmp/file.txt' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('file_write');
    });

    it('categorizes delete tools as file_delete', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'DeleteFile', resource: '/tmp/file.txt' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('file_delete');
    });

    it('categorizes rm tools as file_delete', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'rm', resource: '/tmp/file.txt' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('file_delete');
    });

    it('categorizes shell tools as shell_execute', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'Bash', resource: 'ls' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('shell_execute');
    });

    it('categorizes fetch tools as network_request', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = {
        type: 'permission_request',
        tool: 'WebFetch',
        resource: 'https://example.com',
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('network_request');
    });

    it('categorizes curl tools as network_request', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = {
        type: 'permission_request',
        tool: 'curl',
        resource: 'https://example.com',
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('network_request');
    });

    it('categorizes http tools as network_request', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = {
        type: 'permission_request',
        tool: 'HttpRequest',
        resource: 'https://example.com',
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('network_request');
    });

    it('categorizes git tools as git_operation', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'git', resource: 'commit' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('git_operation');
    });

    it('categorizes unknown tools as custom', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request', tool: 'MySpecialTool', resource: 'something' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { action: string }).action).toBe('custom');
    });
  });

  describe('translateOutput - permission event risk categorization', () => {
    it('categorizes bash tools as high risk via control_request', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          tool_input: { command: 'ls' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { riskLevel: string }).riskLevel).toBe('high');
    });

    it('categorizes write tools as medium risk via control_request', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/x.txt' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { riskLevel: string }).riskLevel).toBe('medium');
    });

    it('categorizes read tools as low risk via control_request', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Read',
          tool_input: { file_path: '/tmp/x.txt' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { riskLevel: string }).riskLevel).toBe('low');
    });

    it('categorizes unknown tools as low risk via control_request', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'CustomTool',
          tool_input: {},
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { riskLevel: string }).riskLevel).toBe('low');
    });
  });

  describe('translateOutput - permission event field fallbacks', () => {
    it('uses action field when tool is missing', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission', action: 'Bash', resource: 'ls' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { detail: string }).detail).toContain('Bash');
    });

    it('uses path field when resource is missing', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission', tool: 'Read', path: '/etc/hosts' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { resource: string }).resource).toBe('/etc/hosts');
    });

    it('defaults to unknown when both tool and action are missing', () => {
      const adapter = new ClaudeCodeAdapter();
      const event = { type: 'permission_request' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { detail: string }).detail).toContain('unknown');
    });
  });

  describe('translateOutput - control_request field fallbacks', () => {
    it('uses request.type when request.subtype is missing', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          type: 'can_use_tool',
          tool_name: 'Read',
          tool_input: { file_path: '/tmp/x' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect(result?.type).toBe('permission_request');
    });

    it('uses request.input when request.tool_input is missing', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Read',
          input: { file_path: '/tmp/y' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      const payload = result?.payload as { resource: string; toolInput: Record<string, unknown> };
      expect(payload.resource).toBe('/tmp/y');
      expect(payload.toolInput).toEqual({ file_path: '/tmp/y' });
    });

    it('uses request.request_id when event.request_id is missing', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request: {
          subtype: 'can_use_tool',
          request_id: 'inner_id',
          tool_name: 'Read',
          tool_input: { file_path: '/tmp/z' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { externalRequestId: string }).externalRequestId).toBe('inner_id');
    });

    it('defaults tool_name to unknown when missing', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_input: { command: 'ls' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { detail: string }).detail).toContain('unknown');
    });

    it('extracts resource from path key in tool_input', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Read',
          tool_input: { path: '/some/path' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { resource: string }).resource).toBe('/some/path');
    });

    it('extracts resource from url key in tool_input', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'WebFetch',
          tool_input: { url: 'https://example.com' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { resource: string }).resource).toBe('https://example.com');
    });

    it('extracts resource from directory key in tool_input', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'ListDir',
          tool_input: { directory: '/usr/local' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { resource: string }).resource).toBe('/usr/local');
    });

    it('extracts resource from file key in tool_input', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Read',
          tool_input: { file: '/tmp/data.json' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { resource: string }).resource).toBe('/tmp/data.json');
    });

    it('builds detail with relevant keys when no resource is found', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'CustomTool',
          tool_input: { param1: 'value1', param2: 'value2' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      const detail = (result?.payload as { detail: string }).detail;
      expect(detail).toContain('CustomTool');
      expect(detail).toContain('param1=value1');
      expect(detail).toContain('param2=value2');
    });

    it('excludes content/new_string/old_string from detail keys', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Edit',
          tool_input: {
            file_path: '/tmp/x.ts',
            content: 'long content here',
            new_string: 'new value',
            old_string: 'old value',
          },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      const detail = (result?.payload as { detail: string }).detail;
      expect(detail).not.toContain('content=');
      expect(detail).not.toContain('new_string=');
      expect(detail).not.toContain('old_string=');
    });

    it('excludes values longer than 200 chars from detail keys', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'CustomTool',
          tool_input: { shortKey: 'short', longKey: 'x'.repeat(201) },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      const detail = (result?.payload as { detail: string }).detail;
      expect(detail).toContain('shortKey=short');
      expect(detail).not.toContain('longKey=');
    });

    it('limits detail to first 3 relevant keys', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'CustomTool',
          tool_input: { a: '1', b: '2', c: '3', d: '4' },
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      const detail = (result?.payload as { detail: string }).detail;
      expect(detail).toContain('a=1');
      expect(detail).toContain('b=2');
      expect(detail).toContain('c=3');
      expect(detail).not.toContain('d=4');
    });

    it('returns empty resource when tool_input has no matching keys', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const event = {
        type: 'control_request',
        request_id: 'r1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'CustomTool',
          tool_input: {},
        },
      };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { resource: string }).resource).toBe('');
    });
  });

  describe('translateOutput - unrecognized event types', () => {
    it('returns null for events not in the Claude Code event set', () => {
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.translateOutput(JSON.stringify({ type: 'system' }))).toBeNull();
      expect(adapter.translateOutput(JSON.stringify({ type: 'heartbeat' }))).toBeNull();
    });
  });

  describe('translateOutput - clarification event field fallbacks', () => {
    it('uses message field when question is missing', () => {
      const adapter = new ClaudeCodeAdapter({
        mode: 'experimental',
        capabilities: {
          structuredIO: true,
          permissionEvents: true,
          clarificationEvents: true,
          stdinResponses: false,
        },
      });
      const event = { type: 'clarification', message: 'need more info' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { question: string }).question).toBe('need more info');
    });

    it('defaults to empty string when both question and message are missing', () => {
      const adapter = new ClaudeCodeAdapter({
        mode: 'experimental',
        capabilities: {
          structuredIO: true,
          permissionEvents: true,
          clarificationEvents: true,
          stdinResponses: false,
        },
      });
      const event = { type: 'clarification_request' };
      const result = adapter.translateOutput(JSON.stringify(event));
      expect(result).not.toBeNull();
      expect((result?.payload as { question: string }).question).toBe('');
      expect((result?.payload as { context: string }).context).toBe('');
    });
  });

  describe('translateInput - native mode edge cases', () => {
    it('uses replyTo as requestId fallback when externalRequestId is missing', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('permission_response', { granted: true });
      msg.replyTo = 'reply_123';
      const result = adapter.translateInput(msg);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as { request_id: string };
      expect(parsed.request_id).toBe('reply_123');
    });

    it('defaults deny reason when reason is not provided', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('permission_response', {
        granted: false,
      });
      const result = adapter.translateInput(msg);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as {
        response: { response: { behavior: string; message: string } };
      };
      expect(parsed.response.response.behavior).toBe('deny');
      expect(parsed.response.response.message).toBe('Denied by orchestrator');
    });

    it('defaults updatedInput to empty object when toolInput is missing', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('permission_response', {
        granted: true,
        externalRequestId: 'r1',
      });
      const result = adapter.translateInput(msg);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as {
        response: { response: { updatedInput: Record<string, unknown> } };
      };
      expect(parsed.response.response.updatedInput).toEqual({});
    });

    it('defaults requestId to empty string when both externalRequestId and replyTo are missing', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('permission_response', { granted: true });
      const result = adapter.translateInput(msg);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as { request_id: string };
      expect(parsed.request_id).toBe('');
    });

    it('passes through other message types directly in native mode', () => {
      const adapter = new ClaudeCodeAdapter({ mode: 'native' });
      const msg = createProtocolMessage('handshake_ack', { sessionId: 's1' });
      const result = adapter.translateInput(msg);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as { type: string };
      expect(parsed.type).toBe('handshake_ack');
    });
  });

  describe('createClaudeCodeAdapter', () => {
    it('selects native mode when structuredIO, stdinResponses, and permissionEvents are verified', () => {
      const adapter = createClaudeCodeAdapter({
        structuredIO: true,
        stdinResponses: true,
        permissionEvents: true,
        clarificationEvents: true,
      });
      expect(adapter.getMode()).toBe('native');
    });

    it('selects native mode even when clarificationEvents are not verified', () => {
      const adapter = createClaudeCodeAdapter({
        structuredIO: true,
        stdinResponses: true,
        permissionEvents: true,
        clarificationEvents: false,
      });
      expect(adapter.getMode()).toBe('native');
      expect(adapter.args).toContain('--permission-prompt-tool');
    });

    it('uses experimental mode when permission events are available but stdin responses are missing', () => {
      const adapter = createClaudeCodeAdapter({
        structuredIO: true,
        stdinResponses: false,
        permissionEvents: true,
        clarificationEvents: false,
      });
      expect(adapter.getMode()).toBe('experimental');
    });

    it('uses experimental mode when permission events are available even without native stdin', () => {
      const adapter = createClaudeCodeAdapter({
        structuredIO: true,
        stdinResponses: false,
        permissionEvents: true,
        clarificationEvents: true,
      });
      expect(adapter.getMode()).toBe('experimental');
    });

    it('uses experimental mode when permissionEvents missing but structuredIO available', () => {
      const adapter = createClaudeCodeAdapter({
        structuredIO: true,
        stdinResponses: true,
        permissionEvents: false,
        clarificationEvents: false,
      });
      expect(adapter.getMode()).toBe('experimental');
    });

    it('falls back to text-only when structured IO missing', () => {
      const adapter = createClaudeCodeAdapter({
        structuredIO: false,
        stdinResponses: false,
        permissionEvents: false,
        clarificationEvents: false,
      });
      expect(adapter.getMode()).toBe('text-only');
      expect(adapter.args).toContain('--print');
      expect(adapter.args).not.toContain('--output-format');
    });
  });
});
