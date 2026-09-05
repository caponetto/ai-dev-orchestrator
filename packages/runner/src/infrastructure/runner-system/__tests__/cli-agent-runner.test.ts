import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentAdapter } from '@ai-orchestrator/agent-adapters';
import type { ProtocolMessage } from '@ai-orchestrator/agent-protocol';
import { createProtocolMessage } from '@ai-orchestrator/agent-protocol';
import type {
  AgentOutputStreamEvent,
  PermissionContext,
  PermissionPolicy,
} from '@ai-orchestrator/ports';
import type { AgentTask } from '@ai-orchestrator/schemas';
import { AI_CONFIG_DIR_NAME } from '@ai-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAgentTaskPrompt,
  CliAgentRunner,
  extractArtifactJsonFromAgentText,
  extractUsageFromRawLine,
} from '../cli-agent-runner';
import type { LiveRequestStore } from '../file-backed-live-request-store';
import type { PermissionApprovalStore } from '../permission-approval-store';
import { serializeMessage } from '../protocol-serializer';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cli-agent-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeTask(overrides?: Partial<AgentTask>): AgentTask {
  return {
    taskId: 'task-1',
    runId: '20260101-000000-abc123',
    stateId: 'IMPLEMENTATION',
    role: 'implementer',
    description: 'Implement feature X',
    inputArtifacts: [],
    repoRoot: tempDir,
    runDir: join(tempDir, 'run-dir'),
    outputArtifactPath: join(tempDir, 'output', 'implementation-task-1.json'),
    constraints: {
      timeout: 10000,
      requiredOutputType: 'implementation',
    },
    ...overrides,
  };
}

async function preWriteOutput(task: AgentTask, content: object): Promise<void> {
  const dir = join(tempDir, 'output');
  await mkdir(dir, { recursive: true });
  await writeFile(task.outputArtifactPath, JSON.stringify(content));
}

function protocolScript(messages: string[]): string {
  const handshake = serializeMessage(
    createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
  );
  return [handshake, ...messages].map((m) => `echo '${m}'`).join('; ');
}

