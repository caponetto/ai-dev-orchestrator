import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import type { AgentOutputStreamEvent } from '@ai-dev-orchestrator/ports';
import type { AgentSessionRef } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentSessionRegistry } from '../agent-session-registry';
import { DefaultAgentSessionStore } from '../default-agent-session-store';
import { LocalAgentSessionHost } from '../local-agent-session-host';
import { LocalAgentSessionSupervisor } from '../local-agent-session-supervisor';
import { serializeMessage } from '../protocol-serializer';
import { StdioProtocolTransport } from '../stdio-protocol-transport';

function createMockProcess(): ChildProcess & {
  mockStdin: PassThrough;
  mockStdout: PassThrough;
  mockStderr: PassThrough;
} {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const proc = new EventEmitter() as ChildProcess & {
    mockStdin: PassThrough;
    mockStdout: PassThrough;
    mockStderr: PassThrough;
  };
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  Object.defineProperty(proc, 'pid', { value: 12345, writable: true });
  Object.defineProperty(proc, 'exitCode', { value: null, writable: true });
  Object.defineProperty(proc, 'signalCode', { value: null, writable: true });
  proc.kill = () => true;
  proc.mockStdin = stdin;
  proc.mockStdout = stdout;
  proc.mockStderr = stderr;
  return proc;
}

function sendProtocolLine(
  stdout: PassThrough,
  message: ReturnType<typeof createProtocolMessage>,
): void {
  stdout.write(serializeMessage(message) + '\n');
}

const REF: AgentSessionRef = {
  sessionId: 'sess-1',
  runId: 'run-1',
  stateId: 'IMPL',
  role: 'implementer',
  transport: 'stdio',
};

