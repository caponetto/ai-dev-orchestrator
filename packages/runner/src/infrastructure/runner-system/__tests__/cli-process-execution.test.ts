import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import type { AgentTask } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi, assert } from 'vitest';

import { CliHumanRequestHandler } from '../cli-human-request-handler';
import { executeCliProcess } from '../cli-process-execution';
import { CliProcessRegistry } from '../cli-process-registry';
import { serializeMessage } from '../protocol-serializer';
import { StdioProtocolTransport } from '../stdio-protocol-transport';

describe('CLI subprocess execution', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cli-execution-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function task(): AgentTask {
    return {
      taskId: 'task',
      runId: 'run',
      stateId: 'WORK',
      role: 'planner',
      description: '',
      inputArtifacts: [],
      repoRoot: root,
      runDir: root,
      outputArtifactPath: join(root, 'output.json'),
      constraints: { timeout: 5000, requiredOutputType: 'plan' },
    };
  }

  it('returns cancellation before preparing or spawning a superseded attempt', async () => {
    const processes = new CliProcessRegistry();
    const generation = processes.generation;
    processes.killAll();
    const readOutput = vi.fn();
    const result = await executeCliProcess(
      task(),
      {
        processes,
        requests: new CliHumanRequestHandler(),
        readOutput,
        config: { command: 'must-not-launch' },
      },
      undefined,
      undefined,
      generation,
    );
    expect(result).toMatchObject({
      status: 'failure',
      error: 'Agent dispatch cancelled',
      recoverable: false,
    });
    expect(readOutput).not.toHaveBeenCalled();
  });

  it('collects a final protocol artifact from a real subprocess without reading a fallback file', async () => {
    const messages =
      [
        createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
        createProtocolMessage('handshake_ack', { sessionId: 'session' }),
        createProtocolMessage('artifact', {
          artifactType: 'plan',
          content: '{"summary":"done"}',
          isFinal: true,
        }),
        createProtocolMessage('done', {
          status: 'success',
          tokenUsage: { inputTokens: 30, outputTokens: 20 },
        }),
      ]
        .map(serializeMessage)
        .join('\n') + '\n';
    const processes = new CliProcessRegistry();
    const readOutput = vi.fn();
    const requests = new CliHumanRequestHandler();
    const permission = vi.spyOn(requests, 'handlePermissionRequest');
    let receive: Parameters<StdioProtocolTransport['onMessage']>[0] | undefined;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called below with the original transport receiver.
    const register = StdioProtocolTransport.prototype.onMessage;
    const registration = vi.spyOn(StdioProtocolTransport.prototype, 'onMessage');
    registration.mockImplementation(function (this: StdioProtocolTransport, handler) {
      receive = handler;
      register.call(this, handler);
    });
    try {
      const result = await executeCliProcess(
        {
          ...task(),
          agentConfig: {
            command: process.execPath,
            args: ['-e', `process.stdout.write(${JSON.stringify(messages)})`, '--'],
          },
        },
        {
          processes,
          requests,
          readOutput,
          config: { command: process.execPath, handshakeTimeoutMs: 1000 },
        },
      );
      expect(result).toMatchObject({
        status: 'success',
        artifactContent: '{"summary":"done"}',
        tokenUsage: { inputTokens: 30, outputTokens: 20 },
      });
      expect(readOutput).not.toHaveBeenCalled();
      assert(receive);
      receive(
        createProtocolMessage('permission_request', {
          action: 'file_write',
          resource: '/repo/late',
          detail: 'late callback',
          riskLevel: 'high',
        }),
      );
      expect(permission).not.toHaveBeenCalled();
    } finally {
      registration.mockRestore();
      permission.mockRestore();
      processes.killAll();
    }
  });
});