describe('CliAgentRunner', () => {
  it('dispatches a task and reads successful output', async () => {
    const task = makeTask();
    await preWriteOutput(task, {
      summary: 'Implemented feature X',
      filesChanged: ['src/index.ts'],
      tokenUsage: { inputTokens: 100, outputTokens: 50 },
    });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);

    expect(result.status).toBe('success');
    expect(result.taskId).toBe('task-1');
    expect(result.artifactContent).toBeTruthy();
    expect(result.tokenUsage?.inputTokens).toBe(100);
    expect(result.tokenUsage?.outputTokens).toBe(50);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('writes task file before launching agent', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    await runner.dispatch(task);

    const taskFilePath = join(tempDir, 'run-dir', 'agent-tasks', 'task-1.json');
    const taskFile = await readFile(taskFilePath, 'utf-8');
    const parsed = JSON.parse(taskFile) as AgentTask;
    expect(parsed.taskId).toBe('task-1');
    expect(parsed.role).toBe('implementer');
  });

  it('returns failure when agent exits with non-zero code', async () => {
    const task = makeTask();

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'exit 1'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);

    expect(result.status).toBe('failure');
    expect(result.error).toBeTruthy();
  });

  it('returns failure when output file is missing after success', async () => {
    const task = makeTask();

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);

    expect(result.status).toBe('failure');
    expect(result.error).toContain('Failed to read agent output');
  });

  it('returns timeout when agent exceeds timeout', async () => {
    const task = makeTask({
      constraints: {
        timeout: 500,
        requiredOutputType: 'implementation',
      },
    });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'sleep 30'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);

    expect(result.status).toBe('timeout');
    expect(result.error).toContain('timed out');
  }, 15000);

  it('handles output without tokenUsage field', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);

    expect(result.status).toBe('success');
    expect(result.tokenUsage).toBeUndefined();
  });

  it('forwards stream events when callback provided', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'echo "progress"'],
      handshakeTimeoutMs: 200,
    });

    const events: Array<{ type: string; content: string }> = [];
    await runner.dispatch(task, (event) => {
      events.push({ type: event.type, content: event.content });
    });

    expect(events.some((e) => e.type === 'stdout')).toBe(true);
  });

  it('includes instructions field in serialized task file', async () => {
    const task = makeTask({
      instructions: 'Never run destructive git operations.',
    });
    await preWriteOutput(task, { summary: 'done' });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    await runner.dispatch(task);

    const taskFilePath = join(tempDir, 'run-dir', 'agent-tasks', 'task-1.json');
    const taskFile = await readFile(taskFilePath, 'utf-8');
    const parsed = JSON.parse(taskFile) as AgentTask;
    expect(parsed.instructions).toBe('Never run destructive git operations.');
  });

  describe('protocol mode', () => {
    it('negotiates protocol and receives done message', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'All done' });
      const done = serializeMessage(createProtocolMessage('done', { summary: 'All done' }));
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', protocolScript([done])],
        handshakeTimeoutMs: 2000,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');
      expect(result.artifactContent).toContain('All done');
    });

    it('reports failure when done message received but artifact file is missing', async () => {
      const done = serializeMessage(createProtocolMessage('done', { summary: 'All done' }));
      const events: AgentOutputStreamEvent[] = [];
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', protocolScript([done])],
        handshakeTimeoutMs: 2000,
      });

      const result = await runner.dispatch(makeTask(), (e) => events.push(e));
      expect(result.status).toBe('failure');
      expect(result.error).toContain('Failed to read agent output artifact');
      const errorEvents = events.filter(
        (e) => e.type === 'stderr' && e.structuredData?.['code'] === 'missing_output_artifact',
      );
      expect(errorEvents).toHaveLength(1);
      const doneEvents = events.filter(
        (e) =>
          e.type === 'stdout' &&
          typeof e.content === 'string' &&
          e.content.includes('Task completed'),
      );
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0]?.content).toContain('failure');
    });

    it('streams progress events in protocol mode', async () => {
      const progress = serializeMessage(
        createProtocolMessage('progress', {
          phase: 'coding',
          detail: 'Writing tests',
          percent: 50,
        }),
      );
      const done = serializeMessage(createProtocolMessage('done', { summary: 'Complete' }));
      const events: AgentOutputStreamEvent[] = [];
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', protocolScript([progress, done])],
        handshakeTimeoutMs: 2000,
      });

      await runner.dispatch(makeTask(), (e) => events.push(e));

      const statusEvents = events.filter(
        (e) => e.type === 'status' && e.structuredData?.messageType !== 'cli_prompt',
      );
      expect(statusEvents.length).toBeGreaterThan(0);
      expect(statusEvents[0].content).toContain('Writing tests');
      expect(statusEvents[0].content).toContain('50%');
      expect(statusEvents[0].structuredData?.phase).toBe('coding');
    });

    it('uses final artifact content from artifact message', async () => {
      const artifact = serializeMessage(
        createProtocolMessage('artifact', {
          artifactType: 'code',
          content: 'function hello() {}',
          isFinal: true,
        }),
      );
      const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', protocolScript([artifact, done])],
        handshakeTimeoutMs: 2000,
      });

      const result = await runner.dispatch(makeTask());
      expect(result.status).toBe('success');
      expect(result.artifactContent).toBe('function hello() {}');
    });

    it('handles error message from agent', async () => {
      const error = serializeMessage(
        createProtocolMessage('error', {
          code: 'SYNTAX_ERROR',
          message: 'Unexpected token',
          recoverable: false,
        }),
      );
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', protocolScript([error])],
        handshakeTimeoutMs: 2000,
      });

      const result = await runner.dispatch(makeTask());
      expect(result.status).toBe('failure');
      expect(result.error).toContain('SYNTAX_ERROR');
      expect(result.error).toContain('Unexpected token');
    });

    it('preserves accumulated token usage when agent reports protocol error', async () => {
      const usageEvent = JSON.stringify({
        type: 'assistant',
        message: {
          content: 'working...',
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 50,
            output_tokens: 25,
          },
        },
      });
      const error = serializeMessage(
        createProtocolMessage('error', {
          code: 'AGENT_FAILED',
          message: 'boom',
          recoverable: false,
        }),
      );
      const handshake = serializeMessage(
        createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
      );
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', [handshake, usageEvent, error].map((m) => `echo '${m}'`).join('; ')],
        handshakeTimeoutMs: 2000,
      });

      const result = await runner.dispatch(makeTask());
      expect(result.status).toBe('failure');
      expect(result.tokenUsage?.inputTokens).toBe(150);
      expect(result.tokenUsage?.outputTokens).toBe(25);
    });

    it('auto-denies permission when no policy is configured', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'Done' });
      const handshake = serializeMessage(
        createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
      );
      const permReq = serializeMessage(
        createProtocolMessage('permission_request', {
          action: 'file_write',
          resource: 'src/main.ts',
          detail: 'Write file',
          riskLevel: 'low' as const,
        }),
      );
      const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
      const script = `echo '${handshake}'; echo '${permReq}'; sleep 0.3; echo '${done}'`;

      const events: AgentOutputStreamEvent[] = [];
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', script],
        handshakeTimeoutMs: 2000,
      });

      const result = await runner.dispatch(task, (e) => events.push(e));
      expect(result.status).toBe('success');

      const permEvents = events.filter((e) => e.type === 'permission_request');
      expect(permEvents.length).toBeGreaterThan(0);
      expect(permEvents[0].content).toContain('file_write');
    });

    it('auto-grants permission via policy', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'Done' });
      const handshake = serializeMessage(
        createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
      );
      const permReq = serializeMessage(
        createProtocolMessage('permission_request', {
          action: 'file_write',
          resource: 'src/main.ts',
          detail: 'Write file',
          riskLevel: 'low' as const,
        }),
      );
      const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
      const script = `echo '${handshake}'; echo '${permReq}'; sleep 0.3; echo '${done}'`;

      const policy: PermissionPolicy = {
        evaluate: (_req: unknown, _ctx: PermissionContext) => ({
          action: 'grant' as const,
          reason: 'Auto-approved',
        }),
      };
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', script],
        handshakeTimeoutMs: 2000,
      });
      runner.setPermissionPolicy(policy);

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');
    });

    it('sends deny response via policy', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'Done' });
      const handshake = serializeMessage(
        createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
      );
      const permReq = serializeMessage(
        createProtocolMessage('permission_request', {
          action: 'shell_execute',
          resource: 'rm -rf /',
          detail: 'Dangerous',
          riskLevel: 'high' as const,
        }),
      );
      const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
      const script = `echo '${handshake}'; echo '${permReq}'; sleep 0.3; echo '${done}'`;

      const policy: PermissionPolicy = {
        evaluate: () => ({ action: 'deny' as const, reason: 'Too dangerous' }),
      };
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', script],
        handshakeTimeoutMs: 2000,
      });
      runner.setPermissionPolicy(policy);

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');
    });

    it('delegates to live request store on ask_human', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'Done' });
      const writeRequestFn = vi.fn(() => Promise.resolve());
      const writeResponseFn = vi.fn(() => Promise.resolve());
      const awaitResponseFn = vi.fn(() =>
        Promise.resolve({
          runId: '20260101-000000-abc123',
          messageId: 'msg-1',
          respondedAt: '2026-01-01T00:00:01Z',
          payload: { granted: true, reason: 'Human approved' },
        }),
      );
      const listPendingRequestsFn = vi.fn(() => Promise.resolve([] as never[]));
      const mockStore: LiveRequestStore = {
        writeRequest: writeRequestFn,
        writeResponse: writeResponseFn,
        awaitResponse: awaitResponseFn,
        listPendingRequests: listPendingRequestsFn,
        cleanupResolved: vi.fn(() => Promise.resolve(0)),
      };

      const handshake = serializeMessage(
        createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
      );
      const permReq = serializeMessage(
        createProtocolMessage('permission_request', {
          action: 'file_write',
          resource: 'src/main.ts',
          detail: 'Write file',
          riskLevel: 'low' as const,
        }),
      );
      const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
      const script = `echo '${handshake}'; echo '${permReq}'; sleep 0.5; echo '${done}'`;

      const policy: PermissionPolicy = {
        evaluate: () => ({ action: 'ask_human' as const, reason: 'Needs approval' }),
      };
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', script],
        handshakeTimeoutMs: 2000,
      });
      runner.setPermissionPolicy(policy);
      runner.setLiveRequestStore(mockStore);

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');
      expect(writeRequestFn).toHaveBeenCalledOnce();
      expect(awaitResponseFn).toHaveBeenCalledOnce();
    });

    it('streams log messages', async () => {
      const log = serializeMessage(
        createProtocolMessage('log', { level: 'info' as const, message: 'Starting task' }),
      );
      const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
      const events: AgentOutputStreamEvent[] = [];
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', protocolScript([log, done])],
        handshakeTimeoutMs: 2000,
      });

      await runner.dispatch(makeTask(), (e) => events.push(e));

      const logEvents = events.filter((e) => e.content.includes('Starting task'));
      expect(logEvents.length).toBeGreaterThan(0);
    });

    it('resolves via adapter-translated done without protocol handshake', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'adapter-result' });
      const adapter: AgentAdapter = {
        name: 'test-adapter',
        command: 'bash',
        args: ['-c', 'echo "DONE:adapter-result"; sleep 0.5'],
        translateOutput(line: string): ProtocolMessage | null {
          if (line.startsWith('DONE:')) {
            return createProtocolMessage('done', { summary: line.slice(5) });
          }
          return null;
        },
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');
      expect(result.artifactContent).toContain('adapter-result');
    });

    it('reports failure when adapter-translated done received but artifact file is missing', async () => {
      const adapter: AgentAdapter = {
        name: 'test-adapter',
        command: 'bash',
        args: ['-c', 'echo "DONE:adapter-result"; sleep 0.5'],
        translateOutput(line: string): ProtocolMessage | null {
          if (line.startsWith('DONE:')) {
            return createProtocolMessage('done', { summary: line.slice(5) });
          }
          return null;
        },
      };

      const events: AgentOutputStreamEvent[] = [];
      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(makeTask(), (e) => events.push(e));
      expect(result.status).toBe('failure');
      expect(result.error).toContain('Failed to read agent output artifact');
    });

    it('uses adapter agent-message JSON fallback when output file is missing', async () => {
      const artifactJson = JSON.stringify({ id: 'ctx-1', version: 1, title: 'Context' });
      const adapter: AgentAdapter = {
        name: 'codex',
        command: 'bash',
        args: [
          '-c',
          `echo '${artifactJson.replaceAll("'", "'\\''")}'; echo '{"type":"turn.completed"}'`,
        ],
        supportsProtocolHandshake: false,
        translateOutput(line: string): ProtocolMessage | null {
          if (line.includes('turn.completed')) {
            return createProtocolMessage('done', { summary: 'completed' });
          }
          if (line.startsWith('{') && line.includes('"id"')) {
            return createProtocolMessage('progress', {
              phase: 'generating',
              detail: line,
            });
          }
          return null;
        },
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(makeTask());
      expect(result.status).toBe('success');
      expect(result.artifactContent).toBe(artifactJson);
    });

    it('tracks cumulative Claude Code token usage via high-water mark in legacy mode', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'done' });

      const event1 = JSON.stringify({
        type: 'assistant',
        message: {
          content: 'thinking...',
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 50,
            output_tokens: 20,
          },
        },
      });
      const event2 = JSON.stringify({
        type: 'assistant',
        message: {
          content: 'writing code...',
          usage: {
            input_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 200,
            output_tokens: 30,
          },
        },
      });

      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', `echo '${event1}'; echo '${event2}'`],
        handshakeTimeoutMs: 200,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');
      expect(result.tokenUsage).toBeDefined();
      expect(result.tokenUsage?.inputTokens).toBe(Math.max(10 + 100 + 50, 5 + 0 + 200));
      expect(result.tokenUsage?.outputTokens).toBe(Math.max(20, 30));
    });

    it('passes task handoff as a prompt for claude-code adapters', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'done' });
      const capturedArgsPath = join(tempDir, 'claude-args.json');
      const adapter: AgentAdapter = {
        name: 'claude-code',
        command: 'bash',
        args: [
          '-c',
          `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
        ],
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
      const args = JSON.parse(serializedArgs) as string[];
      const taskFilePath = join(tempDir, 'run-dir', 'agent-tasks', 'task-1.json');
      expect(args).not.toContain('--task-file');
      expect(args.some((arg) => arg.includes(taskFilePath))).toBe(true);
      expect(args.some((arg) => arg.includes('Read the JSON task file'))).toBe(true);
    });

    it('injects --model flag when task has modelHint', async () => {
      const task = makeTask({ modelHint: 'claude-opus-4-20250514' });
      await preWriteOutput(task, { summary: 'done' });
      const capturedArgsPath = join(tempDir, 'model-args.json');
      const adapter: AgentAdapter = {
        name: 'claude-code',
        command: 'bash',
        args: [
          '-c',
          `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
        ],
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
      const args = JSON.parse(serializedArgs) as string[];
      const modelIdx = args.indexOf('--model');
      expect(modelIdx).toBeGreaterThanOrEqual(0);
      expect(args[modelIdx + 1]).toBe('claude-opus-4-20250514');
    });

    it('injects codex permission hook args when bridge is configured', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'done' });
      const capturedArgsPath = join(tempDir, 'codex-hook-args.json');
      const adapter: AgentAdapter = {
        name: 'codex',
        command: 'bash',
        args: [
          '-c',
          `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
        ],
        supportsProtocolHandshake: false,
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });
      runner.setCodexPermissionBridge({
        runsDir: join(tempDir, 'runs'),
        cliEntryPath: join(tempDir, 'ai', 'index.js'),
      });
      runner.setPermissionPolicyConfig({ defaultAction: 'ask_human' });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
      const args = JSON.parse(serializedArgs) as string[];
      expect(args).toContain('--dangerously-bypass-hook-trust');
      expect(args).toContain('-c');
      expect(args.some((arg) => arg.includes('hooks.PermissionRequest'))).toBe(true);

      const hookScript = join(task.runDir, 'codex-permission-hook.sh');
      await expect(readFile(hookScript, 'utf-8')).resolves.toContain('codex-permission-hook');
    });

    it('injects --add-dir for codex so ~/.ai artifact writes are sandbox-allowed', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'done' });
      const capturedArgsPath = join(tempDir, 'codex-add-dir-args.json');
      const adapter: AgentAdapter = {
        name: 'codex',
        command: 'bash',
        args: [
          '-c',
          `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
        ],
        supportsProtocolHandshake: false,
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
      const args = JSON.parse(serializedArgs) as string[];
      const addDirIdx = args.indexOf('--add-dir');
      expect(addDirIdx).toBeGreaterThanOrEqual(0);
      expect(args[addDirIdx + 1]).toBe(join(homedir(), AI_CONFIG_DIR_NAME));
    });

    it('does not inject --model when modelHint is absent', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'done' });
      const capturedArgsPath = join(tempDir, 'no-model-args.json');
      const adapter: AgentAdapter = {
        name: 'claude-code',
        command: 'bash',
        args: [
          '-c',
          `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
        ],
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
      const args = JSON.parse(serializedArgs) as string[];
      expect(args).not.toContain('--model');
    });

    it('sends prompt via stdin when adapter has promptViaStdin=true', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'done' });
      const stdinCapturePath = join(tempDir, 'stdin-capture.txt');

      const adapter: AgentAdapter = {
        name: 'claude-code',
        command: 'bash',
        args: ['-c', `head -n 1 > ${JSON.stringify(stdinCapturePath)}`],
        promptViaStdin: true,
        sendPrompt(prompt: string): string {
          return JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } });
        },
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const stdinContent = await readFile(stdinCapturePath, 'utf-8');
      const parsed = JSON.parse(stdinContent.trim()) as {
        type: string;
        message: { role: string; content: string };
      };
      expect(parsed.type).toBe('user');
      expect(parsed.message.role).toBe('user');
      expect(parsed.message.content).toContain('Read the JSON task file');
    });

    it('uses stdin ignore for prompt-arg adapters without promptViaStdin', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'done' });
      const stdinBytesPath = join(tempDir, 'stdin-bytes.txt');

      const adapter: AgentAdapter = {
        name: 'codex',
        command: 'bash',
        args: [
          '-c',
          `wc -c <&0 | tr -d ' ' > ${JSON.stringify(stdinBytesPath)}; echo '{"type":"turn.completed"}'`,
        ],
        supportsProtocolHandshake: false,
        translateOutput(line: string): ProtocolMessage | null {
          if (line.includes('turn.completed')) {
            return createProtocolMessage('done', { summary: 'ok' });
          }
          return null;
        },
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const stdinBytes = await readFile(stdinBytesPath, 'utf-8');
      expect(stdinBytes.trim()).toBe('0');
    });

    it('skips --allowedTools and prompt arg when adapter has promptViaStdin=true', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'done' });
      const capturedArgsPath = join(tempDir, 'native-args.json');

      const adapter: AgentAdapter = {
        name: 'claude-code',
        command: 'bash',
        args: [
          '-c',
          `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
        ],
        promptViaStdin: true,
        sendPrompt(prompt: string): string {
          return JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } });
        },
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
      const args = JSON.parse(serializedArgs) as string[];
      expect(args).not.toContain('--allowedTools');
      expect(args.every((arg) => !arg.includes('Read the JSON task file'))).toBe(true);
    });

    it('injects --max-turns for claude-code adapter when maxTurns configured', async () => {
      const task = makeTask({
        agentConfig: { maxTurns: 25 },
      });
      await preWriteOutput(task, { summary: 'done' });
      const capturedArgsPath = join(tempDir, 'max-turns-args.json');
      const adapter: AgentAdapter = {
        name: 'claude-code',
        command: 'bash',
        args: [
          '-c',
          `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
        ],
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
      const args = JSON.parse(serializedArgs) as string[];
      const maxTurnsIdx = args.indexOf('--max-turns');
      expect(maxTurnsIdx).toBeGreaterThanOrEqual(0);
      expect(args[maxTurnsIdx + 1]).toBe('25');
    });

    it('does not inject --max-turns when maxTurns is not configured', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'done' });
      const capturedArgsPath = join(tempDir, 'no-max-turns-args.json');
      const adapter: AgentAdapter = {
        name: 'claude-code',
        command: 'bash',
        args: [
          '-c',
          `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
        ],
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
      const args = JSON.parse(serializedArgs) as string[];
      expect(args).not.toContain('--max-turns');
    });

    it('does not inject --max-turns for non-claude-code adapters', async () => {
      const task = makeTask({
        agentConfig: { maxTurns: 25 },
      });
      await preWriteOutput(task, { summary: 'done' });
      const capturedArgsPath = join(tempDir, 'adapter-max-turns-args.json');
      const adapter: AgentAdapter = {
        name: 'test-adapter',
        command: 'bash',
        args: [
          '-c',
          `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
        ],
      };

      const runner = new CliAgentRunner({
        command: 'bash',
        args: [],
        adapter,
        handshakeTimeoutMs: 300,
      });

      const result = await runner.dispatch(task);
      expect(result.status).toBe('success');

      const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
      const args = JSON.parse(serializedArgs) as string[];
      expect(args).not.toContain('--max-turns');
    });

    it('includes externalRequestId in permission_response when present in request payload', async () => {
      const task = makeTask();
      await preWriteOutput(task, { summary: 'Done' });
      const handshake = serializeMessage(
        createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
      );
      const permReq = serializeMessage(
        createProtocolMessage('permission_request', {
          action: 'shell_execute',
          resource: 'ls',
          detail: 'Bash: ls',
          riskLevel: 'low' as const,
          externalRequestId: 'ctrl_req_abc',
          toolInput: { command: 'ls' },
        }),
      );
      const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
      const script = `echo '${handshake}'; echo '${permReq}'; sleep 0.3; echo '${done}'`;

      const events: AgentOutputStreamEvent[] = [];
      const policy: PermissionPolicy = {
        evaluate: () => ({ action: 'grant' as const, reason: 'Allowed' }),
      };
      const runner = new CliAgentRunner({
        command: 'bash',
        args: ['-c', script],
        handshakeTimeoutMs: 2000,
      });
      runner.setPermissionPolicy(policy);

      const result = await runner.dispatch(task, (e) => events.push(e));
      expect(result.status).toBe('success');

      const permEvents = events.filter((e) => e.type === 'permission_request');
      expect(permEvents.length).toBeGreaterThan(0);
      expect(permEvents[0].structuredData?.externalRequestId).toBe('ctrl_req_abc');
    });
  });
});

describe('buildAgentTaskPrompt', () => {
  it('includes output path, format label, and JSON write discipline', () => {
    const task = makeTask({
      outputArtifactPath: '/tmp/run/artifacts/canonical_specification-worker-1.json',
      constraints: {
        timeout: 10000,
        requiredOutputType: 'implementation',
        outputFormat: 'json',
      },
    });
    const prompt = buildAgentTaskPrompt(task, '/tmp/run/agent-tasks/worker-1.json');

    expect(prompt).toContain(
      'Required output artifact path: /tmp/run/artifacts/canonical_specification-worker-1.json',
    );
    expect(prompt).toContain('Required output format: JSON');
    expect(prompt).toContain('exactly one JSON value');
    expect(prompt).toMatch(/overwrite/i);
    expect(prompt).toMatch(/never append/i);
    expect(prompt).toContain('JSON.parse');
  });

  it('includes YAML write discipline for yaml format', () => {
    const task = makeTask({
      constraints: {
        timeout: 10000,
        requiredOutputType: 'implementation',
        outputFormat: 'yaml',
      },
    });
    const prompt = buildAgentTaskPrompt(task, '/tmp/task.json');
    expect(prompt).toContain('Required output format: YAML');
    expect(prompt).toContain('exactly one YAML document');
  });

  it('includes task file path and general instructions', () => {
    const task = makeTask();
    const prompt = buildAgentTaskPrompt(task, '/tmp/task.json');

    expect(prompt).toContain('Task file: /tmp/task.json');
    expect(prompt).toContain('Read the task file before starting work.');
    expect(prompt).toContain('Follow the role instructions above as your primary guidance.');
    expect(prompt).toContain('If stream-json mode is enabled');
  });

  it('injects rendered role prompt when present', () => {
    const task = makeTask({
      rolePrompt: 'You are the implementer. Follow these steps...',
    });
    const prompt = buildAgentTaskPrompt(task, '/tmp/task.json');

    expect(prompt).toContain('--- Role Instructions ---');
    expect(prompt).toContain('You are the implementer. Follow these steps...');
  });

  it('omits role instructions section when rolePrompt is absent', () => {
    const task = makeTask();
    const prompt = buildAgentTaskPrompt(task, '/tmp/task.json');

    expect(prompt).not.toContain('--- Role Instructions ---');
  });

  it('does not duplicate human feedback outside the role prompt', () => {
    const task = makeTask({ humanFeedback: 'Please add error handling' });
    const prompt = buildAgentTaskPrompt(task, '/tmp/task.json');

    expect(prompt).not.toContain('IMPORTANT — Human Feedback');
  });

  it('does not duplicate previous findings outside the role prompt', () => {
    const task = makeTask({ previousFindings: 'Missing null check on line 42' });
    const prompt = buildAgentTaskPrompt(task, '/tmp/task.json');

    expect(prompt).not.toContain('IMPORTANT — Previous Review Findings');
  });

  it('includes iteration count when > 1', () => {
    const task = makeTask({ iterationCount: 3 });
    const prompt = buildAgentTaskPrompt(task, '/tmp/task.json');

    expect(prompt).toContain('iteration 3');
  });

  it('includes user prompt when present', () => {
    const task = makeTask({ userPrompt: 'Build a REST API for user management' });
    const prompt = buildAgentTaskPrompt(task, '/tmp/task.json');

    expect(prompt).toContain('User Goal');
    expect(prompt).toContain('Build a REST API for user management');
  });
});

describe('extractUsageFromRawLine', () => {
  it('extracts Anthropic-style usage from result event', () => {
    const line = JSON.stringify({
      type: 'result',
      usage: { input_tokens: 1000, output_tokens: 200 },
    });
    const usage = extractUsageFromRawLine(line);
    expect(usage).toEqual({ inputTokens: 1000, outputTokens: 200, isFinal: true });
  });

  it('extracts Anthropic-style usage with cache tokens from result event', () => {
    const line = JSON.stringify({
      type: 'result',
      usage: {
        input_tokens: 500,
        output_tokens: 100,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 300,
      },
    });
    const usage = extractUsageFromRawLine(line);
    expect(usage).toEqual({ inputTokens: 1000, outputTokens: 100, isFinal: true });
  });

  it('extracts Anthropic-style usage from assistant event and marks cumulative', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { usage: { input_tokens: 800, output_tokens: 50 } },
    });
    const usage = extractUsageFromRawLine(line);
    expect(usage).toEqual({ inputTokens: 800, outputTokens: 50, cumulative: true });
  });

  it('returns null for non-JSON lines', () => {
    expect(extractUsageFromRawLine('plain text')).toBeNull();
  });

  it('returns null for events without usage', () => {
    const line = JSON.stringify({ type: 'tool_use', name: 'read' });
    expect(extractUsageFromRawLine(line)).toBeNull();
  });

  it('returns null for result event with empty usage', () => {
    const line = JSON.stringify({ type: 'result', usage: {} });
    const usage = extractUsageFromRawLine(line);
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, isFinal: true });
  });

  it('extracts Cursor camelCase usage from result event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      duration_ms: 5234,
      usage: { inputTokens: 12000, outputTokens: 3500 },
    });
    const usage = extractUsageFromRawLine(line);
    expect(usage).toEqual({ inputTokens: 12000, outputTokens: 3500, isFinal: true });
  });

  it('extracts final Codex token usage from a completed turn', () => {
    const line = JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 12000,
        cached_input_tokens: 11000,
        cache_write_input_tokens: 300,
        output_tokens: 3500,
        reasoning_output_tokens: 1000,
      },
    });
    expect(extractUsageFromRawLine(line)).toEqual({
      inputTokens: 12000,
      outputTokens: 4500,
      isFinal: true,
    });
  });

  it('does not double-count Codex cached_input_tokens against input_tokens', () => {
    const line = JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 12000,
        cached_input_tokens: 11000,
        output_tokens: 3500,
      },
    });
    expect(extractUsageFromRawLine(line)?.inputTokens).toBe(12000);
  });

  it('extracts Cursor camelCase usage from assistant event without cumulative flag', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        usage: { inputTokens: 5000, outputTokens: 1200 },
      },
    });
    const usage = extractUsageFromRawLine(line);
    expect(usage).toEqual({ inputTokens: 5000, outputTokens: 1200 });
    expect(usage?.cumulative).toBeUndefined();
  });

  it('picks the largest value when both naming conventions are present', () => {
    const line = JSON.stringify({
      type: 'result',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        inputTokens: 300,
        outputTokens: 100,
      },
    });
    const usage = extractUsageFromRawLine(line);
    expect(usage).toEqual({ inputTokens: 300, outputTokens: 100, isFinal: true });
  });

  it('extracts Cursor-style usage from result event via parseCursorEvent', () => {
    // Cursor events use the same JSON shape but are picked up by parseCursorEvent
    // when parseClaudeCodeEvent does not match. To trigger the cursorEvent path
    // we need an event that parseCursorEvent recognises but parseClaudeCodeEvent
    // does not. In practice, Cursor events include a `subtype` field.
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      duration_ms: 1234,
      usage: { inputTokens: 4000, outputTokens: 1500 },
    });
    const usage = extractUsageFromRawLine(line);
    expect(usage).toBeDefined();
    expect(usage?.isFinal).toBe(true);
    expect(usage?.inputTokens).toBe(4000);
    expect(usage?.outputTokens).toBe(1500);
  });

  it('extracts Cursor-style usage from assistant event via parseCursorEvent', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        usage: { inputTokens: 2000, outputTokens: 800 },
      },
    });
    const usage = extractUsageFromRawLine(line);
    expect(usage).toBeDefined();
    expect(usage?.inputTokens).toBe(2000);
    expect(usage?.outputTokens).toBe(800);
    // Cursor-style events without input_tokens/cache fields should NOT have cumulative
    expect(usage?.cumulative).toBeUndefined();
  });
});

describe('extractArtifactJsonFromAgentText', () => {
  it('returns JSON objects emitted as agent text', () => {
    const json = '{"id":"ctx-1","version":1,"title":"Context"}';
    expect(extractArtifactJsonFromAgentText(json)).toBe(json);
  });

  it('returns null for non-JSON text', () => {
    expect(extractArtifactJsonFromAgentText('Implemented it')).toBeNull();
    expect(extractArtifactJsonFromAgentText('[1,2,3]')).toBeNull();
  });
});

describe('parseJsonContent (via readOutput)', () => {
  it('parses concatenated JSON by extracting the last object', async () => {
    const task = makeTask();
    const first = JSON.stringify({ summary: 'first' });
    const second = JSON.stringify({
      summary: 'second',
      tokenUsage: { inputTokens: 10, outputTokens: 5 },
    });
    const dir = join(tempDir, 'output');
    await mkdir(dir, { recursive: true });
    await writeFile(task.outputArtifactPath, first + '\n' + second);

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    expect(result.artifactContent).toContain('second');
  });
});

describe('extractArtifactTokenUsage (via readOutput)', () => {
  it('returns undefined for null tokenUsage', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done', tokenUsage: null });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    expect(result.tokenUsage).toBeUndefined();
  });

  it('returns undefined for array tokenUsage', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done', tokenUsage: [1, 2, 3] });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    expect(result.tokenUsage).toBeUndefined();
  });

  it('returns undefined for object without token fields', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done', tokenUsage: { foo: 'bar' } });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    expect(result.tokenUsage).toBeUndefined();
  });

  it('returns usage when token fields have non-number values', async () => {
    const task = makeTask();
    await preWriteOutput(task, {
      summary: 'done',
      tokenUsage: { inputTokens: 'not-a-number', outputTokens: 50 },
    });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    expect(result.tokenUsage?.outputTokens).toBe(50);
  });
});

describe('buildAgentTaskPrompt additional formats', () => {
  it('includes freeform format instructions', () => {
    const task = makeTask({
      constraints: {
        timeout: 10000,
        requiredOutputType: 'implementation',
        outputFormat: 'freeform',
      },
    });
    const prompt = buildAgentTaskPrompt(task, '/tmp/task.json');
    expect(prompt).toContain('Required output format: plain text');
    expect(prompt).toContain('Overwrite the output file');
    expect(prompt).not.toContain('exactly one JSON value');
    expect(prompt).not.toContain('exactly one YAML document');
  });

  it('includes markdown_with_frontmatter format label', () => {
    const task = makeTask({
      constraints: {
        timeout: 10000,
        requiredOutputType: 'implementation',
        outputFormat: 'markdown_with_frontmatter',
      },
    });
    const prompt = buildAgentTaskPrompt(task, '/tmp/task.json');
    expect(prompt).toContain('Required output format: markdown with YAML frontmatter');
  });
});

describe('CliAgentRunner additional branches', () => {
  it('killAll kills active subprocesses and clears them', async () => {
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'sleep 60'],
      handshakeTimeoutMs: 200,
    });

    // Start a long-running dispatch without awaiting so subprocess is active
    const task = makeTask({
      constraints: { timeout: 30000, requiredOutputType: 'implementation' },
    });
    await preWriteOutput(task, { summary: 'done' });
    const dispatchPromise = runner.dispatch(task);

    // Give the subprocess time to start
    await new Promise((r) => setTimeout(r, 300));
    runner.killAll();

    const result = await dispatchPromise;
    // The result may be failure or success depending on timing; main assertion is no crash
    expect(result.taskId).toBe('task-1');
  }, 15000);

  it('closes stdin when args include --print', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true', '--print'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    // Should not hang; stdin is ended immediately for --print mode
    expect(result.taskId).toBe('task-1');
  });

  it('suppresses JSON noise lines when adapter has translateOutput', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done-via-adapter' });

    const adapter: AgentAdapter = {
      name: 'test-adapter',
      command: 'bash',
      args: ['-c', 'echo \'{"type":"noise","data":"foo"}\'; echo "DONE:done-via-adapter"'],
      translateOutput(line: string): ProtocolMessage | null {
        if (line.startsWith('DONE:')) {
          return createProtocolMessage('done', { summary: line.slice(5) });
        }
        return null;
      },
    };

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: [],
      adapter,
      handshakeTimeoutMs: 300,
    });

    await runner.dispatch(task, (e) => events.push(e));

    // JSON noise lines starting with { should be suppressed when adapter has translateOutput
    const jsonNoiseEvents = events.filter(
      (e) => e.type === 'stdout' && e.content.includes('"type":"noise"'),
    );
    expect(jsonNoiseEvents).toHaveLength(0);
  });

  it('emits exit event for non-zero exit code with non-intentional kill', async () => {
    const task = makeTask();
    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    // Exit with non-zero code after handshake but before done
    const script = `echo '${handshake}'; exit 42`;

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    await runner.dispatch(task, (e) => events.push(e));

    const exitEvents = events.filter(
      (e) => e.type === 'stderr' && e.content.includes('Process exited'),
    );
    expect(exitEvents.length).toBeGreaterThan(0);
    expect(exitEvents[0].content).toContain('code=42');
  });

  it('handles subprocess close without done when no artifact present', async () => {
    const task = makeTask();
    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    // Process exits after handshake without sending done and without artifact file
    const script = `echo '${handshake}'; sleep 0.1`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('failure');
    expect(result.error).toContain('Failed to read agent output artifact');
  });

  it('handles subprocess close with final artifact from close handler', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'written-before-close' });
    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    // Exit after handshake without done - close handler should still read output
    const script = `echo '${handshake}'; sleep 0.1`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    expect(result.artifactContent).toContain('written-before-close');
  });

  it('handles subprocess close with artifact message and no done', async () => {
    const task = makeTask();
    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    const artifact = serializeMessage(
      createProtocolMessage('artifact', {
        artifactType: 'code',
        content: 'close-handler-artifact',
        isFinal: true,
      }),
    );
    // Exit after handshake + artifact without done - close handler should use artifact
    const script = `echo '${handshake}'; echo '${artifact}'; sleep 0.1`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    expect(result.artifactContent).toBe('close-handler-artifact');
  });

  it('uses non-final artifact content as fallback when no final arrives', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'from-file' });
    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    const artifact = serializeMessage(
      createProtocolMessage('artifact', {
        artifactType: 'code',
        content: 'partial-artifact',
        isFinal: false,
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${artifact}'; echo '${done}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    // Non-final artifact should be used (since no final artifact overrode it)
    expect(result.artifactContent).toBe('partial-artifact');
  });

  it('handles non-final artifact with existing artifact keeping current', async () => {
    const task = makeTask();
    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    const artifact1 = serializeMessage(
      createProtocolMessage('artifact', {
        artifactType: 'code',
        content: 'first-partial',
        isFinal: false,
      }),
    );
    const artifact2 = serializeMessage(
      createProtocolMessage('artifact', {
        artifactType: 'code',
        content: 'second-partial',
        isFinal: false,
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${artifact1}'; echo '${artifact2}'; echo '${done}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    // When currentArtifact exists and a non-final arrives, it should keep the current
    expect(result.artifactContent).toBe('first-partial');
  });

  it('streams log messages with error/warn level to stderr', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });
    const errorLog = serializeMessage(
      createProtocolMessage('log', { level: 'error' as const, message: 'Something broke' }),
    );
    const warnLog = serializeMessage(
      createProtocolMessage('log', { level: 'warn' as const, message: 'Watch out' }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', protocolScript([errorLog, warnLog, done])],
      handshakeTimeoutMs: 2000,
    });

    await runner.dispatch(task, (e) => events.push(e));

    const stderrLogs = events.filter(
      (e) => e.type === 'stderr' && e.structuredData?.messageType === 'log',
    );
    expect(stderrLogs.length).toBeGreaterThanOrEqual(2);
    expect(stderrLogs.some((e) => e.content.includes('Something broke'))).toBe(true);
    expect(stderrLogs.some((e) => e.content.includes('Watch out'))).toBe(true);
  });

  it('handles progress message without percent', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });
    const progress = serializeMessage(
      createProtocolMessage('progress', {
        phase: 'coding',
        detail: 'Working hard',
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', protocolScript([progress, done])],
      handshakeTimeoutMs: 2000,
    });

    await runner.dispatch(task, (e) => events.push(e));

    const progressEvents = events.filter(
      (e) => e.type === 'status' && e.structuredData?.messageType === 'progress',
    );
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[0].content).toBe('Working hard');
    expect(progressEvents[0].content).not.toContain('%');
  });

  it('sends prompt via adapter.sendPrompt that returns null (no stdin write)', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const adapter: AgentAdapter = {
      name: 'claude-code',
      command: 'bash',
      args: ['-c', 'true'],
      promptViaStdin: true,
      sendPrompt(): string | null {
        return null;
      },
    };

    const runner = new CliAgentRunner({
      command: 'bash',
      args: [],
      adapter,
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    // Should complete without hanging - null from sendPrompt means no stdin write
    expect(result.taskId).toBe('task-1');
  });

  it('uses adapter.translateInput in sendToAgent when available', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'Done' });
    const translateInputCalls: ProtocolMessage[] = [];

    const adapter: AgentAdapter = {
      name: 'test-adapter',
      command: 'bash',
      args: ['-c', 'echo "PERM_REQ:file_write:src/main.ts"; sleep 0.5; echo "DONE:done"'],
      translateOutput(line: string): ProtocolMessage | null {
        if (line.startsWith('DONE:')) {
          return createProtocolMessage('done', { summary: line.slice(5) });
        }
        if (line.startsWith('PERM_REQ:')) {
          const parts = line.slice(9).split(':');
          return createProtocolMessage('permission_request', {
            action: parts[0],
            resource: parts[1],
            detail: 'test',
            riskLevel: 'low' as const,
          });
        }
        return null;
      },
      translateInput(message: ProtocolMessage): string | null {
        translateInputCalls.push(message);
        return JSON.stringify({ translated: true, type: message.type });
      },
    };

    const runner = new CliAgentRunner({
      command: 'bash',
      args: [],
      adapter,
      handshakeTimeoutMs: 300,
    });

    await runner.dispatch(task);

    // translateInput should have been called for the permission response
    expect(translateInputCalls.length).toBeGreaterThan(0);
  });

  it('falls back to transport.send when adapter.translateInput returns null', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'Done' });

    const adapter: AgentAdapter = {
      name: 'test-adapter',
      command: 'bash',
      args: ['-c', 'echo "PERM_REQ:file_write:src/main.ts"; sleep 0.5; echo "DONE:done"'],
      translateOutput(line: string): ProtocolMessage | null {
        if (line.startsWith('DONE:')) {
          return createProtocolMessage('done', { summary: line.slice(5) });
        }
        if (line.startsWith('PERM_REQ:')) {
          const parts = line.slice(9).split(':');
          return createProtocolMessage('permission_request', {
            action: parts[0],
            resource: parts[1],
            detail: 'test',
            riskLevel: 'low' as const,
          });
        }
        return null;
      },
      translateInput(): string | null {
        return null; // Returns null to trigger fallback
      },
    };

    const runner = new CliAgentRunner({
      command: 'bash',
      args: [],
      adapter,
      handshakeTimeoutMs: 300,
    });

    const result = await runner.dispatch(task);
    // Should complete without error; permission response sent via transport.send fallback
    expect(result.taskId).toBe('task-1');
  });

  it('does not duplicate --model when already in baseArgs', async () => {
    const task = makeTask({ modelHint: 'claude-sonnet-4-20250514' });
    await preWriteOutput(task, { summary: 'done' });
    const capturedArgsPath = join(tempDir, 'dup-model-args.json');
    const adapter: AgentAdapter = {
      name: 'claude-code',
      command: 'bash',
      args: [
        '-c',
        `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
        '--model',
        'existing-model',
      ],
    };

    const runner = new CliAgentRunner({
      command: 'bash',
      args: [],
      adapter,
      handshakeTimeoutMs: 300,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');

    const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
    const args = JSON.parse(serializedArgs) as string[];
    // Should have existing-model but not claude-sonnet-4-20250514
    const modelIndexes = args.reduce<number[]>((acc, arg, i) => {
      if (arg === '--model') {
        acc.push(i);
      }
      return acc;
    }, []);
    expect(modelIndexes).toHaveLength(1);
    expect(args[modelIndexes[0] + 1]).toBe('existing-model');
  });

  it('uses --task-file for non-prompt-based adapter', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });
    const capturedArgsPath = join(tempDir, 'taskfile-args.json');
    const adapter: AgentAdapter = {
      name: 'custom-agent', // Not in PROMPT_BASED_ADAPTERS
      command: 'bash',
      args: [
        '-c',
        `python3 - <<'PY' "$0" "$@"
import json
import sys

with open(${JSON.stringify(capturedArgsPath)}, "w", encoding="utf-8") as handle:
    json.dump(sys.argv[1:], handle)
PY`,
      ],
    };

    const runner = new CliAgentRunner({
      command: 'bash',
      args: [],
      adapter,
      handshakeTimeoutMs: 300,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');

    const serializedArgs = await readFile(capturedArgsPath, 'utf-8');
    const args = JSON.parse(serializedArgs) as string[];
    expect(args).toContain('--task-file');
    expect(args.every((a) => !a.includes('Read the JSON task file'))).toBe(true);
    // Non-claude-code adapters should not get --allowedTools
    expect(args.every((a) => !a.includes('--allowedTools'))).toBe(true);
  });

  it('tracks delta token usage in protocol mode', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    // Emit a cursor-style event (no input_tokens/cache fields => not cumulative => delta path)
    const event1 = JSON.stringify({
      type: 'assistant',
      message: {
        content: 'working...',
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    });
    const event2 = JSON.stringify({
      type: 'assistant',
      message: {
        content: 'still working...',
        usage: { inputTokens: 200, outputTokens: 75 },
      },
    });
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${event1}'; echo '${event2}'; echo '${done}'`;

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const result = await runner.dispatch(task, (e) => events.push(e));
    expect(result.status).toBe('success');
    // Delta usage: 100+200=300 input, 50+75=125 output
    expect(result.tokenUsage?.inputTokens).toBe(300);
    expect(result.tokenUsage?.outputTokens).toBe(125);
  });

  it('uses final usage when both delta and final are present', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    const event1 = JSON.stringify({
      type: 'assistant',
      message: {
        content: 'working...',
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    });
    const finalEvent = JSON.stringify({
      type: 'result',
      usage: { input_tokens: 999, output_tokens: 888 },
    });
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${event1}'; echo '${finalEvent}'; echo '${done}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    expect(result.tokenUsage?.inputTokens).toBe(999);
    expect(result.tokenUsage?.outputTokens).toBe(888);
  });

  it('records permission approval when granted via live request store', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'Done' });
    const recordFn = vi.fn(() => Promise.resolve());
    const mockApprovalStore: PermissionApprovalStore = {
      findMatch: vi.fn(),
      record: recordFn,
      list: vi.fn(() => []),
      remove: vi.fn(() => Promise.resolve(false)),
      clear: vi.fn(() => Promise.resolve()),
      reload: vi.fn(() => Promise.resolve()),
    };
    const awaitResponseFn = vi.fn(() =>
      Promise.resolve({
        runId: '20260101-000000-abc123',
        messageId: 'msg-1',
        respondedAt: '2026-01-01T00:00:01Z',
        payload: { granted: true, reason: 'Approved by human' },
      }),
    );
    const mockStore: LiveRequestStore = {
      writeRequest: vi.fn(() => Promise.resolve()),
      writeResponse: vi.fn(() => Promise.resolve()),
      awaitResponse: awaitResponseFn,
      listPendingRequests: vi.fn(() => Promise.resolve([])),
      cleanupResolved: vi.fn(() => Promise.resolve(0)),
    };

    const handshake = serializeMessage(
      createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
    );
    const permReq = serializeMessage(
      createProtocolMessage('permission_request', {
        action: 'file_write',
        resource: 'src/main.ts',
        detail: 'Write file',
        riskLevel: 'low' as const,
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${permReq}'; sleep 0.5; echo '${done}'`;

    const policy: PermissionPolicy = {
      evaluate: () => ({ action: 'ask_human' as const, reason: 'Needs approval' }),
    };
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });
    runner.setPermissionPolicy(policy);
    runner.setLiveRequestStore(mockStore);
    runner.setApprovalStore(mockApprovalStore);

    await runner.dispatch(task);

    expect(recordFn).toHaveBeenCalledWith({
      action: 'file_write',
      resource: 'src/main.ts',
      detail: 'Write file',
      createdByRole: 'implementer',
    });
  });

  it('handles live request timeout for permission request', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'Done' });
    const writeResponseFn = vi.fn(() => Promise.resolve());
    const mockStore: LiveRequestStore = {
      writeRequest: vi.fn(() => Promise.resolve()),
      writeResponse: writeResponseFn,
      awaitResponse: vi.fn(() => Promise.resolve(null)), // timeout
      listPendingRequests: vi.fn(() => Promise.resolve([])),
      cleanupResolved: vi.fn(() => Promise.resolve(0)),
    };

    const handshake = serializeMessage(
      createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
    );
    const permReq = serializeMessage(
      createProtocolMessage('permission_request', {
        action: 'file_write',
        resource: 'src/main.ts',
        detail: 'Write file',
        riskLevel: 'low' as const,
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${permReq}'; sleep 0.5; echo '${done}'`;

    const policy: PermissionPolicy = {
      evaluate: () => ({ action: 'ask_human' as const, reason: 'Needs approval' }),
    };
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });
    runner.setPermissionPolicy(policy);
    runner.setLiveRequestStore(mockStore);

    await runner.dispatch(task);

    // Should write a timeout response
    expect(writeResponseFn).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { timedOut: true, granted: false },
      }),
    );
  });

  it('handles clarification request with live store response', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'Done' });
    const awaitResponseFn = vi.fn(() =>
      Promise.resolve({
        runId: '20260101-000000-abc123',
        messageId: 'msg-1',
        respondedAt: '2026-01-01T00:00:01Z',
        payload: { answer: 'Use TypeScript' },
      }),
    );
    const mockStore: LiveRequestStore = {
      writeRequest: vi.fn(() => Promise.resolve()),
      writeResponse: vi.fn(() => Promise.resolve()),
      awaitResponse: awaitResponseFn,
      listPendingRequests: vi.fn(() => Promise.resolve([])),
      cleanupResolved: vi.fn(() => Promise.resolve(0)),
    };

    const handshake = serializeMessage(
      createProtocolMessage('handshake', { capabilities: ['clarification_request'] }),
    );
    const clarReq = serializeMessage(
      createProtocolMessage('clarification_request', {
        question: 'Which language to use?',
        context: 'Implementation',
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${clarReq}'; sleep 0.5; echo '${done}'`;

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });
    runner.setLiveRequestStore(mockStore);

    const result = await runner.dispatch(task, (e) => events.push(e));
    expect(result.status).toBe('success');

    const clarEvents = events.filter((e) => e.type === 'clarification_request');
    expect(clarEvents.length).toBeGreaterThan(0);
    expect(clarEvents[0].content).toContain('Which language to use?');
  });

  it('handles clarification request timeout via live store', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'Done' });
    const writeResponseFn = vi.fn(() => Promise.resolve());
    const mockStore: LiveRequestStore = {
      writeRequest: vi.fn(() => Promise.resolve()),
      writeResponse: writeResponseFn,
      awaitResponse: vi.fn(() => Promise.resolve(null)), // timeout
      listPendingRequests: vi.fn(() => Promise.resolve([])),
      cleanupResolved: vi.fn(() => Promise.resolve(0)),
    };

    const handshake = serializeMessage(
      createProtocolMessage('handshake', { capabilities: ['clarification_request'] }),
    );
    const clarReq = serializeMessage(
      createProtocolMessage('clarification_request', {
        question: 'Which language to use?',
        context: 'Implementation',
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${clarReq}'; sleep 0.5; echo '${done}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });
    runner.setLiveRequestStore(mockStore);

    await runner.dispatch(task);

    expect(writeResponseFn).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { timedOut: true, aborted: true },
      }),
    );
  });

  it('handles clarification request without live store (abort)', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'Done' });

    const handshake = serializeMessage(
      createProtocolMessage('handshake', { capabilities: ['clarification_request'] }),
    );
    const clarReq = serializeMessage(
      createProtocolMessage('clarification_request', {
        question: 'Which language to use?',
        context: 'Implementation',
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${clarReq}'; sleep 0.3; echo '${done}'`;

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const result = await runner.dispatch(task, (e) => events.push(e));
    expect(result.status).toBe('success');
    // Should emit clarification request event
    const clarEvents = events.filter((e) => e.type === 'clarification_request');
    expect(clarEvents.length).toBeGreaterThan(0);
  });

  it('uses pre-accumulated usage when artifact has no token usage', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    const usageEvent = JSON.stringify({
      type: 'assistant',
      message: {
        content: 'working...',
        usage: {
          input_tokens: 500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 100,
          output_tokens: 75,
        },
      },
    });
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${usageEvent}'; echo '${done}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    // pre-accumulated usage should be used when artifact has no usage
    expect(result.tokenUsage?.inputTokens).toBe(600);
    expect(result.tokenUsage?.outputTokens).toBe(75);
  });

  it('emits usage_update events during protocol mode token tracking', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    const usageEvent = JSON.stringify({
      type: 'assistant',
      message: {
        content: 'working...',
        usage: {
          input_tokens: 500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 100,
          output_tokens: 75,
        },
      },
    });
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${usageEvent}'; echo '${done}'`;

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    await runner.dispatch(task, (e) => events.push(e));

    const usageEvents = events.filter(
      (e) => e.type === 'status' && e.structuredData?.phase === 'usage_update',
    );
    expect(usageEvents.length).toBeGreaterThan(0);
    expect(usageEvents[0].structuredData?.inputTokens).toBeGreaterThan(0);
  });

  it('uses agentConfig command and args when provided on the task', async () => {
    const task = makeTask({
      agentConfig: {
        command: 'bash',
        args: ['-c', 'true'],
      },
    });
    await preWriteOutput(task, { summary: 'done' });

    const runner = new CliAgentRunner({
      command: 'should-not-be-used',
      args: ['--should-not-appear'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
  });

  it('uses config args when no adapter and no agentConfig', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
  });

  it('falls back to legacy mode when no handshake and no adapter translateOutput', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'legacy-result' });

    // Script outputs usage data in legacy format (no protocol, no adapter)
    const usageEvent = JSON.stringify({
      type: 'result',
      usage: { input_tokens: 300, output_tokens: 150 },
    });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', `echo '${usageEvent}'`],
      handshakeTimeoutMs: 200,
    });

    const events: AgentOutputStreamEvent[] = [];
    const result = await runner.dispatch(task, (e) => events.push(e));
    expect(result.status).toBe('success');
    // Legacy mode should pick up final usage
    expect(result.tokenUsage?.inputTokens).toBe(300);
    expect(result.tokenUsage?.outputTokens).toBe(150);
  });

  it('stays in protocol result promise when adapter.translateOutput exists but no handshake', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'adapter-no-handshake' });

    const adapter: AgentAdapter = {
      name: 'test-adapter',
      command: 'bash',
      // Script outputs a done event that the adapter will translate
      args: ['-c', 'sleep 0.2; echo "ADAPTER_DONE:result"'],
      translateOutput(line: string): ProtocolMessage | null {
        if (line.startsWith('ADAPTER_DONE:')) {
          return createProtocolMessage('done', { summary: line.slice(13) });
        }
        return null;
      },
    };

    const runner = new CliAgentRunner({
      command: 'bash',
      args: [],
      adapter,
      handshakeTimeoutMs: 300,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
  });

  it('handles permission denied response from live request store', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'Done' });
    const awaitResponseFn = vi.fn(() =>
      Promise.resolve({
        runId: '20260101-000000-abc123',
        messageId: 'msg-1',
        respondedAt: '2026-01-01T00:00:01Z',
        payload: { granted: false, reason: 'Denied by human' },
      }),
    );
    const mockStore: LiveRequestStore = {
      writeRequest: vi.fn(() => Promise.resolve()),
      writeResponse: vi.fn(() => Promise.resolve()),
      awaitResponse: awaitResponseFn,
      listPendingRequests: vi.fn(() => Promise.resolve([])),
      cleanupResolved: vi.fn(() => Promise.resolve(0)),
    };

    const handshake = serializeMessage(
      createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
    );
    const permReq = serializeMessage(
      createProtocolMessage('permission_request', {
        action: 'shell_execute',
        resource: 'rm -rf /',
        detail: 'Dangerous',
        riskLevel: 'high' as const,
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${permReq}'; sleep 0.5; echo '${done}'`;

    const events: AgentOutputStreamEvent[] = [];
    const policy: PermissionPolicy = {
      evaluate: () => ({ action: 'ask_human' as const, reason: 'Needs approval' }),
    };
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });
    runner.setPermissionPolicy(policy);
    runner.setLiveRequestStore(mockStore);

    const result = await runner.dispatch(task, (e) => events.push(e));
    expect(result.status).toBe('success');

    const permResponseEvents = events.filter(
      (e) => e.type === 'permission_request' && e.content.includes('denied'),
    );
    expect(permResponseEvents.length).toBeGreaterThan(0);
  });

  it('handles dispatchWithSession falling back to dispatch on handshake failure', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'fallback-result' });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'], // No protocol handshake
      handshakeTimeoutMs: 200,
    });

    const events: AgentOutputStreamEvent[] = [];
    const result = await runner.dispatchWithSession(task, (e) => events.push(e));
    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.result.status).toBe('success');
    }
  }, 15000);

  it('uses liveRequestTimeoutMs from agentConfig', async () => {
    const task = makeTask({
      agentConfig: { liveRequestTimeoutMs: 100 },
    });
    await preWriteOutput(task, { summary: 'Done' });
    const writeRequestFn = vi.fn(() => Promise.resolve());
    const awaitResponseFn = vi.fn(() =>
      Promise.resolve({
        runId: '20260101-000000-abc123',
        messageId: 'msg-1',
        respondedAt: '2026-01-01T00:00:01Z',
        payload: { granted: true },
      }),
    );
    const mockStore: LiveRequestStore = {
      writeRequest: writeRequestFn,
      writeResponse: vi.fn(() => Promise.resolve()),
      awaitResponse: awaitResponseFn,
      listPendingRequests: vi.fn(() => Promise.resolve([])),
      cleanupResolved: vi.fn(() => Promise.resolve(0)),
    };

    const handshake = serializeMessage(
      createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
    );
    const permReq = serializeMessage(
      createProtocolMessage('permission_request', {
        action: 'file_write',
        resource: 'test.ts',
        detail: 'Write',
        riskLevel: 'low' as const,
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${permReq}'; sleep 0.5; echo '${done}'`;

    const policy: PermissionPolicy = {
      evaluate: () => ({ action: 'ask_human' as const, reason: 'Needs approval' }),
    };
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
      liveRequestTimeoutMs: 999,
    });
    runner.setPermissionPolicy(policy);
    runner.setLiveRequestStore(mockStore);

    await runner.dispatch(task);

    // agentConfig liveRequestTimeoutMs (100) should take priority
    expect(awaitResponseFn).toHaveBeenCalledWith('20260101-000000-abc123', expect.any(String), 100);
  });

  it('emits cli_prompt event with the prompt content', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
    });

    const events: AgentOutputStreamEvent[] = [];
    await runner.dispatch(task, (e) => events.push(e));

    const cliPromptEvents = events.filter(
      (e) => e.type === 'status' && e.structuredData?.messageType === 'cli_prompt',
    );
    expect(cliPromptEvents.length).toBeGreaterThan(0);
    expect(cliPromptEvents[0].structuredData?.cliPrompt).toBeDefined();
  });

  it('dispatchWithSession returns session handle on successful handshake', async () => {
    const task = makeTask({
      constraints: { timeout: 10000, requiredOutputType: 'implementation' },
    });

    const handshake = serializeMessage(
      createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
    );
    // Process that performs handshake and then waits
    const script = `echo '${handshake}'; sleep 30`;

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const resultPromise = runner.dispatchWithSession(task, (e) => events.push(e));

    // Give time for handshake to complete
    await new Promise((r) => setTimeout(r, 1500));

    // Kill the subprocess to end the test
    runner.killAll();

    const result = await resultPromise;
    expect(result.kind).toBe('session');
    if (result.kind === 'session') {
      expect(result.handle.ref.sessionId).toContain('task-1');
      expect(result.handle.ref.role).toBe('implementer');
      expect(result.handle.ref.transport).toBe('stdio');
    }
  }, 15000);

  it('dispatchWithSession with session supervisor registers host', async () => {
    const task = makeTask({
      constraints: { timeout: 10000, requiredOutputType: 'implementation' },
    });

    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    const script = `echo '${handshake}'; sleep 30`;

    const registerHostFn = vi.fn(() => Promise.resolve());
    const mockSupervisor = { registerHost: registerHostFn };

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });
    runner.setSessionSupervisor(mockSupervisor as never);

    const resultPromise = runner.dispatchWithSession(task);
    await new Promise((r) => setTimeout(r, 1500));
    runner.killAll();

    const result = await resultPromise;
    expect(result.kind).toBe('session');
    expect(registerHostFn).toHaveBeenCalledOnce();
  }, 15000);

  it('dispatchWithSession uses adapter command and stdin prompt', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const stdinCapturePath = join(tempDir, 'session-stdin-capture.txt');
    const adapter: AgentAdapter = {
      name: 'claude-code',
      command: 'bash',
      args: ['-c', `head -n 1 > ${JSON.stringify(stdinCapturePath)}`],
      promptViaStdin: true,
      sendPrompt(prompt: string): string {
        return JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } });
      },
    };

    const runner = new CliAgentRunner({
      command: 'bash',
      args: [],
      adapter,
      handshakeTimeoutMs: 300,
    });

    // Handshake will fail (no protocol from the script), so it falls back to dispatch
    const result = await runner.dispatchWithSession(task);
    expect(result.kind).toBe('terminal');
  }, 15000);

  it('dispatchWithSession uses --print flag to end stdin', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true', '--print'],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatchWithSession(task);
    expect(result.kind).toBe('terminal');
  }, 15000);

  it('dispatchWithSession skips handshake and single-spawns non-protocol adapters', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'done' });
    const launchCountPath = join(tempDir, 'launch-count.txt');

    const adapter: AgentAdapter = {
      name: 'codex',
      command: 'bash',
      args: [
        '-c',
        `count=$(cat ${JSON.stringify(launchCountPath)} 2>/dev/null || echo 0); echo $((count + 1)) > ${JSON.stringify(launchCountPath)}; echo '{"type":"turn.completed"}'`,
      ],
      supportsProtocolHandshake: false,
      translateOutput(line: string): ProtocolMessage | null {
        if (line.includes('turn.completed')) {
          return createProtocolMessage('done', { summary: 'ok' });
        }
        return null;
      },
    };

    const runner = new CliAgentRunner({
      command: 'bash',
      args: [],
      adapter,
      handshakeTimeoutMs: 5000,
    });

    const result = await runner.dispatchWithSession(task);
    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.result.status).toBe('success');
    }

    const launches = await readFile(launchCountPath, 'utf-8');
    expect(launches.trim()).toBe('1');
  }, 15000);

  it('legacy mode extracts token usage from stdout lines', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'legacy-usage-test' });

    // The script needs to sleep past handshake timeout then output usage data
    const usageEvent = JSON.stringify({
      type: 'assistant',
      message: {
        content: 'working...',
        usage: {
          input_tokens: 200,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 100,
          output_tokens: 75,
        },
      },
    });
    // Sleep 0.3s (past 200ms handshake timeout), then output data
    const script = `sleep 0.3; echo '${usageEvent}'`;

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task, (e) => events.push(e));
    expect(result.status).toBe('success');

    // Legacy mode should have captured the usage
    const usageEvents = events.filter(
      (e) => e.type === 'status' && e.structuredData?.phase === 'usage_update',
    );
    expect(usageEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('legacy mode handles final usage event from stdout', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'legacy-final-usage' });

    const finalEvent = JSON.stringify({
      type: 'result',
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    const script = `sleep 0.3; echo '${finalEvent}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    expect(result.tokenUsage?.inputTokens).toBe(1000);
    expect(result.tokenUsage?.outputTokens).toBe(500);
  });

  it('legacy mode processes lineBuffer remainder after subprocess exits', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'line-buffer-test' });

    // Output without trailing newline so it stays in lineBuffer
    const finalEvent = JSON.stringify({
      type: 'result',
      usage: { input_tokens: 800, output_tokens: 400 },
    });
    const script = `sleep 0.3; printf '${finalEvent}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    // lineBuffer remainder should be processed - final usage from printf (no newline)
    expect(result.tokenUsage?.inputTokens).toBe(800);
    expect(result.tokenUsage?.outputTokens).toBe(400);
  });

  it('legacy mode extracts delta (non-cumulative) usage events', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'delta-usage-test' });

    // Cursor-style events (no input_tokens/cache fields => delta path)
    const event1 = JSON.stringify({
      type: 'assistant',
      message: {
        content: 'working...',
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    });
    const event2 = JSON.stringify({
      type: 'assistant',
      message: {
        content: 'still...',
        usage: { inputTokens: 200, outputTokens: 75 },
      },
    });
    const script = `sleep 0.3; echo '${event1}'; echo '${event2}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    // Delta: 100+200=300 input, 50+75=125 output
    expect(result.tokenUsage?.inputTokens).toBe(300);
    expect(result.tokenUsage?.outputTokens).toBe(125);
  });

  it('legacy mode streams stderr events', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'stderr-test' });

    const script = `sleep 0.3; echo 'warning: something' >&2`;

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 200,
    });

    await runner.dispatch(task, (e) => events.push(e));

    const stderrEvents = events.filter((e) => e.type === 'stderr' && e.content.includes('warning'));
    expect(stderrEvents.length).toBeGreaterThan(0);
  });

  it('legacy mode with initial usage carries values into legacy tracking', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'initial-usage-test' });

    // Output cumulative usage during handshake phase (before legacy mode starts)
    const preUsage = JSON.stringify({
      type: 'assistant',
      message: {
        content: 'pre-handshake...',
        usage: {
          input_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 150,
          output_tokens: 30,
        },
      },
    });
    // Then after handshake timeout, output more data in legacy mode
    const postUsage = JSON.stringify({
      type: 'result',
      usage: { input_tokens: 500, output_tokens: 250 },
    });
    const script = `echo '${preUsage}'; sleep 0.3; echo '${postUsage}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 200,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
    // Should have the larger of the pre-handshake and post-handshake values
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage?.inputTokens).toBeGreaterThanOrEqual(200);
  });

  it('uses defaultTimeoutMs when task has no timeout', async () => {
    const task = makeTask({
      constraints: { timeout: 0, requiredOutputType: 'implementation' },
    });
    await preWriteOutput(task, { summary: 'done' });

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', 'true'],
      handshakeTimeoutMs: 200,
      defaultTimeoutMs: 5000,
    });

    const result = await runner.dispatch(task);
    expect(result.status).toBe('success');
  });

  it('protocol mode timeout fires when agent exceeds protocol timeout', async () => {
    const task = makeTask({
      constraints: { timeout: 1000, requiredOutputType: 'implementation' },
    });

    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    // Handshake succeeds but then process hangs without sending done
    const script = `echo '${handshake}'; sleep 30`;

    const events: AgentOutputStreamEvent[] = [];
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    const result = await runner.dispatch(task, (e) => events.push(e));
    expect(result.status).toBe('timeout');
    expect(result.error).toContain('timed out');

    const timeoutEvents = events.filter(
      (e) => e.type === 'stderr' && e.structuredData?.code === 'timeout',
    );
    expect(timeoutEvents.length).toBeGreaterThan(0);
  }, 15000);

  it('handles permission request with invalid live response payload', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'Done' });
    const awaitResponseFn = vi.fn(() =>
      Promise.resolve({
        runId: '20260101-000000-abc123',
        messageId: 'msg-1',
        respondedAt: '2026-01-01T00:00:01Z',
        payload: { invalid: 'data' }, // Does not match schema
      }),
    );
    const mockStore: LiveRequestStore = {
      writeRequest: vi.fn(() => Promise.resolve()),
      writeResponse: vi.fn(() => Promise.resolve()),
      awaitResponse: awaitResponseFn,
      listPendingRequests: vi.fn(() => Promise.resolve([])),
      cleanupResolved: vi.fn(() => Promise.resolve(0)),
    };

    const handshake = serializeMessage(
      createProtocolMessage('handshake', { capabilities: ['permission_request'] }),
    );
    const permReq = serializeMessage(
      createProtocolMessage('permission_request', {
        action: 'file_write',
        resource: 'test.ts',
        detail: 'Write',
        riskLevel: 'low' as const,
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${permReq}'; sleep 0.5; echo '${done}'`;

    const policy: PermissionPolicy = {
      evaluate: () => ({ action: 'ask_human' as const, reason: 'Needs approval' }),
    };
    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });
    runner.setPermissionPolicy(policy);
    runner.setLiveRequestStore(mockStore);

    const events: AgentOutputStreamEvent[] = [];
    await runner.dispatch(task, (e) => events.push(e));

    // Invalid payload should result in denied (safeParse fails => granted=false)
    const permEvents = events.filter(
      (e) => e.type === 'permission_request' && e.content.includes('denied'),
    );
    expect(permEvents.length).toBeGreaterThan(0);
  });

  it('handles clarification response with invalid payload (empty answer)', async () => {
    const task = makeTask();
    await preWriteOutput(task, { summary: 'Done' });
    const awaitResponseFn = vi.fn(() =>
      Promise.resolve({
        runId: '20260101-000000-abc123',
        messageId: 'msg-1',
        respondedAt: '2026-01-01T00:00:01Z',
        payload: { invalid: 'not-an-answer' }, // Does not match schema
      }),
    );
    const mockStore: LiveRequestStore = {
      writeRequest: vi.fn(() => Promise.resolve()),
      writeResponse: vi.fn(() => Promise.resolve()),
      awaitResponse: awaitResponseFn,
      listPendingRequests: vi.fn(() => Promise.resolve([])),
      cleanupResolved: vi.fn(() => Promise.resolve(0)),
    };

    const handshake = serializeMessage(
      createProtocolMessage('handshake', { capabilities: ['clarification_request'] }),
    );
    const clarReq = serializeMessage(
      createProtocolMessage('clarification_request', {
        question: 'Which language?',
        context: 'Implementation',
      }),
    );
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${clarReq}'; sleep 0.5; echo '${done}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });
    runner.setLiveRequestStore(mockStore);

    const result = await runner.dispatch(task);
    // Should still complete successfully despite invalid payload
    expect(result.status).toBe('success');
  });

  it('emits error and resolves failure when readOutput rejects during done handler', async () => {
    const task = makeTask();
    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    const done = serializeMessage(createProtocolMessage('done', { summary: 'Done' }));
    const script = `echo '${handshake}'; echo '${done}'`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    vi.spyOn(
      runner as unknown as { readOutput: () => Promise<unknown> },
      'readOutput',
    ).mockRejectedValueOnce(new Error('Unexpected filesystem failure'));

    const events: AgentOutputStreamEvent[] = [];
    const result = await runner.dispatch(task, (e) => events.push(e));

    expect(result.status).toBe('failure');
    expect(result.error).toContain('Failed to read output after done');
    expect(result.error).toContain('Unexpected filesystem failure');

    const errorEvents = events.filter(
      (e) => e.type === 'stderr' && e.structuredData?.code === 'read_output_failed',
    );
    expect(errorEvents).toHaveLength(1);
  });

  it('emits error and resolves failure when readOutput rejects during close handler', async () => {
    const task = makeTask();
    const handshake = serializeMessage(createProtocolMessage('handshake', { capabilities: [] }));
    // Process exits after handshake without sending done — triggers close handler
    const script = `echo '${handshake}'; sleep 0.1`;

    const runner = new CliAgentRunner({
      command: 'bash',
      args: ['-c', script],
      handshakeTimeoutMs: 2000,
    });

    vi.spyOn(
      runner as unknown as { readOutput: () => Promise<unknown> },
      'readOutput',
    ).mockRejectedValueOnce(new Error('Disk I/O error'));

    const events: AgentOutputStreamEvent[] = [];
    const result = await runner.dispatch(task, (e) => events.push(e));

    expect(result.status).toBe('failure');
    expect(result.error).toContain('Failed to read output on close');
    expect(result.error).toContain('Disk I/O error');

    const errorEvents = events.filter(
      (e) => e.type === 'stderr' && e.structuredData?.code === 'read_output_failed',
    );
    expect(errorEvents).toHaveLength(1);
  });
});
