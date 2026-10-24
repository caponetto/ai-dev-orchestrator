import type {
  AgentDispatchResult,
  AgentOutputStreamEvent,
  PermissionPolicy,
  PermissionPolicyConfig,
  SessionCapableRunner,
} from '@ai-dev-orchestrator/ports';
import type { AgentResult, AgentTask } from '@ai-dev-orchestrator/schemas';
import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

import { CliHumanRequestHandler } from './cli-human-request-handler';
import { readCliOutput } from './cli-output-reader';
import { executeCliProcess } from './cli-process-execution';
import { CliProcessRegistry } from './cli-process-registry';
import { dispatchWithTransientRetry } from './cli-retry-policy';
import { DEFAULT_TIMEOUT_MS } from './cli-runner-config';
import type { CliAgentRunnerConfig } from './cli-runner-config';
import { createCliSession } from './cli-session-execution';
import type { CodexPermissionBridgeConfig } from './codex-permission-hook';
import type { LiveRequestStore } from './file-backed-live-request-store';
import type { LocalAgentSessionSupervisor } from './local-agent-session-supervisor';
import type { PermissionApprovalStore } from './permission-approval-store';

export class CliAgentRunner implements SessionCapableRunner {
  private readonly config: CliAgentRunnerConfig;
  private permissionPolicyConfig?: PermissionPolicyConfig;
  private approvalStorePath?: string;
  private codexPermissionBridge?: CodexPermissionBridgeConfig;
  private sessionSupervisor?: LocalAgentSessionSupervisor;
  private readonly processes = new CliProcessRegistry();
  private readonly requests: CliHumanRequestHandler;

  constructor(config: CliAgentRunnerConfig) {
    this.config = config;
    this.requests = new CliHumanRequestHandler(config.adapter, config.liveRequestTimeoutMs);
  }

  killAll(): void {
    this.processes.killAll();
  }

  setPermissionPolicy(policy: PermissionPolicy): void {
    this.requests.setPermissionPolicy(policy);
  }

  setLiveRequestStore(store: LiveRequestStore): void {
    this.requests.setLiveRequestStore(store);
  }

  setApprovalStore(store: PermissionApprovalStore): void {
    this.requests.setApprovalStore(store);
  }

  setApprovalStorePath(path: string): void {
    this.approvalStorePath = path;
  }

  setPermissionPolicyConfig(config: PermissionPolicyConfig): void {
    this.permissionPolicyConfig = config;
  }

  setCodexPermissionBridge(bridge: CodexPermissionBridgeConfig): void {
    this.codexPermissionBridge = bridge;
  }

  setSessionSupervisor(supervisor: LocalAgentSessionSupervisor): void {
    this.sessionSupervisor = supervisor;
  }

  readonly supportsResumableSessions = true;

  dispatchWithSession(
    task: AgentTask,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentDispatchResult> {
    return createCliSession(
      task,
      {
        config: this.config,
        processes: this.processes,
        getSupervisor: () => this.sessionSupervisor,
        dispatchFallback: () => this.dispatch(task, onStreamEvent),
      },
      onStreamEvent,
    );
  }

  async dispatch(
    task: AgentTask,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<AgentResult> {
    if (
      this.config.adapter?.name === BUILT_IN_CODING_RUNNER_ID.OPENCODE &&
      task.modelHint &&
      this.config.availableModels?.length &&
      !this.config.availableModels.includes(task.modelHint)
    ) {
      const message =
        `OpenCode model "${task.modelHint}" is unavailable. ` +
        'Choose an available model in the run configuration. Run "opencode models" to list available models.';
      onStreamEvent?.({
        timestamp: new Date().toISOString(),
        type: 'stderr',
        content: message,
        structuredData: {
          messageType: 'error',
          phase: 'error',
          code: 'model_unavailable',
          sender: 'orchestrator',
        },
      });
      return { taskId: task.taskId, status: 'failure', error: message, durationMs: 0 };
    }
    const timeoutMs =
      task.constraints.timeout || this.config.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;
    const generation = this.processes.generation;
    return dispatchWithTransientRetry(
      this.config.adapter?.name,
      timeoutMs,
      (remainingTimeoutMs, onEvent) =>
        executeCliProcess(
          task,
          {
            config: this.config,
            processes: this.processes,
            requests: this.requests,
            readOutput: (...args) => this.readOutput(...args),
            codexPermissionBridge: this.codexPermissionBridge,
            permissionPolicyConfig: this.permissionPolicyConfig,
            approvalStorePath: this.approvalStorePath,
          },
          onEvent,
          remainingTimeoutMs,
          generation,
        ),
      onStreamEvent,
    );
  }

  private readOutput(...args: Parameters<typeof readCliOutput>): ReturnType<typeof readCliOutput> {
    return readCliOutput(...args);
  }
}
