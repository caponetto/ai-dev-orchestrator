import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PassThrough } from 'node:stream';

import { isTransientCliError } from '@ai-dev-orchestrator/agent-adapters';
import type {
  AgentToOrchestratorMessage,
  ProtocolMessage,
} from '@ai-dev-orchestrator/agent-protocol';
import type { AgentOutputStreamEvent, PermissionPolicyConfig } from '@ai-dev-orchestrator/ports';
import type { AgentTask, AgentResult, AgentTokenUsage } from '@ai-dev-orchestrator/schemas';
import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';
import { getErrorMessage } from '@ai-dev-orchestrator/utils';
import { OwnedProcess } from '@ai-dev-orchestrator/utils/owned-process';
import { execa } from 'execa';

import type { CliHumanRequestHandler } from './cli-human-request-handler';
import {
  buildInvocationArgs,
  configureCliSubprocessStdin,
  resolveCliSubprocessStdinOption,
} from './cli-invocation';
import { runLegacyMode } from './cli-legacy-execution';
import { extractArtifactJsonFromAgentText } from './cli-output-reader';
import type { readCliOutput } from './cli-output-reader';
import { cancelledAgentResult } from './cli-process-registry';
import type { CliProcessRegistry } from './cli-process-registry';
import { handleCliArtifact, handleCliLog, handleCliProgress } from './cli-protocol-events';
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  KILL_GRACE_MS,
} from './cli-runner-config';
import type { CliAgentRunnerConfig } from './cli-runner-config';
import { buildAgentTaskPrompt } from './cli-task-prompt';
import { extractUsageFromRawLine } from './cli-token-usage';
import type { CodexPermissionBridgeConfig } from './codex-permission-hook';
import { writeCodexPermissionHookArtifacts } from './codex-permission-hook';
import { StdioProtocolTransport } from './stdio-protocol-transport';

interface CliProcessExecutionOptions {
  readonly config: CliAgentRunnerConfig;
  readonly processes: CliProcessRegistry;
  readonly requests: CliHumanRequestHandler;
  readonly readOutput: typeof readCliOutput;
  readonly codexPermissionBridge?: CodexPermissionBridgeConfig;
  readonly permissionPolicyConfig?: PermissionPolicyConfig;
  readonly approvalStorePath?: string;
}

