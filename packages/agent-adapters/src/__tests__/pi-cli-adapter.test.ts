import type { ProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { describe, expect, it } from 'vitest';

import { PiCliAdapter, createPiCliAdapter } from '../pi-cli-adapter';

function assertMessage(message: ProtocolMessage | null): ProtocolMessage {
  expect(message).not.toBeNull();
  return message as ProtocolMessage;
}

describe('PiCliAdapter', () => {
  it('invokes pi with one-shot JSON event output', () => {
    const adapter = new PiCliAdapter();
    expect(adapter.name).toBe('pi');
    expect(adapter.command).toBe('pi');
    expect(adapter.args).toEqual(['--mode', 'json']);
    expect(adapter.supportsProtocolHandshake).toBe(false);
    expect(adapter.promptViaStdin).toBeUndefined();
  });

  it('maps agent start, completed text, and tool activity', () => {
    const adapter = new PiCliAdapter();
    expect(assertMessage(adapter.translateOutput('{"type":"agent_start"}')).type).toBe('progress');
    // Delta-only updates must not fragment the stream with per-token progress.
    expect(
      adapter.translateOutput(
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hi' },
        }),
      ),
    ).toBeNull();
    expect(
      adapter.translateOutput(
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, toolName: 'edit' },
        }),
      ),
    ).toBeNull();
    const completed = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Implemented it' }],
            stopReason: 'stop',
          },
        }),
      ),
    );
    expect(completed.payload).toMatchObject({ phase: 'generating', detail: 'Implemented it' });
    const toolStart = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'tool_execution_start',
          toolCallId: 'call_1',
          toolName: 'edit',
          args: { file_path: 'src/index.ts' },
        }),
      ),
    );
    expect(toolStart.payload).toMatchObject({ phase: 'tool_call', detail: 'edit src/index.ts' });
    const toolEnd = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'call_1',
          toolName: 'edit',
          result: { content: [{ type: 'text', text: 'done' }] },
          isError: false,
        }),
      ),
    );
    expect(toolEnd.payload).toMatchObject({ phase: 'tool_result', detail: 'edit: done' });
  });

  it('maps settled runs to done and aborted runs to an error', () => {
    const adapter = new PiCliAdapter();
    expect(assertMessage(adapter.translateOutput('{"type":"agent_settled"}')).type).toBe('done');
    const aborted = assertMessage(
      adapter.translateOutput('{"type":"agent_settled","aborted":true}'),
    );
    expect(aborted.type).toBe('error');
    expect(aborted.payload).toMatchObject({ code: 'PI_CLI_ERROR' });
  });

  it('maps stream errors and final retry failures', () => {
    const adapter = new PiCliAdapter();
    const streamError = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'error', reason: 'overloaded', error: 'rate limited' },
        }),
      ),
    );
    expect(streamError.payload).toMatchObject({
      code: 'PI_CLI_ERROR',
      message: 'rate limited',
      recoverable: true,
    });
    const retryFailure = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'auto_retry_end',
          success: false,
          attempt: 3,
          finalError: 'Permission denied',
        }),
      ),
    );
    expect(retryFailure.payload).toMatchObject({
      code: 'PI_CLI_ERROR',
      message: 'Permission denied',
      recoverable: false,
    });
  });

  it('maps assistant message_end text and error stop reasons', () => {
    const adapter = new PiCliAdapter();
    // User and system echoes must not surface as agent progress.
    expect(
      adapter.translateOutput(
        JSON.stringify({
          type: 'message_end',
          message: { role: 'user', content: 'Read the JSON task file' },
        }),
      ),
    ).toBeNull();
    const completed = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Implemented it' }],
            stopReason: 'stop',
          },
        }),
      ),
    );
    expect(completed.payload).toMatchObject({ phase: 'generating', detail: 'Implemented it' });
    const errored = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: '503 Service Unavailable',
          },
        }),
      ),
    );
    expect(errored.type).toBe('error');
    expect(errored.payload).toMatchObject({
      message: '503 Service Unavailable',
      recoverable: true,
    });
  });

  it('maps compaction progress and failures', () => {
    const adapter = new PiCliAdapter();
    expect(
      assertMessage(adapter.translateOutput('{"type":"compaction_start","reason":"threshold"}'))
        .type,
    ).toBe('progress');
    const failed = assertMessage(
      adapter.translateOutput(
        JSON.stringify({ type: 'compaction_end', reason: 'threshold', errorMessage: 'boom' }),
      ),
    );
    expect(failed.type).toBe('error');
  });

  it('ignores malformed output and events without a mapping', () => {
    const adapter = createPiCliAdapter();
    expect(adapter.translateOutput('not json')).toBeNull();
    expect(adapter.translateOutput('{"type":"unknown"}')).toBeNull();
    expect(adapter.translateOutput('{"type":"turn_end"}')).toBeNull();
    expect(adapter.translateOutput('{"type":"agent_end","willRetry":false}')).toBeNull();
    expect(adapter.translateOutput('{"type":"session","version":3,"id":"abc"}')).toBeNull();
    expect(adapter.translateInput({ type: 'abort' } as ProtocolMessage)).toBeNull();
  });
});
