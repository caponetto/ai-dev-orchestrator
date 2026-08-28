import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { AgentAdapter, VendorTokenUsage } from '@ai-orchestrator/agent-adapters';
import {
  parseClaudeCodeEvent,
  parseCodexEvent,
  parseCursorEvent,
} from '@ai-orchestrator/agent-adapters';
import type {
  AgentToOrchestratorMessage,
  ArtifactMessage,
  ClarificationRequestMessage,
  LogMessage,
  PermissionRequestMessage,
  ProgressMessage,
  ProtocolMessage,
} from '@ai-orchestrator/agent-protocol';
import { createProtocolMessage, payloadToRecord } from '@ai-orchestrator/agent-protocol';
import type {
  AgentDispatchResult,
  AgentOutputStreamEvent,
  PermissionContext,
  PermissionPolicy,
  SessionCapableRunner,
} from '@ai-orchestrator/ports';
import type {
  AgentResult,
  AgentSessionRef,
  AgentTask,
  AgentTokenUsage,
} from '@ai-orchestrator/schemas';
import {
  BUILT_IN_CODING_RUNNER_ID,
  liveClarificationResponsePayloadSchema,
  livePermissionResponsePayloadSchema,
} from '@ai-orchestrator/schemas';
import { getErrorMessage } from '@ai-orchestrator/utils';
import { execa } from 'execa';

import type { LiveRequestStore } from './file-backed-live-request-store';
import { LocalAgentSessionHost } from './local-agent-session-host';
import type { LocalAgentSessionSupervisor } from './local-agent-session-supervisor';
import { labelForOutputFormat } from './output-format';
import type { PermissionApprovalStore } from './permission-approval-store';
import { StdioProtocolTransport } from './stdio-protocol-transport';

interface CliAgentRunnerConfig {
  readonly command: string;
  readonly args?: readonly string[];
  readonly defaultTimeoutMs?: number;
  readonly handshakeTimeoutMs?: number;
  readonly liveRequestTimeoutMs?: number;
  readonly adapter?: AgentAdapter;
}

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_LIVE_REQUEST_TIMEOUT_MS = 300_000; // 5 minutes
const KILL_GRACE_MS = 5_000;

export class CliAgentRunner implements SessionCapableRunner {
  private readonly config: CliAgentRunnerConfig;
  private permissionPolicy?: PermissionPolicy;
  private liveRequestStore?: LiveRequestStore;
  private approvalStore?: PermissionApprovalStore;
  private sessionSupervisor?: LocalAgentSessionSupervisor;
  private readonly activeSubprocesses = new Set<{ pid?: number; kill: () => boolean }>();

  constructor(config: CliAgentRunnerConfig) {
    this.config = config;
  }

  killAll(): void {
    for (const proc of this.activeSubprocesses) {
      try {
        proc.kill();
      } catch {
        // best-effort
      }
    }
    this.activeSubprocesses.clear();
  }

  setPermissionPolicy(policy: PermissionPolicy): void {
    this.permissionPolicy = policy;
  }

  setLiveRequestStore(store: LiveRequestStore): void {
    this.liveRequestStore = store;
  }

  setApprovalStore(store: PermissionApprovalStore): void {
    this.approvalStore = store;
  }

  setSessionSupervisor(supervisor: LocalAgentSessionSupervisor): void {
    this.sessionSupervisor = supervisor;
  }

  readonly supportsResumableSessions = true;