export async function executeCliProcess(
  task: AgentTask,
  options: CliProcessExecutionOptions,
  onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  timeoutOverrideMs?: number,
  generation = options.processes.generation,
): Promise<AgentResult> {
  const { config, processes, requests, readOutput } = options;
  const startTime = Date.now();
  if (generation !== processes.generation) {
    return cancelledAgentResult(task, startTime);
  }
  const timeoutMs =
    timeoutOverrideMs ??
    (task.constraints.timeout || config.defaultTimeoutMs || DEFAULT_TIMEOUT_MS);

  const taskFilePath = `${task.runDir}/agent-tasks/${task.taskId}.json`;
  await mkdir(dirname(taskFilePath), { recursive: true });
  await writeFile(taskFilePath, JSON.stringify(task, null, 2));

  await mkdir(dirname(task.outputArtifactPath), { recursive: true });

  const adapter = config.adapter;
  const cliCfg = task.agentConfig;
  const command = cliCfg?.command ?? (adapter ? adapter.command : config.command);
  const baseArgs = cliCfg?.args ?? (adapter ? adapter.args : (config.args ?? []));
  let codexHookCommand: string | undefined;
  if (adapter?.name === BUILT_IN_CODING_RUNNER_ID.CODEX && options.codexPermissionBridge) {
    const hookArtifacts = await writeCodexPermissionHookArtifacts(
      task,
      options.codexPermissionBridge,
      options.permissionPolicyConfig,
      options.approvalStorePath,
      config.liveRequestTimeoutMs,
    );
    codexHookCommand = hookArtifacts.hookCommand;
  }
  const args = buildInvocationArgs(task, taskFilePath, baseArgs, adapter, codexHookCommand);

  const cliPrompt = adapter?.promptViaStdin
    ? buildAgentTaskPrompt(task, taskFilePath)
    : args.at(-1);
  if (cliPrompt && !cliPrompt.startsWith('--')) {
    onStreamEvent?.({
      timestamp: new Date().toISOString(),
      type: 'status',
      content: '',
      structuredData: {
        messageType: 'cli_prompt',
        role: task.role,
        taskId: task.taskId,
        cliPrompt,
      },
    });
  }

  let ownership: OwnedProcess | undefined;
  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (generation !== processes.generation) {
      return cancelledAgentResult(task, startTime);
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
    ownership = owner;
    processes.track(owner);

    // Prevent unhandled rejection if subprocess exits before we await it
    let subprocessError: unknown;
    subprocess.catch((err: unknown) => {
      subprocessError = err;
    });

    if (subprocess.stdin) {
      configureCliSubprocessStdin(subprocess.stdin, args, adapter, task, taskFilePath);
    }

    const transport = new StdioProtocolTransport({
      stdin: subprocess.stdin ?? new PassThrough(),
      stdout: subprocess.stdout,
      stderr: subprocess.stderr,
    });

    // Register all protocol message handlers BEFORE negotiate so no messages
    // are lost between handshake completion and handler setup.
    let finalArtifact: string | undefined;
    let protocolResolved = false;
    let protocolFinish: ((result: AgentResult) => void) | undefined;
    let doneHandled = false;
    let intentionalKill = false;
    let highWaterInputTokens = 0;
    let highWaterOutputTokens = 0;
    let deltaInputTokens = 0;
    let deltaOutputTokens = 0;
    let finalUsage: AgentTokenUsage | undefined;
    let lastAgentArtifactJson: string | undefined;
    let processStderr = '';
    const getTokenUsage = (): AgentTokenUsage | undefined => {
      if (finalUsage) {
        return finalUsage;
      }
      const input = Math.max(highWaterInputTokens, deltaInputTokens);
      const output = Math.max(highWaterOutputTokens, deltaOutputTokens);
      return input > 0 || output > 0 ? { inputTokens: input, outputTokens: output } : undefined;
    };

    const protocolResultPromise = new Promise<AgentResult>((resolve) => {
      protocolFinish = (result: AgentResult) => {
        if (protocolResolved) {
          return;
        }
        protocolResolved = true;
        intentionalKill = true;
        transport.close();
        onStreamEvent?.({
          timestamp: new Date().toISOString(),
          type: 'stdout',
          content: `Task completed (${result.status}).`,
          structuredData: {
            phase: 'done',
            sender: 'agent',
          },
        });
        try {
          owner.kill();
        } catch {
          /* already exited */
        }
        resolve(result);
      };
    });

    overallTimer = setTimeout(() => {
      if (protocolFinish) {
        const timeoutMsg = `Agent timed out after ${String(timeoutMs)}ms`;
        onStreamEvent?.({
          timestamp: new Date().toISOString(),
          type: 'stderr',
          content: timeoutMsg,
          structuredData: {
            messageType: 'error',
            phase: 'error',
            code: 'timeout',
            sender: 'orchestrator',
          },
        });
        // The agent may have already written its output artifact before the
        // timeout fired (e.g. a slow final tool call after the write). Try to
        // salvage it instead of discarding a completed review.
        void readOutput(
          task,
          startTime,
          getTokenUsage(),
          onStreamEvent,
          lastAgentArtifactJson,
        ).then((result) => {
          protocolFinish?.(
            result.status === 'success'
              ? result
              : {
                  taskId: task.taskId,
                  status: 'timeout',
                  error: timeoutMsg,
                  durationMs: Date.now() - startTime,
                  tokenUsage: getTokenUsage(),
                },
          );
        });
      }
      try {
        owner.kill();
      } catch {
        /* already exited */
      }
    }, timeoutMs);

    const dispatchMessageHandler = (message: AgentToOrchestratorMessage): void => {
      switch (message.type) {
        case 'handshake':
          break;
        case 'progress': {
          const detail = message.payload.detail;
          if (typeof detail === 'string') {
            const artifactJson = extractArtifactJsonFromAgentText(detail);
            if (artifactJson) {
              lastAgentArtifactJson = artifactJson;
            }
          }
          handleCliProgress(message, onStreamEvent);
          break;
        }
        case 'log':
          handleCliLog(message, onStreamEvent);
          break;
        case 'artifact':
          finalArtifact = handleCliArtifact(message, finalArtifact);
          break;
        case 'permission_request':
          void requests.handlePermissionRequest(message, task, transport, onStreamEvent);
          break;
        case 'clarification_request':
          void requests.handleClarificationRequest(message, task, transport, onStreamEvent);
          break;
        case 'done': {
          finalUsage = message.payload.tokenUsage ?? finalUsage;
          clearTimeout(overallTimer);
          doneHandled = true;
          if (finalArtifact) {
            protocolFinish?.({
              taskId: task.taskId,
              status: 'success',
              artifactContent: finalArtifact,
              durationMs: Date.now() - startTime,
              tokenUsage: getTokenUsage(),
            });
          } else {
            void readOutput(
              task,
              startTime,
              getTokenUsage(),
              onStreamEvent,
              lastAgentArtifactJson,
            ).then(
              (result) => {
                protocolFinish?.(result);
              },
              (error: unknown) => {
                const errorMsg = `Failed to read output after done: ${getErrorMessage(error)}`;
                onStreamEvent?.({
                  timestamp: new Date().toISOString(),
                  type: 'stderr',
                  content: errorMsg,
                  structuredData: {
                    messageType: 'error',
                    phase: 'error',
                    code: 'read_output_failed',
                    sender: 'orchestrator',
                  },
                });
                protocolFinish?.({
                  taskId: task.taskId,
                  status: 'failure',
                  error: errorMsg,
                  durationMs: Date.now() - startTime,
                  tokenUsage: getTokenUsage(),
                });
              },
            );
          }
          break;
        }
        case 'error': {
          clearTimeout(overallTimer);
          const errorMsg = `Agent error [${message.payload.code}]: ${message.payload.message}`;
          onStreamEvent?.({
            timestamp: new Date().toISOString(),
            type: 'stderr',
            content: errorMsg,
            structuredData: {
              messageType: 'error',
              phase: 'error',
              code: message.payload.code,
              sender: 'orchestrator',
            },
          });
          protocolFinish?.({
            taskId: task.taskId,
            status: 'failure',
            error: errorMsg,
            recoverable: message.payload.recoverable,
            durationMs: Date.now() - startTime,
            tokenUsage: getTokenUsage(),
          });
          break;
        }
      }
    };

    transport.onMessage((rawMessage: ProtocolMessage) => {
      if (protocolResolved || !protocolFinish) {
        return;
      }
      if (rawMessage.type === 'handshake_ack') {
        return;
      }
      dispatchMessageHandler(rawMessage as AgentToOrchestratorMessage);
    });

    transport.onRawLine((line: string) => {
      const lineUsage = extractUsageFromRawLine(line);
      if (lineUsage) {
        if (lineUsage.isFinal) {
          finalUsage = {
            inputTokens: lineUsage.inputTokens,
            outputTokens: lineUsage.outputTokens,
          };
        } else if (lineUsage.cumulative) {
          highWaterInputTokens = Math.max(highWaterInputTokens, lineUsage.inputTokens);
          highWaterOutputTokens = Math.max(highWaterOutputTokens, lineUsage.outputTokens);
        } else {
          deltaInputTokens += lineUsage.inputTokens;
          deltaOutputTokens += lineUsage.outputTokens;
        }
        const current = getTokenUsage();
        onStreamEvent?.({
          timestamp: new Date().toISOString(),
          type: 'status',
          content: '',
          structuredData: {
            phase: 'usage_update',
            inputTokens: current?.inputTokens ?? 0,
            outputTokens: current?.outputTokens ?? 0,
          },
        });
      }

      if (adapter?.translateOutput && !protocolResolved) {
        const rawTranslated = adapter.translateOutput(line);
        if (rawTranslated) {
          dispatchMessageHandler(rawTranslated as AgentToOrchestratorMessage);
          return;
        }
      }
      const isJsonNoise = adapter?.translateOutput && line.trimStart().startsWith('{');
      if (!isJsonNoise) {
        onStreamEvent?.({
          timestamp: new Date().toISOString(),
          type: 'stdout',
          content: line,
        });
      }
    });

    transport.onStderr((data: string) => {
      processStderr = (processStderr + data).slice(-4096);
      onStreamEvent?.({
        timestamp: new Date().toISOString(),
        type: 'stderr',
        content: data,
      });
    });

    subprocess.nodeChildProcess.on('exit', (code: number | null, signal: string | null) => {
      clearTimeout(overallTimer);
      if ((code !== 0 || signal) && !intentionalKill) {
        onStreamEvent?.({
          timestamp: new Date().toISOString(),
          type: 'stderr',
          content: `Process exited: code=${String(code ?? 'null')}, signal=${signal ?? 'none'}`,
        });
      }
    });

    // Use 'close' instead of 'exit' to ensure stdout is fully drained
    // before deciding whether the agent produced output. The 'exit' event
    // fires before stdio streams are closed, so a late `result` event
    // sitting in the stdout buffer would be missed.
    subprocess.nodeChildProcess.on('close', (code: number | null, signal: string | null) => {
      if (!protocolResolved && !doneHandled && protocolFinish) {
        if (finalArtifact) {
          protocolFinish({
            taskId: task.taskId,
            status: 'success',
            artifactContent: finalArtifact,
            durationMs: Date.now() - startTime,
            tokenUsage: getTokenUsage(),
          });
        } else {
          void readOutput(
            task,
            startTime,
            getTokenUsage(),
            onStreamEvent,
            lastAgentArtifactJson,
          ).then(
            async (result) => {
              if (protocolFinish) {
                // execa's own timeout can kill the process before overallTimer fires;
                // wait for the subprocess to settle so that case is reported as a timeout.
                await subprocess.catch(() => undefined);
                if (
                  result.status !== 'success' &&
                  isExecaError(subprocessError) &&
                  subprocessError.timedOut
                ) {
                  const timeoutMsg = `Agent timed out after ${String(timeoutMs)}ms`;
                  onStreamEvent?.({
                    timestamp: new Date().toISOString(),
                    type: 'stderr',
                    content: timeoutMsg,
                    structuredData: {
                      messageType: 'error',
                      phase: 'error',
                      code: 'timeout',
                      sender: 'orchestrator',
                    },
                  });
                  protocolFinish({
                    taskId: task.taskId,
                    status: 'timeout',
                    error: timeoutMsg,
                    durationMs: Date.now() - startTime,
                    tokenUsage: getTokenUsage(),
                  });
                  return;
                }
                const stderr = processStderr.trim();
                if (
                  result.status === 'failure' &&
                  code !== null &&
                  code !== 0 &&
                  !signal &&
                  isTransientCliError(stderr)
                ) {
                  protocolFinish({
                    ...result,
                    error: `Agent process failed: ${stderr}`,
                    recoverable: true,
                  });
                } else {
                  protocolFinish(result);
                }
              }
            },
            (error: unknown) => {
              const errorMsg = `Failed to read output on close: ${getErrorMessage(error)}`;
              onStreamEvent?.({
                timestamp: new Date().toISOString(),
                type: 'stderr',
                content: errorMsg,
                structuredData: {
                  messageType: 'error',
                  phase: 'error',
                  code: 'read_output_failed',
                  sender: 'orchestrator',
                },
              });
              if (protocolFinish) {
                protocolFinish({
                  taskId: task.taskId,
                  status: 'failure',
                  error: errorMsg,
                  durationMs: Date.now() - startTime,
                  tokenUsage: getTokenUsage(),
                });
              }
            },
          );
        }
      }
    });

    // Now negotiate — handlers above will catch any messages that arrive
    // between handshake ack and negotiate() returning.
    const handshakeTimeoutMs =
      task.agentConfig?.handshakeTimeoutMs ??
      config.handshakeTimeoutMs ??
      DEFAULT_HANDSHAKE_TIMEOUT_MS;

    const capabilities = await transport.negotiate(task.taskId, undefined, handshakeTimeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set asynchronously by adapter/exit handlers during negotiate()
    if (capabilities !== null || protocolResolved) {
      return await protocolResultPromise;
    }

    // When an adapter is present, keep the transport open so it can
    // continue translating raw JSON events (e.g. assistant, result)
    // into protocol messages.  Legacy mode would close the transport
    // and lose adapter-based output translation and token extraction.
    if (adapter?.translateOutput) {
      return await protocolResultPromise;
    }

    // Legacy fallback — no handshake received and no adapter events resolved
    clearTimeout(overallTimer);
    protocolResolved = true;
    transport.close();
    return await runLegacyMode(
      task,
      readOutput,
      subprocess,
      startTime,
      onStreamEvent,
      subprocessError,
      {
        input: Math.max(highWaterInputTokens, deltaInputTokens),
        output: Math.max(highWaterOutputTokens, deltaOutputTokens),
      },
    );
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;

    if (isExecaError(error) && error.timedOut) {
      const timeoutMsg = `Agent timed out after ${String(timeoutMs)}ms`;
      onStreamEvent?.({
        timestamp: new Date().toISOString(),
        type: 'stderr',
        content: timeoutMsg,
        structuredData: {
          messageType: 'error',
          phase: 'error',
          code: 'timeout',
          sender: 'orchestrator',
        },
      });
      // The process may have already written its output artifact before
      // execa's own timeout killed it — try to salvage it.
      const salvaged = await readOutput(task, startTime, undefined, onStreamEvent);
      if (salvaged.status === 'success') {
        return salvaged;
      }
      return {
        taskId: task.taskId,
        status: 'timeout',
        error: timeoutMsg,
        durationMs,
      };
    }

    const message = getErrorMessage(error);
    const failMsg = `Agent process failed: ${message}`;
    onStreamEvent?.({
      timestamp: new Date().toISOString(),
      type: 'stderr',
      content: failMsg,
      structuredData: {
        messageType: 'error',
        phase: 'error',
        code: 'process_failure',
        sender: 'orchestrator',
      },
    });
    return {
      taskId: task.taskId,
      status: 'failure',
      error: failMsg,
      durationMs,
    };
  } finally {
    clearTimeout(overallTimer);
    if (ownership) {
      ownership.kill();
      await ownership.closed;
    }
  }
}

function isExecaError(error: unknown): error is Error & { timedOut: boolean } {
  return error instanceof Error && Object.hasOwn(error, 'timedOut');
}