describe('LocalAgentSessionHost', () => {
  it('tracks pending permission requests', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('permission_request', {
        action: 'write_file',
        resource: '/src/main.ts',
        riskLevel: 'medium',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(host.state).toBe('awaiting_human');
    expect(host.pendingRequests).toHaveLength(1);
    expect(host.pendingRequests[0].kind).toBe('permission');
  });

  it('delivers human response and clears pending', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('permission_request', {
        action: 'write_file',
        resource: '/src/main.ts',
        riskLevel: 'medium',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    const requestId = host.pendingRequests[0].requestId;

    const sent = host.sendHumanResponse(requestId, { granted: true, reason: 'approved' });
    expect(sent).toBe(true);
    expect(host.pendingRequests).toHaveLength(0);
    expect(host.state).toBe('running');
  });

  it('completes on done message', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('artifact', {
        name: 'output',
        type: 'code',
        content: '{"result": "done"}',
        isFinal: true,
      }),
    );
    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('done', {
        summary: 'completed',
      }),
    );

    const result = await host.resultPromise;
    expect(result.status).toBe('success');
    expect(result.artifactContent).toBe('{"result": "done"}');
    expect(host.state).toBe('completed');
  });

  it('handles abort', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    host.abort('user requested');

    const result = await host.resultPromise;
    expect(result.status).toBe('failure');
    expect(result.error).toContain('aborted');
    expect(host.state).toBe('aborted');
  });

  it('returns false for unknown request id', () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    const sent = host.sendHumanResponse('nonexistent', { granted: true });
    expect(sent).toBe(false);
  });

  it('handles error message from agent', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('error', {
        code: 'FATAL',
        message: 'something broke',
        recoverable: false,
      }),
    );

    const result = await host.resultPromise;
    expect(host.state).toBe('failed');
    expect(result.status).toBe('failure');
    expect(result.error).toContain('FATAL');
    expect(result.error).toContain('something broke');
  });

  it('handles process exit with final artifact (success)', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('artifact', {
        name: 'output',
        type: 'code',
        content: '{"result": "from artifact"}',
        isFinal: true,
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    proc.emit('exit', 0, null);

    const result = await host.resultPromise;
    expect(result.status).toBe('success');
    expect(result.artifactContent).toBe('{"result": "from artifact"}');
    expect(host.state).toBe('completed');
  });

  it('handles process exit without artifact (failure)', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    proc.emit('exit', 1, null);

    const result = await host.resultPromise;
    expect(result.status).toBe('failure');
    expect(result.error).toContain('exited unexpectedly');
    expect(host.state).toBe('failed');
  });

  it('removeStreamHandler removes a handler', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    const events: AgentOutputStreamEvent[] = [];
    const handler = (event: AgentOutputStreamEvent): void => {
      events.push(event);
    };
    host.addStreamHandler(handler);

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('log', {
        level: 'info',
        message: 'first log',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBeGreaterThan(0);

    const countBefore = events.length;
    host.removeStreamHandler(handler);

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('log', {
        level: 'info',
        message: 'second log',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBe(countBefore);
  });

  it('waitForAdvance returns immediately for completed host', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    sendProtocolLine(proc.mockStdout, createProtocolMessage('done', { summary: 'all done' }));

    await host.resultPromise;
    expect(host.state).toBe('completed');

    const advance = await host.waitForAdvance();
    expect(advance.kind).toBe('completed');
  });

  it('waitForAdvance returns failed for aborted host', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    host.abort('user cancelled');

    const advance = await host.waitForAdvance();
    expect(advance.kind).toBe('failed');
  });

  it('waitForAdvance returns awaiting_human when pending requests exist', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('permission_request', {
        action: 'write_file',
        resource: '/src/main.ts',
        riskLevel: 'medium',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(host.state).toBe('awaiting_human');

    const advance = await host.waitForAdvance();
    expect(advance.kind).toBe('awaiting_human');
    if (advance.kind === 'awaiting_human') {
      expect(advance.pendingRequest.kind).toBe('permission');
    }
  });

  it('isAlive returns true for running process', () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    expect(host.isAlive()).toBe(true);
  });

  it('isAlive returns false after process exits', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    Object.defineProperty(proc, 'exitCode', { value: 0, writable: true });
    proc.emit('exit', 0, null);

    await new Promise((r) => setTimeout(r, 50));
    expect(host.isAlive()).toBe(false);
  });

  it('handles clarification request', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('clarification_request', {
        question: 'Which database?',
        context: 'migration setup',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(host.state).toBe('awaiting_human');
    expect(host.pendingRequests).toHaveLength(1);
    expect(host.pendingRequests[0].kind).toBe('clarification');

    const requestId = host.pendingRequests[0].requestId;
    const sent = host.sendHumanResponse(requestId, { answer: 'the answer' });
    expect(sent).toBe(true);
    expect(host.pendingRequests).toHaveLength(0);
    expect(host.state).toBe('running');
  });

  it('handles non-final artifact followed by final artifact', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('artifact', {
        name: 'intermediate',
        type: 'code',
        content: '{"version": "draft"}',
        isFinal: false,
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('artifact', {
        name: 'final',
        type: 'code',
        content: '{"version": "final"}',
        isFinal: true,
      }),
    );

    sendProtocolLine(proc.mockStdout, createProtocolMessage('done', { summary: 'completed' }));

    const result = await host.resultPromise;
    expect(result.status).toBe('success');
    expect(result.artifactContent).toBe('{"version": "final"}');
  });

  it('setTimeout triggers timeout', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    host.setTimeout(50);

    await new Promise((r) => setTimeout(r, 100));

    expect(host.state).toBe('failed');
    const result = await host.resultPromise;
    expect(result.status).toBe('timeout');
  });

  it('formatProgress with percent and without percent', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    const events: AgentOutputStreamEvent[] = [];
    host.addStreamHandler((event) => {
      if (event.type === 'status') {
        events.push(event);
      }
    });

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('progress', {
        phase: 'build',
        detail: 'compiling',
        percent: 50,
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('progress', {
        phase: 'test',
        detail: 'running tests',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(events).toHaveLength(2);
    expect(events[0].content).toBe('[build] compiling (50%)');
    expect(events[1].content).toBe('[test] running tests');
  });

  it('token usage tracking via raw lines', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    // Send a Claude Code result event with usage as a raw JSON line (not a protocol message)
    const resultEvent = JSON.stringify({
      type: 'result',
      result: 'done',
      usage: {
        input_tokens: 300,
        output_tokens: 200,
      },
    });
    proc.mockStdout.write(resultEvent + '\n');

    await new Promise((r) => setTimeout(r, 50));

    sendProtocolLine(proc.mockStdout, createProtocolMessage('done', { summary: 'completed' }));

    const result = await host.resultPromise;
    expect(result.status).toBe('success');
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage?.inputTokens).toBe(300);
    expect(result.tokenUsage?.outputTokens).toBe(200);
  });
});

