import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PassThrough } from 'node:stream';

import type { AgentDispatchResult, AgentOutputStreamEvent } from '@ai-dev-orchestrator/ports';
import type { AgentResult, AgentSessionRef, AgentTask } from '@ai-dev-orchestrator/schemas';
import { OwnedProcess } from '@ai-dev-orchestrator/utils/owned-process';
import { execa } from 'execa';

import {
  buildInvocationArgs,
  configureCliSubprocessStdin,
  resolveCliSubprocessStdinOption,
} from './cli-invocation';
import { cancelledAgentResult } from './cli-process-registry';
import type { CliProcessRegistry } from './cli-process-registry';
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  KILL_GRACE_MS,
} from './cli-runner-config';
import type { CliAgentRunnerConfig } from './cli-runner-config';
import { LocalAgentSessionHost } from './local-agent-session-host';
import type { LocalAgentSessionSupervisor } from './local-agent-session-supervisor';
import { StdioProtocolTransport } from './stdio-protocol-transport';

interface CliSessionExecutionOptions {
  readonly config: CliAgentRunnerConfig;
  readonly processes: CliProcessRegistry;
  readonly getSupervisor: () => LocalAgentSessionSupervisor | undefined;
  readonly dispatchFallback: () => Promise<AgentResult>;
}

/** Negotiate and register a supervised subprocess, using the runner's shared cancellation owner. */
export async function createCliSession(
  task: AgentTask,
  options: CliSessionExecutionOptions,
  onStreamEvent?: (event: AgentOutputStreamEvent) => void,
): Promise<AgentDispatchResult> {
  const { config, processes, getSupervisor, dispatchFallback } = options;
  const adapter = config.adapter;
  if (adapter?.supportsProtocolHandshake === false) {
    const result = await dispatchFallback();
    return { kind: 'terminal', result };
  }

  const startTime = Date.now();
  const generation = processes.generation;
  const timeoutMs = task.constraints.timeout || config.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;

  const taskFilePath = `${task.runDir}/agent-tasks/${task.taskId}.json`;
  await mkdir(dirname(taskFilePath), { recursive: true });
  await writeFile(taskFilePath, JSON.stringify(task, null, 2));
  await mkdir(dirname(task.outputArtifactPath), { recursive: true });

  const cliConfig = task.agentConfig;
  const command = cliConfig?.command ?? (adapter ? adapter.command : config.command);
  const baseArgs = cliConfig?.args ?? (adapter ? adapter.args : (config.args ?? []));
  const args = buildInvocationArgs(task, taskFilePath, baseArgs, adapter);

  if (generation !== processes.generation) {
    return { kind: 'terminal', result: cancelledAgentResult(task, startTime) };
  }
  const subprocess = execa(command, args, {
    cwd: task.repoRoot,
    detached: process.platform !== 'win32',
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
    forceKillAfterDelay: KILL_GRACE_MS,
    stdin: resolveCliSubprocessStdinOption(adapter, args),
  });

  const owner = new OwnedProcess(subprocess.nodeChildProcess, {
    ownsGroup: process.platform !== 'win32',
    timeoutMs,
  });
  processes.track(owner);

  subprocess.catch(() => {
    /* prevent unhandled rejection even when synchronous setup fails */
  });
  let transport: StdioProtocolTransport | undefined;
  let host: LocalAgentSessionHost | undefined;
  try {
    if (subprocess.stdin) {
      configureCliSubprocessStdin(subprocess.stdin, args, adapter, task, taskFilePath);
    }

    transport = new StdioProtocolTransport({
      stdin: subprocess.stdin ?? new PassThrough(),
      stdout: subprocess.stdout,
      stderr: subprocess.stderr,
    });

    const handshakeTimeoutMs =
      cliConfig?.handshakeTimeoutMs ?? config.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;

    const capabilities = await transport.negotiate(task.taskId, undefined, handshakeTimeoutMs);

    if (generation !== processes.generation) {
      transport.close();
      owner.kill();
      await owner.closed;
      return { kind: 'terminal', result: cancelledAgentResult(task, startTime) };
    }
    if (capabilities === null) {
      transport.close();
      try {
        owner.kill();
      } catch {
        /* already exited */
      }
      await owner.closed;
      if (generation !== processes.generation) {
        return { kind: 'terminal', result: cancelledAgentResult(task, startTime) };
      }
      const result = await dispatchFallback();
      return { kind: 'terminal', result };
    }

    const ref: AgentSessionRef = {
      sessionId: `session-${task.taskId}`,
      runId: task.runId,
      stateId: task.stateId,
      role: task.role,
      transport: 'stdio',
    };

    host = new LocalAgentSessionHost(ref, subprocess.nodeChildProcess, transport, startTime, owner);
    const supervisor = getSupervisor() as
      { registerHost(host: LocalAgentSessionHost): Promise<void> } | undefined;
    if (supervisor) {
      await supervisor.registerHost(host);
    }
    if (generation !== processes.generation) {
      host.abort('Agent dispatch cancelled');
      await owner.closed;
      return { kind: 'terminal', result: cancelledAgentResult(task, startTime) };
    }
    if (onStreamEvent) {
      host.addStreamHandler(onStreamEvent);
    }
    if (timeoutMs > 0) {
      host.setTimeout(timeoutMs);
    }

    return {
      kind: 'session',
      handle: {
        ref: host.ref,
        state: host.state,
        pendingRequests: host.pendingRequests,
      },
    };
  } catch (error: unknown) {
    host?.abort('Session setup failed');
    transport?.close();
    owner.kill();
    await owner.closed;
    throw error;
  }
}