  async dispatchWithSession(
    task: AgentTask,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentDispatchResult> {
    const startTime = Date.now();
    const timeoutMs =
      task.constraints.timeout || this.config.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;

    const taskFilePath = `${task.runDir}/agent-tasks/${task.taskId}.json`;
    await mkdir(dirname(taskFilePath), { recursive: true });
    await writeFile(taskFilePath, JSON.stringify(task, null, 2));
    await mkdir(dirname(task.outputArtifactPath), { recursive: true });

    const adapter = this.config.adapter;
    const cliConfig = task.agentConfig;
    const command = cliConfig?.command ?? (adapter ? adapter.command : this.config.command);
    const baseArgs = cliConfig?.args ?? (adapter ? adapter.args : (this.config.args ?? []));
    const args = buildInvocationArgs(task, taskFilePath, baseArgs, adapter);

    const subprocess = execa(command, args, {
      cwd: task.repoRoot,
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
      forceKillAfterDelay: KILL_GRACE_MS,
      stdin: 'pipe',
    });

    const procHandle = { pid: subprocess.pid, kill: () => subprocess.kill() };
    this.activeSubprocesses.add(procHandle);

    if (args.includes('--print')) {
      subprocess.stdin.end();
    } else if (adapter?.promptViaStdin && adapter.sendPrompt) {
      const stdinMsg = adapter.sendPrompt(buildAgentTaskPrompt(task, taskFilePath));
      if (stdinMsg) {
        subprocess.stdin.write(stdinMsg + '\n');
      }
    }

    subprocess
      .catch(() => {
        /* prevent unhandled rejection */
      })
      .finally(() => {
        this.activeSubprocesses.delete(procHandle);
      });

    const transport = new StdioProtocolTransport({
      stdin: subprocess.stdin,
      stdout: subprocess.stdout,
      stderr: subprocess.stderr,
    });

    const handshakeTimeoutMs =
      cliConfig?.handshakeTimeoutMs ??
      this.config.handshakeTimeoutMs ??
      DEFAULT_HANDSHAKE_TIMEOUT_MS;

    const capabilities = await transport.negotiate(task.taskId, undefined, handshakeTimeoutMs);

    if (capabilities === null) {
      transport.close();
      try {
        subprocess.kill('SIGTERM');
      } catch {
        /* already exited */
      }
      const result = await this.dispatch(task, onStreamEvent);
      return { kind: 'terminal', result };
    }

    const ref: AgentSessionRef = {
      sessionId: `session-${task.taskId}`,
      runId: task.runId,
      stateId: task.stateId,
      role: task.role,
      transport: 'stdio',
    };

    const host = new LocalAgentSessionHost(ref, subprocess.nodeChildProcess, transport, startTime);
    const supervisor = this.sessionSupervisor as
      { registerHost(host: LocalAgentSessionHost): Promise<void> } | undefined;
    if (supervisor) {
      await supervisor.registerHost(host);
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
  }

  async dispatch(
    task: AgentTask,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const timeoutMs =
      task.constraints.timeout || this.config.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;

    const taskFilePath = `${task.runDir}/agent-tasks/${task.taskId}.json`;
    await mkdir(dirname(taskFilePath), { recursive: true });
    await writeFile(taskFilePath, JSON.stringify(task, null, 2));

    await mkdir(dirname(task.outputArtifactPath), { recursive: true });

    const adapter = this.config.adapter;
    const cliCfg = task.agentConfig;
    const command = cliCfg?.command ?? (adapter ? adapter.command : this.config.command);
    const baseArgs = cliCfg?.args ?? (adapter ? adapter.args : (this.config.args ?? []));
    const args = buildInvocationArgs(task, taskFilePath, baseArgs, adapter);

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

    try {
      const subprocess = execa(command, args, {
        cwd: task.repoRoot,
        timeout: timeoutMs,
        killSignal: 'SIGTERM',
        forceKillAfterDelay: KILL_GRACE_MS,
        stdin: 'pipe',
      });

      const procHandle = { pid: subprocess.pid, kill: () => subprocess.kill() };
      this.activeSubprocesses.add(procHandle);

      if (args.includes('--print')) {
        subprocess.stdin.end();
      } else if (adapter?.promptViaStdin && adapter.sendPrompt) {
        const stdinMsg = adapter.sendPrompt(buildAgentTaskPrompt(task, taskFilePath));
        if (stdinMsg) {
          subprocess.stdin.write(stdinMsg + '\n');
        }
      }

      // Prevent unhandled rejection if subprocess exits before we await it
      let subprocessError: unknown;
      subprocess
        .catch((err: unknown) => {
          subprocessError = err;
        })
        .finally(() => {
          this.activeSubprocesses.delete(procHandle);
        });

      const transport = new StdioProtocolTransport({
        stdin: subprocess.stdin,
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
            subprocess.kill('SIGTERM');
          } catch {
            /* already exited */
          }
          resolve(result);
        };
      });

      const overallTimer = setTimeout(() => {
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
          protocolFinish({
            taskId: task.taskId,
            status: 'timeout',
            error: timeoutMsg,
            durationMs: Date.now() - startTime,
            tokenUsage: getTokenUsage(),
          });
        }
        try {
          subprocess.kill('SIGTERM');
        } catch {
          /* already exited */
        }
      }, timeoutMs);

      const dispatchMessageHandler = (message: AgentToOrchestratorMessage): void => {
        switch (message.type) {
          case 'handshake':
            break;
          case 'progress':
            this.handleProgress(message, onStreamEvent);
            break;
          case 'log':
            this.handleLog(message, onStreamEvent);
            break;
          case 'artifact':
            finalArtifact = this.handleArtifact(message, finalArtifact);
            break;
          case 'permission_request':
            void this.handlePermissionRequest(message, task, transport, onStreamEvent);
            break;
          case 'clarification_request':
            void this.handleClarificationRequest(message, task, transport, onStreamEvent);
            break;
          case 'done': {
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
              void this.readOutput(task, startTime, getTokenUsage(), onStreamEvent).then(
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
      subprocess.nodeChildProcess.on('close', () => {
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
            void this.readOutput(task, startTime, getTokenUsage(), onStreamEvent).then(
              (result) => {
                if (protocolFinish) {
                  protocolFinish(result);
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
        this.config.handshakeTimeoutMs ??
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
      return await this.runLegacyMode(task, subprocess, startTime, onStreamEvent, subprocessError, {
        input: Math.max(highWaterInputTokens, deltaInputTokens),
        output: Math.max(highWaterOutputTokens, deltaOutputTokens),
      });
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
    }
  }

  private async runLegacyMode(
    task: AgentTask,
    subprocess: ReturnType<typeof execa>,
    startTime: number,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
    earlyError?: unknown,
    initialUsage?: { input: number; output: number },
  ): Promise<AgentResult> {
    if (earlyError) {
      // Process already exited with error during handshake negotiation
      if (earlyError instanceof Error) {
        throw earlyError;
      }
      const message = typeof earlyError === 'string' ? earlyError : 'Unknown process error';
      throw new Error(message);
    }

    let highWaterInput = initialUsage?.input ?? 0;
    let highWaterOutput = initialUsage?.output ?? 0;
    let deltaInput = 0;
    let deltaOutput = 0;
    let legacyFinalUsage: AgentTokenUsage | undefined;
    const getLegacyUsage = (): AgentTokenUsage | undefined => {
      if (legacyFinalUsage) {
        return legacyFinalUsage;
      }
      const input = Math.max(highWaterInput, deltaInput);
      const output = Math.max(highWaterOutput, deltaOutput);
      return input > 0 || output > 0 ? { inputTokens: input, outputTokens: output } : undefined;
    };
    let lineBuffer = '';

    subprocess.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();

      const combined = lineBuffer + text;
      const segments = combined.split('\n');
      lineBuffer = segments.pop() ?? '';
      for (const segment of segments) {
        const usage = extractUsageFromRawLine(segment);
        if (usage) {
          if (usage.isFinal) {
            legacyFinalUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
          } else if (usage.cumulative) {
            highWaterInput = Math.max(highWaterInput, usage.inputTokens);
            highWaterOutput = Math.max(highWaterOutput, usage.outputTokens);
          } else {
            deltaInput += usage.inputTokens;
            deltaOutput += usage.outputTokens;
          }
          const current = getLegacyUsage();
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
      }

      onStreamEvent?.({
        timestamp: new Date().toISOString(),
        type: 'stdout',
        content: text,
      });
    });

    if (onStreamEvent) {
      subprocess.stderr?.on('data', (chunk: Buffer) => {
        onStreamEvent({
          timestamp: new Date().toISOString(),
          type: 'stderr',
          content: chunk.toString(),
        });
      });
    }

    await subprocess;

    if (lineBuffer.length > 0) {
      const usage = extractUsageFromRawLine(lineBuffer);
      if (usage) {
        if (usage.isFinal) {
          legacyFinalUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
        } else if (usage.cumulative) {
          highWaterInput = Math.max(highWaterInput, usage.inputTokens);
          highWaterOutput = Math.max(highWaterOutput, usage.outputTokens);
        } else {
          deltaInput += usage.inputTokens;
          deltaOutput += usage.outputTokens;
        }
      }
    }

    return this.readOutput(task, startTime, getLegacyUsage(), onStreamEvent);
  }

  private sendToAgent(message: ProtocolMessage, transport: StdioProtocolTransport): void {
    const adapter = this.config.adapter;
    if (adapter?.translateInput) {
      const translated = adapter.translateInput(message);
      if (translated !== null) {
        transport.writeRaw(translated);
        return;
      }
    }
    transport.send(message);
  }

  private handleProgress(
    message: ProgressMessage,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): void {
    const percentStr =
      typeof message.payload.percent === 'number' ? ` (${String(message.payload.percent)}%)` : '';
    onStreamEvent?.({
      timestamp: message.timestamp,
      type: 'status',
      content: `${message.payload.detail}${percentStr}`,
      structuredData: {
        messageType: 'progress',
        phase: message.payload.phase,
        detail: message.payload.detail,
        percent: message.payload.percent,
      },
    });
  }

  private handleLog(
    message: LogMessage,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): void {
    const streamType =
      message.payload.level === 'error' || message.payload.level === 'warn' ? 'stderr' : 'stdout';
    onStreamEvent?.({
      timestamp: message.timestamp,
      type: streamType,
      content: `[${message.payload.level}] ${message.payload.message}`,
      structuredData: {
        messageType: 'log',
        level: message.payload.level,
        message: message.payload.message,
      },
    });
  }

  private handleArtifact(message: ArtifactMessage, currentArtifact: string | undefined): string {
    if (message.payload.isFinal) {
      return message.payload.content;
    }
    return currentArtifact ?? message.payload.content;
  }

  private async handlePermissionRequest(
    message: PermissionRequestMessage,
    task: AgentTask,
    transport: StdioProtocolTransport,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<void> {
    const payload = message.payload;

    if (this.permissionPolicy) {
      const context: PermissionContext = {
        role: task.role,
        runId: task.runId,
        stateId: task.stateId,
        repoRoot: task.repoRoot,
      };
      const decision = this.permissionPolicy.evaluate(payload, context);

      if (decision.action === 'grant') {
        onStreamEvent?.({
          timestamp: message.timestamp,
          type: 'permission_request',
          content: `Permission auto-granted: ${payload.action} ${payload.resource}`,
          structuredData: {
            messageType: 'permission_resolved',
            resolved: 'granted',
            reason: decision.reason,
            ...payloadToRecord(payload),
          },
          requestMessageId: message.messageId,
        });
        this.sendToAgent(
          createProtocolMessage(
            'permission_response',
            {
              granted: true,
              reason: decision.reason,
              externalRequestId: payload.externalRequestId,
              toolInput: payload.toolInput,
            },
            message.messageId,
          ),
          transport,
        );
        return;
      }

      if (decision.action === 'deny') {
        onStreamEvent?.({
          timestamp: message.timestamp,
          type: 'permission_request',
          content: `Permission denied: ${payload.action} ${payload.resource}`,
          structuredData: {
            messageType: 'permission_resolved',
            resolved: 'denied',
            reason: decision.reason,
            ...payloadToRecord(payload),
          },
          requestMessageId: message.messageId,
        });
        this.sendToAgent(
          createProtocolMessage(
            'permission_response',
            {
              granted: false,
              reason: decision.reason,
              externalRequestId: payload.externalRequestId,
              toolInput: payload.toolInput,
            },
            message.messageId,
          ),
          transport,
        );
        return;
      }
    }

    // ask_human path: emit interactive banner and wait for human response
    onStreamEvent?.({
      timestamp: message.timestamp,
      type: 'permission_request',
      content: `Permission request: ${payload.action} ${payload.resource} (${payload.riskLevel} risk)`,
      structuredData: {
        messageType: 'permission_request',
        ...payloadToRecord(payload),
      },
      requestMessageId: message.messageId,
    });

    if (this.liveRequestStore) {
      const liveRequestTimeoutMs =
        task.agentConfig?.['liveRequestTimeoutMs'] ??
        this.config.liveRequestTimeoutMs ??
        DEFAULT_LIVE_REQUEST_TIMEOUT_MS;

      const now = new Date();
      await this.liveRequestStore.writeRequest({
        runId: task.runId,
        messageId: message.messageId,
        kind: 'permission',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + liveRequestTimeoutMs).toISOString(),
        payload: payloadToRecord(payload),
      });

      const response = await this.liveRequestStore.awaitResponse(
        task.runId,
        message.messageId,
        liveRequestTimeoutMs,
      );

      if (response) {
        const permPayload = livePermissionResponsePayloadSchema.safeParse(response.payload);
        const granted = permPayload.success && permPayload.data.granted === true;
        const reason = permPayload.success ? permPayload.data.reason : undefined;
        onStreamEvent?.({
          timestamp: new Date().toISOString(),
          type: 'permission_request',
          content: `Permission ${granted ? 'granted' : 'denied'}: ${payload.action} ${payload.resource}`,
          structuredData: {
            messageType: 'permission_response',
            granted,
            reason,
            action: payload.action,
          },
          requestMessageId: message.messageId,
        });
        this.sendToAgent(
          createProtocolMessage(
            'permission_response',
            {
              granted,
              reason,
              externalRequestId: payload.externalRequestId,
              toolInput: payload.toolInput,
            },
            message.messageId,
          ),
          transport,
        );
        if (granted && this.approvalStore) {
          this.approvalStore
            .record({
              action: payload.action,
              resource: payload.resource,
              detail: payload.detail,
              createdByRole: task.role,
            })
            .catch(() => {});
        }
      } else {
        await this.liveRequestStore.writeResponse({
          runId: task.runId,
          messageId: message.messageId,
          respondedAt: new Date().toISOString(),
          payload: { timedOut: true, granted: false },
        });
        this.sendToAgent(
          createProtocolMessage(
            'permission_response',
            {
              granted: false,
              reason: 'Live request timed out — denied by default',
              externalRequestId: payload.externalRequestId,
              toolInput: payload.toolInput,
            },
            message.messageId,
          ),
          transport,
        );
      }
      return;
    }

    // No policy and no live request store: deny by default
    this.sendToAgent(
      createProtocolMessage(
        'permission_response',
        {
          granted: false,
          reason: 'No permission policy configured',
          externalRequestId: payload.externalRequestId,
          toolInput: payload.toolInput,
        },
        message.messageId,
      ),
      transport,
    );
  }

  private async handleClarificationRequest(
    message: ClarificationRequestMessage,
    task: AgentTask,
    transport: StdioProtocolTransport,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<void> {
    const payload = message.payload;

    onStreamEvent?.({
      timestamp: message.timestamp,
      type: 'clarification_request',
      content: `Clarification needed: ${payload.question}`,
      structuredData: payloadToRecord(payload),
      requestMessageId: message.messageId,
    });

    if (this.liveRequestStore) {
      const liveRequestTimeoutMs =
        task.agentConfig?.['liveRequestTimeoutMs'] ??
        this.config.liveRequestTimeoutMs ??
        DEFAULT_LIVE_REQUEST_TIMEOUT_MS;

      const now = new Date();
      await this.liveRequestStore.writeRequest({
        runId: task.runId,
        messageId: message.messageId,
        kind: 'clarification',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + liveRequestTimeoutMs).toISOString(),
        payload: payloadToRecord(payload),
      });

      const response = await this.liveRequestStore.awaitResponse(
        task.runId,
        message.messageId,
        liveRequestTimeoutMs,
      );

      if (response) {
        const clarPayload = liveClarificationResponsePayloadSchema.safeParse(response.payload);
        const answer = clarPayload.success ? (clarPayload.data.answer ?? '') : '';
        this.sendToAgent(
          createProtocolMessage('clarification_response', { answer }, message.messageId),
          transport,
        );
      } else {
        // v1: timeout → abort (do NOT transition to WAITING_FOR_HUMAN)
        await this.liveRequestStore.writeResponse({
          runId: task.runId,
          messageId: message.messageId,
          respondedAt: new Date().toISOString(),
          payload: { timedOut: true, aborted: true },
        });
        this.sendToAgent(
          createProtocolMessage('abort', { reason: 'Clarification request timed out' }),
          transport,
        );
      }
      return;
    }

    // No live request store: abort
    this.sendToAgent(
      createProtocolMessage('abort', {
        reason: 'No live request store configured for clarification',
      }),
      transport,
    );
  }

  private async readOutput(
    task: AgentTask,
    startTime: number,
    preAccumulatedUsage?: AgentTokenUsage,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentResult> {
    const durationMs = Date.now() - startTime;
    const maxAttempts = 4;
    const retryDelayMs = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const content = await readFile(task.outputArtifactPath, 'utf-8');
        const parsed = parseJsonContent(content);

        const artifactUsage = extractArtifactTokenUsage(parsed['tokenUsage']);
        const hasArtifactUsage =
          artifactUsage && (artifactUsage.inputTokens > 0 || artifactUsage.outputTokens > 0);

        return {
          taskId: task.taskId,
          status: 'success',
          artifactContent: content,
          durationMs,
          tokenUsage: hasArtifactUsage ? artifactUsage : (preAccumulatedUsage ?? artifactUsage),
        };
      } catch {
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        const errorMsg = `Failed to read agent output artifact — the agent process exited without producing the expected output file at ${task.outputArtifactPath}`;
        onStreamEvent?.({
          timestamp: new Date().toISOString(),
          type: 'stderr',
          content: errorMsg,
          structuredData: {
            messageType: 'error',
            phase: 'error',
            code: 'missing_output_artifact',
            sender: 'orchestrator',
          },
        });
        return {
          taskId: task.taskId,
          status: 'failure',
          error: errorMsg,
          durationMs,
          tokenUsage: preAccumulatedUsage,
        };
      }
    }

    return { taskId: task.taskId, status: 'failure', error: 'Unexpected', durationMs };
  }
}

/** Adapters that accept a prompt as the final arg instead of --task-file. */
const PROMPT_BASED_ADAPTERS = new Set<string>([
  BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE,
  BUILT_IN_CODING_RUNNER_ID.CODEX,
  BUILT_IN_CODING_RUNNER_ID.CURSOR,
]);

function buildToolPermissionArgs(): string[] {
  return ['--allowedTools=Read,Write,Edit'];
}

function buildMaxTurnsArgs(task: AgentTask, adapter?: AgentAdapter): string[] {
  if (adapter?.name !== BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE) {
    return [];
  }
  const maxTurns = task.agentConfig?.maxTurns;
  if (!maxTurns) {
    return [];
  }
  return ['--max-turns', String(maxTurns)];
}

function buildInvocationArgs(
  task: AgentTask,
  taskFilePath: string,
  baseArgs: readonly string[],
  adapter?: AgentAdapter,
): string[] {
  const modelArgs = buildModelArgs(task, baseArgs);
  const maxTurnsArgs = buildMaxTurnsArgs(task, adapter);

  if (adapter?.promptViaStdin) {
    return [...baseArgs, ...modelArgs, ...maxTurnsArgs];
  }

  const permArgs =
    adapter?.name === BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE || !adapter
      ? buildToolPermissionArgs()
      : [];

  if (adapter && PROMPT_BASED_ADAPTERS.has(adapter.name)) {
    return [
      ...baseArgs,
      ...modelArgs,
      ...permArgs,
      ...maxTurnsArgs,
      buildAgentTaskPrompt(task, taskFilePath),
    ];
  }
  return [...baseArgs, ...modelArgs, ...permArgs, ...maxTurnsArgs, '--task-file', taskFilePath];
}

function buildModelArgs(task: AgentTask, baseArgs: readonly string[]): string[] {
  if (!task.modelHint) {
    return [];
  }
  const alreadyHasModel = baseArgs.some(
    (arg, i) => arg === '--model' || (i > 0 && baseArgs[i - 1] === '--model'),
  );
  if (alreadyHasModel) {
    return [];
  }
  return ['--model', task.modelHint];
}

/**
 * Parses JSON content that may contain multiple concatenated JSON objects
 * (a known issue with some agent runners that append instead of overwrite).
 * Falls back to extracting the last valid top-level JSON object.
 */
function parseJsonContent(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    const lastBrace = content.lastIndexOf('\n{');
    if (lastBrace > 0) {
      const lastObject = content.slice(lastBrace + 1);
      return JSON.parse(lastObject) as Record<string, unknown>;
    }
    throw new Error('Invalid JSON in artifact file');
  }
}

export function buildAgentTaskPrompt(task: AgentTask, taskFilePath: string): string {
  const formatLabel = labelForOutputFormat(task.constraints.outputFormat ?? 'json');

  const lines = [
    'Read the JSON task file at the path below and execute it as the authoritative task definition.',
    `Task file: ${taskFilePath}`,
    `Repository root: ${task.repoRoot}`,
    `Required output artifact path: ${task.outputArtifactPath}`,
    `Required output format: ${formatLabel}`,
  ];

  if (task.userPrompt) {
    lines.push(
      '',
      'User Goal (the original request that initiated this workflow):',
      task.userPrompt,
    );
  }

  if (task.rolePrompt) {
    lines.push('', '--- Role Instructions ---', '', task.rolePrompt);
  }

  const formatRules: string[] = [];
  const format = task.constraints.outputFormat ?? 'json';
  if (format === 'json') {
    formatRules.push(
      '- Write exactly one JSON value (object, or array only if the output contract requires an array).',
      '- Overwrite the output file with the final content; never append a second top-level JSON value.',
      '- The final file must be valid for JSON.parse with no trailing content after the value.',
      '- Prefer a single final write of the complete artifact.',
    );
  } else if (format === 'yaml') {
    formatRules.push(
      '- Write exactly one YAML document.',
      '- Overwrite the output file with the final content; never append a second document.',
      '- Prefer a single final write of the complete artifact.',
    );
  } else {
    formatRules.push(
      '- Overwrite the output file with the final content; do not append extra copies.',
      '- Prefer a single final write of the complete artifact.',
    );
  }

  lines.push(
    '',
    'CRITICAL — Output File Rules (violation causes validation failure):',
    `- The output artifact file must contain exactly ONE ${formatLabel} value. No more.`,
    '- NEVER append to the output file. Always overwrite it with the complete, final content in a single write.',
    '- After writing, the file must be valid for JSON.parse() with zero trailing content — no extra objects, no duplicate writes, no leftover fragments.',
    '- If you need to revise your output, overwrite the entire file. Do NOT write a second JSON object after the first.',
    ...formatRules,
    '',
    'General:',
    '- Read the task file before starting work.',
    '- Follow the role instructions above as your primary guidance.',
    `- Write the final artifact to the required output artifact path as ${formatLabel}.`,
    '',
    'Output Verbosity — IMPORTANT:',
    '- Your stdout is streamed to a human dashboard. Keep progress updates minimal and high-signal.',
    '- DO: report key decisions, findings, and the final result.',
    '- DO NOT: narrate what you are about to do ("I\'ll read the file..."), echo back the task, describe routine steps ("Let me verify..."), or explain intermediate validation results.',
    '- Aim for 3-5 progress lines per task, not 10-20. Silence is fine while working.',
    '- If stream-json mode is enabled, emit progress and completion events on stdout while working.',
  );

  if (task.iterationCount && task.iterationCount > 1) {
    lines.push(
      '',
      `This is iteration ${String(task.iterationCount)} of this task. Address all findings above.`,
    );
  }

  return lines.join('\n');
}

function isExecaError(error: unknown): error is Error & { timedOut: boolean } {
  return error instanceof Error && Object.hasOwn(error, 'timedOut');
}

function extractArtifactTokenUsage(
  raw: unknown,
): { inputTokens: number; outputTokens: number } | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const inputTokens =
    'inputTokens' in raw && typeof raw.inputTokens === 'number' ? raw.inputTokens : 0;
  const outputTokens =
    'outputTokens' in raw && typeof raw.outputTokens === 'number' ? raw.outputTokens : 0;
  return inputTokens > 0 || outputTokens > 0 ? { inputTokens, outputTokens } : undefined;
}

function parseVendorUsage(u: VendorTokenUsage): {
  inputTokens: number;
  outputTokens: number;
} {
  const num = (v: number | undefined): number => v ?? 0;
  const anthropicInput =
    num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
  const anthropicOutput = num(u.output_tokens);
  const cursorInput = num(u.inputTokens);
  const cursorOutput = num(u.outputTokens);
  return {
    inputTokens: Math.max(anthropicInput, cursorInput),
    outputTokens: Math.max(anthropicOutput, cursorOutput),
  };
}

export interface ExtractedUsage {
  inputTokens: number;
  outputTokens: number;
  isFinal?: boolean;
  cumulative?: boolean;
}

function isAnthropicUsageShape(usage: Record<string, unknown>): boolean {
  return 'input_tokens' in usage || 'cache_read_input_tokens' in usage;
}

export function extractUsageFromRawLine(line: string): ExtractedUsage | null {
  const claudeEvent = parseClaudeCodeEvent(line);
  if (claudeEvent) {
    if (claudeEvent.type === 'result' && claudeEvent.usage) {
      return { ...parseVendorUsage(claudeEvent.usage), isFinal: true };
    }
    if (claudeEvent.type === 'assistant' && claudeEvent.message?.usage) {
      const usage = claudeEvent.message.usage as Record<string, unknown>;
      const cumulative = isAnthropicUsageShape(usage);
      return { ...parseVendorUsage(claudeEvent.message.usage), ...(cumulative && { cumulative }) };
    }
  }

  const cursorEvent = parseCursorEvent(line);
  if (cursorEvent) {
    if (cursorEvent.type === 'result' && cursorEvent.usage) {
      return { ...parseVendorUsage(cursorEvent.usage), isFinal: true };
    }
    if (cursorEvent.type === 'assistant' && cursorEvent.message?.usage) {
      return parseVendorUsage(cursorEvent.message.usage);
    }
  }

  const codexEvent = parseCodexEvent(line);
  if (codexEvent?.type === 'turn.completed' && codexEvent.usage) {
    return { ...parseVendorUsage(codexEvent.usage), isFinal: true };
  }

  return null;
}
