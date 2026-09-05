import type { ProtocolMessage } from '@ai-orchestrator/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  CODEX_WORKSPACE_WRITE_NETWORK_CONFIG,
  CodexCliAdapter,
  createCodexCliAdapter,
} from '../codex-cli-adapter';

function assertMessage(message: ProtocolMessage | null): ProtocolMessage {
  expect(message).not.toBeNull();
  return message as ProtocolMessage;
}

describe('CodexCliAdapter', () => {
  it('invokes Codex exec with JSONL output and workspace-write sandboxing', () => {
    const adapter = new CodexCliAdapter();
    expect(adapter.name).toBe('codex');
    expect(adapter.command).toBe('codex');
    expect(adapter.args).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '-c',
      CODEX_WORKSPACE_WRITE_NETWORK_CONFIG,
    ]);
    expect(adapter.supportsProtocolHandshake).toBe(false);
  });

  it('maps agent messages, command execution, completion, and errors', () => {
    const adapter = new CodexCliAdapter();
    expect(assertMessage(adapter.translateOutput('{"type":"thread.started"}')).type).toBe(
      'progress',
    );
    const message = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'Implemented it' },
        }),
      ),
    );
    expect(message.payload).toMatchObject({ phase: 'generating', detail: 'Implemented it' });
    const command = assertMessage(
      adapter.translateOutput(
        JSON.stringify({
          type: 'item.started',
          item: { type: 'command_execution', command: 'pnpm test' },
        }),
      ),
    );
    expect(command.payload).toMatchObject({ phase: 'tool_call', detail: 'pnpm test' });
    const fileChange = assertMessage(
      adapter.translateOutput(
        JSON.stringify({ type: 'item.completed', item: { type: 'file_change' } }),
      ),
    );
    expect(fileChange.payload).toMatchObject({ phase: 'tool_result', detail: 'file_change' });
    expect(assertMessage(adapter.translateOutput('{"type":"turn.completed"}')).type).toBe('done');
    const error = assertMessage(
      adapter.translateOutput(
        JSON.stringify({ type: 'turn.failed', error: { message: 'rate limited' } }),
      ),
    );
    expect(error.payload).toMatchObject({ code: 'CODEX_CLI_ERROR', message: 'rate limited' });
  });

  it('ignores malformed and unsupported output', () => {
    const adapter = createCodexCliAdapter({
      structuredIO: true,
      permissionEvents: false,
      clarificationEvents: false,
      stdinResponses: false,
    });
    expect(adapter.translateOutput('not json')).toBeNull();
    expect(adapter.translateOutput('{"type":"unknown"}')).toBeNull();
  });
});