describe('LocalAgentSessionSupervisor', () => {
  let dir: string;
  let store: DefaultAgentSessionStore;
  let registry: AgentSessionRegistry;
  let supervisor: LocalAgentSessionSupervisor;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-supervisor-'));
    store = new DefaultAgentSessionStore(dir);
    registry = new AgentSessionRegistry(store);
    supervisor = new LocalAgentSessionSupervisor(registry);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function setupFactory(): { getLastProcess: () => ReturnType<typeof createMockProcess> } {
    let lastProc: ReturnType<typeof createMockProcess> | undefined;
    supervisor.setHostFactory((ref, onStreamEvent) => {
      const proc = createMockProcess();
      lastProc = proc;
      const transport = new StdioProtocolTransport({
        stdin: proc.mockStdin,
        stdout: proc.mockStdout,
        stderr: proc.mockStderr,
      });
      const host = new LocalAgentSessionHost(ref, proc, transport, Date.now());
      if (onStreamEvent) {
        host.addStreamHandler(onStreamEvent);
      }
      return Promise.resolve(host);
    });
    return { getLastProcess: () => lastProc as ReturnType<typeof createMockProcess> };
  }

  it('creates a session and persists snapshot', async () => {
    setupFactory();
    const handle = await supervisor.createSession(REF);
    expect(handle.ref.sessionId).toBe('sess-1');
    expect(handle.state).toBe('running');

    const snap = await supervisor.getSnapshot('sess-1');
    expect(snap).not.toBeNull();
    expect(snap?.ref.sessionId).toBe('sess-1');
  });

  it('attaches to existing session', async () => {
    setupFactory();
    await supervisor.createSession(REF);

    const events: string[] = [];
    const handle = await supervisor.attach('sess-1', (e) => events.push(e.content));
    expect(handle).not.toBeNull();
    expect(handle?.ref.sessionId).toBe('sess-1');
  });

  it('returns null when attaching to unknown session', async () => {
    const handle = await supervisor.attach('nonexistent');
    expect(handle).toBeNull();
  });

  it('sends human response through host', async () => {
    const { getLastProcess } = setupFactory();
    await supervisor.createSession(REF);
    const proc = getLastProcess();

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('permission_request', {
        action: 'write_file',
        resource: '/src/main.ts',
        riskLevel: 'medium',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const snap = await supervisor.getSnapshot('sess-1');
    const requestId = (snap as NonNullable<typeof snap>).pendingRequests[0].requestId;

    const sent = await supervisor.sendHumanResponse('sess-1', requestId, { granted: true });
    expect(sent).toBe(true);

    const updated = await supervisor.getSnapshot('sess-1');
    expect(updated?.pendingRequests).toHaveLength(0);
  });

  it('aborts a session', async () => {
    setupFactory();
    await supervisor.createSession(REF);

    const aborted = await supervisor.abort('sess-1', 'test abort');
    expect(aborted).toBe(true);

    const state = supervisor.getState('sess-1');
    expect(state).toBe('aborted');
  });

  it('lists sessions by run', async () => {
    setupFactory();
    await supervisor.createSession(REF);
    await supervisor.createSession({
      ...REF,
      sessionId: 'sess-2',
      role: 'reviewer',
    });

    const sessions = await supervisor.listByRun('run-1');
    expect(sessions).toHaveLength(2);
  });

  it('finalizes and removes host from memory', async () => {
    setupFactory();
    await supervisor.createSession(REF);

    await supervisor.finalize('sess-1');
    expect(supervisor.getHost('sess-1')).toBeUndefined();

    const snap = registry.get('sess-1');
    expect(snap).not.toBeNull();
  });

  it('throws when no host factory configured', async () => {
    await expect(supervisor.createSession(REF)).rejects.toThrow('No host factory');
  });

  it('registerHost persists snapshot to registry immediately', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    await supervisor.registerHost(host);

    const snap = await supervisor.getSnapshot('sess-1');
    expect(snap).not.toBeNull();
    expect(snap?.ref.sessionId).toBe('sess-1');
    expect(snap?.ref.transport).toBe('stdio');
  });

  it('fresh supervisor after restart returns null from attach for stdio sessions', async () => {
    const proc = createMockProcess();
    const transport = new StdioProtocolTransport({
      stdin: proc.mockStdin,
      stdout: proc.mockStdout,
      stderr: proc.mockStderr,
    });
    const host = new LocalAgentSessionHost(REF, proc, transport, Date.now());

    await supervisor.registerHost(host);

    const freshRegistry = new AgentSessionRegistry(store);
    await freshRegistry.rebuild();
    const freshSupervisor = new LocalAgentSessionSupervisor(freshRegistry);

    const handle = await freshSupervisor.attach('sess-1');
    expect(handle).toBeNull();

    const snap = await freshSupervisor.getSnapshot('sess-1');
    expect(snap).not.toBeNull();
    expect(snap?.ref.sessionId).toBe('sess-1');
  });

  it('sendHumanResponse returns false for unknown session', async () => {
    const sent = await supervisor.sendHumanResponse('nonexistent', 'req-1', { granted: true });
    expect(sent).toBe(false);
  });

  it('sendHumanResponse with answer and reason fields', async () => {
    const { getLastProcess } = setupFactory();
    await supervisor.createSession(REF);
    const proc = getLastProcess();

    sendProtocolLine(
      proc.mockStdout,
      createProtocolMessage('clarification_request', {
        question: 'Which option?',
        context: 'config setup',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const snap = await supervisor.getSnapshot('sess-1');
    const requestId = (snap as NonNullable<typeof snap>).pendingRequests[0].requestId;

    const sent = await supervisor.sendHumanResponse('sess-1', requestId, {
      answer: 'my answer',
      reason: 'because',
    });
    expect(sent).toBe(true);

    const updated = await supervisor.getSnapshot('sess-1');
    expect(updated?.pendingRequests).toHaveLength(0);
  });

  it('pause returns false for completed session', async () => {
    const { getLastProcess } = setupFactory();
    await supervisor.createSession(REF);
    const proc = getLastProcess();

    sendProtocolLine(proc.mockStdout, createProtocolMessage('done', { summary: 'completed' }));

    await new Promise((r) => setTimeout(r, 50));

    const paused = await supervisor.pause('sess-1');
    expect(paused).toBe(false);
  });

  it('pause returns false for non-existent session', async () => {
    const paused = await supervisor.pause('nonexistent');
    expect(paused).toBe(false);
  });

  it('pause returns true for running session', async () => {
    setupFactory();
    await supervisor.createSession(REF);

    const paused = await supervisor.pause('sess-1');
    expect(paused).toBe(true);
  });

  it('getState returns state from registry when not in hosts map', async () => {
    setupFactory();
    await supervisor.createSession(REF);

    await supervisor.finalize('sess-1');
    expect(supervisor.getHost('sess-1')).toBeUndefined();

    const state = supervisor.getState('sess-1');
    expect(state).toBe('running');
  });

  it('getState returns null for unknown session', () => {
    const state = supervisor.getState('unknown');
    expect(state).toBeNull();
  });

  it('waitForAdvance returns failed for unknown session', async () => {
    const result = await supervisor.waitForAdvance('nonexistent');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error).toContain('nonexistent');
    }
  });
});
