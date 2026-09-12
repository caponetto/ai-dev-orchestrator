import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { describe, expect, it } from 'vitest';

import { OpencodeCliAdapter, createOpencodeCliAdapter } from '../opencode-cli-adapter';

function assertMessage(message: ProtocolMessage | null): ProtocolMessage {
  expect(message).not.toBeNull();
  return message as ProtocolMessage;
}

describe('OpencodeCliAdapter', () => {
  it('invokes opencode run with json format and auto approval', () => {
    const adapter = new OpencodeCliAdapter();
    expect(adapter.name).toBe('opencode');
    expect(adapter.command).toBe('opencode');
    expect(adapter.args).toEqual(['run', '--format', 'json', '--auto']);
    expect(adapter.supportsProtocolHandshake).toBe(false);
  });

  it('maps step start, text, tool calls, step finish, and errors', () => {
    const adapter = new OpencodeCliAdapter();

    const start = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'step_start',
          timestamp: 1789210282776,
          sessionID: 'ses_123',
          part: { id: 'prt_1', type: 'step-start' },
        }),
      ),
    );
    expect(start.type).toBe('progress');
    expect(start.payload).toMatchObject({ phase: 'init', detail: 'OpenCode step started' });

    const text = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'text',
          timestamp: 1789210283009,
          sessionID: 'ses_123',
          part: { id: 'prt_2', type: 'text', text: 'Hello from OpenCode!' },
        }),
      ),
    );
    expect(text.type).toBe('progress');
    expect(text.payload).toMatchObject({
      phase: 'generating',
      detail: 'Hello from OpenCode!',
    });

    const toolRunning = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'tool_use',
          timestamp: 1789210296411,
          sessionID: 'ses_123',
          part: {
            type: 'tool',
            tool: 'read',
            callID: 'call_1',
            state: { status: 'running' },
          },
        }),
      ),
    );
    expect(toolRunning.type).toBe('progress');
    expect(toolRunning.payload).toMatchObject({ phase: 'tool_call', detail: 'read' });

    const toolCompleted = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'tool_use',
          timestamp: 1789210296411,
          sessionID: 'ses_123',
          part: {
            type: 'tool',
            tool: 'read',
            callID: 'call_1',
            state: { status: 'completed' },
          },
        }),
      ),
    );
    expect(toolCompleted.type).toBe('progress');
    expect(toolCompleted.payload).toMatchObject({ phase: 'tool_result', detail: 'read' });

    const toolWithInput = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'tool_use',
          part: {
            type: 'tool',
            tool: 'read',
            state: { status: 'completed', input: { filePath: 'src/index.ts' } },
          },
        }),
      ),
    );
    expect(toolWithInput.payload).toMatchObject({
      phase: 'tool_result',
      detail: 'read src/index.ts',
    });

    const toolWithTitle = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'tool_use',
          part: {
            type: 'tool',
            tool: 'grep',
            title: 'grep "SearchTerm"',
          },
        }),
      ),
    );
    expect(toolWithTitle.payload).toMatchObject({
      phase: 'tool_call',
      detail: 'grep "SearchTerm"',
    });

    const intermediateStepFinish = adapter.translateOutput(
      JSON.stringify({
        type: 'step_finish',
        part: { id: 'prt_3', reason: 'tool-calls', type: 'step-finish' },
      }),
    );
    expect(intermediateStepFinish).toBeNull();

    const finalStepFinish = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'step_finish',
          part: { id: 'prt_4', reason: 'stop', type: 'step-finish' },
        }),
      ),
    );
    expect(finalStepFinish.type).toBe('done');
    expect(finalStepFinish.payload).toMatchObject({ summary: 'completed' });

    const error = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'error',
          error: {
            name: 'UnknownError',
            data: { message: 'Unexpected server error' },
          },
        }),
      ),
    );
    expect(error.type).toBe('error');
    expect(error.payload).toMatchObject({
      code: 'OPENCODE_CLI_ERROR',
      message: 'Unexpected server error',
      recoverable: false,
    });
  });

  it('ignores malformed and unsupported output', () => {
    const adapter = createOpencodeCliAdapter();
    expect(adapter.translateOutput('not json')).toBeNull();
    expect(adapter.translateOutput('{"type":"unknown"}')).toBeNull();
    expect(adapter.translateInput({} as ProtocolMessage)).toBeNull();
  });
});
