import { tmpdir } from 'node:os';

import type {
  AgentRunner,
  SessionCapableRunner,
  AgentSessionSupervisor,
  ArtifactStore,
  DependencyGraph,
  EventBus,
  ExecutionAnalytics,
  JournalWriter,
  ProjectContextStore,
  PromptEngine,
  ProvenanceTracker,
  RoleRegistry,
  RunnerSystem,
} from '@ai-orchestrator/ports';
import { ArtifactDiffGenerator } from '@ai-orchestrator/prompt-engine';
import type {
  AgentResult,
  AgentSessionHandle,
  ArtifactRef,
  DispatchRequest,
  DispatchResult,
  DispatchStatus,
  ModelAssignment,
  ResolvedArtifact,
  RoleContract,
  StreamEventCallback,
  WorkerConstraints,
  WorkerError,
  WorkerMetrics,
  WorkerStatus,
} from '@ai-orchestrator/schemas';

import { WorkerDispatchError } from '../../domain/runner-system/errors';

import { AgentTaskAssembler } from './agent-task-assembler';
import { filterFindings } from './findings-filter';
import type { MetricsInput } from './metrics-recorder';
import { MetricsRecorder } from './metrics-recorder';
import { ParallelManager } from './parallel-manager';
import { RunnerContextAssembler } from './runner-context-assembler';
import { SessionArtifactTracker } from './session-artifact-tracker';
import { generateWorkerId, setWorkerCounter } from './worker-spawner';

interface RunnerSystemOptions {
  readonly maxConcurrency?: number;
  readonly journalWriter?: JournalWriter;
  readonly provenanceTracker?: ProvenanceTracker;
  readonly runnerRegistry?: ReadonlyMap<string, AgentRunner>;
  readonly repoRoot?: string;
  readonly runDir?: string;
  readonly sessionSupervisor?: AgentSessionSupervisor;
  readonly dependencyGraph?: DependencyGraph;
  readonly projectContextStore?: ProjectContextStore;
  readonly executionAnalytics?: ExecutionAnalytics;
}

/** Default implementation of the runner system with retry, metrics, and parallel execution support. */
export class DefaultRunnerSystem implements RunnerSystem {
  private readonly contextAssembler: RunnerContextAssembler;
  private readonly metricsRecorder: MetricsRecorder;
  private readonly parallelManager: ParallelManager;
  private readonly activeWorkers = new Map<string, WorkerStatus>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly promptEngine: PromptEngine;
  private readonly journalWriter: JournalWriter | undefined;
  private readonly provenanceTracker: ProvenanceTracker | undefined;
  private readonly runnerRegistry: ReadonlyMap<string, AgentRunner>;
  private readonly agentTaskAssembler: AgentTaskAssembler;
  private readonly artifactStore: ArtifactStore;
  private readonly sessionSupervisor: AgentSessionSupervisor | undefined;
  private readonly repoRoot: string;
  private readonly runDir: string;
  private readonly artifactTracker = new SessionArtifactTracker();
  private readonly diffGenerator = new ArtifactDiffGenerator();

  constructor(
    artifactStore: ArtifactStore,
    roleRegistry: RoleRegistry,
    promptEngine: PromptEngine,
    eventBus: EventBus,
    options?: RunnerSystemOptions,
  ) {
    this.promptEngine = promptEngine;
    this.artifactStore = artifactStore;
    this.contextAssembler = new RunnerContextAssembler(
      artifactStore,
      roleRegistry,
      promptEngine,
      options?.dependencyGraph,
      options?.projectContextStore,
      options?.executionAnalytics,
    );
    this.metricsRecorder = new MetricsRecorder(eventBus);
    this.parallelManager = new ParallelManager(
      (r, cb) => this.dispatch(r, cb),
      options?.maxConcurrency ?? Infinity,
    );
    this.journalWriter = options?.journalWriter;
    this.provenanceTracker = options?.provenanceTracker;
    this.runnerRegistry = options?.runnerRegistry ?? new Map();
    this.agentTaskAssembler = new AgentTaskAssembler();
    this.sessionSupervisor = options?.sessionSupervisor;
    this.repoRoot = options?.repoRoot ?? tmpdir();
    this.runDir = options?.runDir ?? '.ai/runs';
  }

  /** @inheritdoc */
  async dispatch(
    request: DispatchRequest,
    onStreamEvent?: StreamEventCallback,
  ): Promise<DispatchResult> {
    const workerId = generateWorkerId();
    const startedAt = new Date().toISOString();

    const controller = new AbortController();
    this.abortControllers.set(workerId, controller);

    this.activeWorkers.set(workerId, {
      workerId,
      role: request.role,
      state: 'running',
      startedAt,
      elapsedMs: 0,
    });

    try {
      const context = await this.contextAssembler.assemble(request);

      const sessionKey = `${request.runId}:${request.stateId}:${request.role}`;
      const optimizedArtifacts = this.applyArtifactDiffs(sessionKey, context.inputArtifacts);
      const optimizedContext = { ...context, inputArtifacts: optimizedArtifacts };

      return await this.dispatchAgent(
        workerId,
        startedAt,
        request,
        optimizedContext,
        onStreamEvent,
      );
    } catch (error: unknown) {
      this.updateWorkerState(workerId, 'failed');
      this.abortControllers.delete(workerId);

      const metrics = this.metricsRecorder.buildMetrics(startedAt, 0, 0, 0, 'unknown');
      const workerError = this.toWorkerError(error);

      onStreamEvent?.({
        timestamp: new Date().toISOString(),
        type: 'stderr',
        content: `[dispatch-error] role=${request.role} worker=${workerId}: ${workerError.message}`,
      });

      return {
        workerId,
        role: request.role,
        status: 'failure',
        outputArtifacts: [],
        error: workerError,
        metrics,
      };
    }
  }

  private async dispatchAgent(
    workerId: string,
    startedAt: string,
    request: DispatchRequest,
    context: {
      readonly role: RoleContract;
      readonly prompt: string;
      readonly inputArtifacts: readonly ResolvedArtifact[];
      readonly modelAssignment: ModelAssignment;
      readonly constraints: WorkerConstraints;
    },
    onStreamEvent?: StreamEventCallback,
  ): Promise<DispatchResult> {
    const runnerKey = context.role.runner;
    if (!runnerKey) {
      throw new WorkerDispatchError(
        workerId,
        request.role,
        'Role has dispatchType "agent" but no runner configured',
      );
    }

    const runner = this.runnerRegistry.get(runnerKey);
    if (!runner) {
      throw new WorkerDispatchError(
        workerId,
        request.role,
        `No runner registered for key "${runnerKey}"`,
      );
    }

    const configuredModel = context.role.agentConfig?.model;
    const modelHint =
      configuredModel ??
      (context.modelAssignment.model === 'agent' ? undefined : context.modelAssignment.model);

    let previousFindingsContent = request.previousReviewContent;
    if (request.structuredFindings && request.structuredFindings.length > 0) {
      const { openFindings, summary } = filterFindings(request.structuredFindings);
      const formatted = openFindings
        .map((f) => `- [${f.severity}/${f.blocking}] ${f.title}: ${f.description}`)
        .join('\n');
      previousFindingsContent = summary
        ? `${summary}\n\n## Open Findings\n${formatted}`
        : formatted;
    }

    const agentTask = this.agentTaskAssembler.assemble({
      taskId: workerId,
      role: context.role,
      inputArtifacts: context.inputArtifacts,
      workerConstraints: context.constraints,
      repoRoot: request.variableOverrides?.repoRoot ?? this.repoRoot,
      runDir: this.runDir,
      runId: request.runId,
      stateId: request.stateId,
      modelHint,
      humanFeedback: request.humanFeedback,
      userPrompt: request.userPrompt,
      previousFindings: previousFindingsContent,
      iterationCount: request.iterationCount,
      rolePrompt: context.prompt,
    });

    const metricsInput: MetricsInput = {
      runId: request.runId,
      workerId,
      stateId: request.stateId,
      role: request.role,
      model: modelHint ?? 'agent',
      inputArtifacts: request.inputArtifacts,
    };

    this.metricsRecorder.emitDispatched(metricsInput);

    onStreamEvent?.({
      timestamp: new Date().toISOString(),
      type: 'status',
      content: agentTask.description,
      structuredData: {
        messageType: 'task_prompt',
        role: agentTask.role,
        description: agentTask.description,
        instructions: agentTask.instructions,
        rolePrompt: agentTask.rolePrompt,
        requiredOutput: agentTask.constraints.requiredOutputType,
        model: agentTask.modelHint ?? 'agent',
        dispatchType: 'agent',
        runner: context.role.runner,
        inputArtifacts: agentTask.inputArtifacts.map((a) => ({
          type: a.ref.type,
          name: a.ref.name,
          version: a.ref.version,
          checksum: a.ref.checksum,
        })),
      },
    });

    const emitOutputArtifacts = (outputArtifacts: readonly ArtifactRef[]): void => {
      if (outputArtifacts.length === 0) {
        return;
      }
      onStreamEvent?.({
        timestamp: new Date().toISOString(),
        type: 'status',
        content: '',
        structuredData: {
          phase: 'artifact_produced',
          messageType: 'artifact_produced',
          outputArtifacts: outputArtifacts.map((ref) => ({
            type: ref.type,
            name: ref.name,
            version: ref.version,
            checksum: ref.checksum,
          })),
        },
      });
    };

    try {
      let agentResult: AgentResult;
      if (isSessionCapable(runner)) {
        const dispatchResult = await runner.dispatchWithSession(agentTask, onStreamEvent);
        if (dispatchResult.kind === 'session') {
          return await this.handleSessionResult(
            dispatchResult.handle,
            workerId,
            startedAt,
            request,
            context,
            emitOutputArtifacts,
          );
        }
        agentResult = dispatchResult.result;
      } else {
        agentResult = await runner.dispatch(agentTask, onStreamEvent);
      }

      return await this.processAgentResult(
        agentResult,
        workerId,
        startedAt,
        request,
        context,
        metricsInput,
        emitOutputArtifacts,
        onStreamEvent,
      );
    } catch (error: unknown) {
      this.updateWorkerState(workerId, 'failed');
      this.abortControllers.delete(workerId);

      const metrics = this.metricsRecorder.buildMetrics(startedAt, 0, 0, 0, 'agent');
      const workerError = this.toWorkerError(error);

      onStreamEvent?.({
        timestamp: new Date().toISOString(),
        type: 'stderr',
        content: `[agent-dispatch-error] role=${request.role} worker=${workerId}: ${workerError.message}`,
      });

      this.metricsRecorder.emitFailed(metricsInput, workerError, metrics, false);
      this.recordJournal(metricsInput, [], 'failure', metrics, workerError);

      return {
        workerId,
        role: request.role,
        status: 'failure',
        outputArtifacts: [],
        error: workerError,
        metrics,
      };
    }
  }

  /** @inheritdoc */
  async dispatchParallel(
    requests: readonly DispatchRequest[],
    createStreamCallback?: (request: DispatchRequest) => StreamEventCallback | undefined,
  ): Promise<readonly DispatchResult[]> {
    return this.parallelManager.dispatchAll(requests, createStreamCallback);
  }

  /** @inheritdoc */
  getWorkerStatus(workerId: string): WorkerStatus | null {
    return this.activeWorkers.get(workerId) ?? null;
  }

  /** @inheritdoc */
  // eslint-disable-next-line @typescript-eslint/require-await
  async cancelWorker(workerId: string): Promise<void> {
    const abortCtrl = this.abortControllers.get(workerId);
    if (abortCtrl) {
      abortCtrl.abort();
      this.abortControllers.delete(workerId);
    }
    const status = this.activeWorkers.get(workerId);
    if (status) {
      this.activeWorkers.set(workerId, { ...status, state: 'failed' });
    }
  }

  /** @inheritdoc */
  setWorkerCounter(counter: number): void {
    setWorkerCounter(counter);
  }

  /** @inheritdoc */
  async cancelAllWorkers(): Promise<void> {
    const workerIds = [...this.activeWorkers.keys()];
    await Promise.all(workerIds.map((id) => this.cancelWorker(id)));

    for (const runner of this.runnerRegistry.values()) {
      if (hasKillAll(runner)) {
        runner.killAll();
      }
    }
  }

  private async handleSessionResult(
    handle: AgentSessionHandle,
    workerId: string,
    startedAt: string,
    request: DispatchRequest,
    context: {
      readonly role: RoleContract;
      readonly constraints: WorkerConstraints;
    },
    emitOutputArtifacts: (refs: readonly ArtifactRef[]) => void,
  ): Promise<DispatchResult> {
    const initialMetrics = this.metricsRecorder.buildMetrics(startedAt, 0, 0, 0, 'agent');
    this.updateWorkerState(workerId, 'running');

    if (handle.pendingRequests.length > 0) {
      return {
        workerId,
        role: request.role,
        status: 'success',
        outputArtifacts: [],
        metrics: initialMetrics,
        sessionOutcome: 'awaiting_human',
        sessionRef: handle.ref,
        pendingRequest: handle.pendingRequests[0],
      };
    }

    if (this.sessionSupervisor) {
      const advance = await this.sessionSupervisor.waitForAdvance(handle.ref.sessionId);
      if (advance.kind === 'awaiting_human') {
        return {
          workerId,
          role: request.role,
          status: 'success',
          outputArtifacts: [],
          metrics: initialMetrics,
          sessionOutcome: 'awaiting_human',
          sessionRef: handle.ref,
          pendingRequest: advance.pendingRequest,
        };
      }
      if (advance.kind === 'completed') {
        const sessionArtifacts: ArtifactRef[] = [];
        if (advance.artifactContent) {
          const ref = await this.artifactStore.store({
            type: context.constraints.requiredOutputType,
            name: `${context.role.id}-output`,
            content: advance.artifactContent,
            producedBy: context.role.id,
          });
          sessionArtifacts.push(ref);
        }
        emitOutputArtifacts(sessionArtifacts);
        const tu = advance.tokenUsage;
        const sessionMetrics = tu
          ? this.metricsRecorder.buildMetrics(
              startedAt,
              tu.inputTokens,
              tu.outputTokens,
              0,
              'agent',
            )
          : initialMetrics;
        return {
          workerId,
          role: request.role,
          status: 'success',
          outputArtifacts: sessionArtifacts,
          metrics: sessionMetrics,
          sessionOutcome: 'completed',
          sessionRef: handle.ref,
        };
      }
      return {
        workerId,
        role: request.role,
        status: 'success',
        outputArtifacts: [],
        metrics: initialMetrics,
        sessionOutcome: 'session_active',
        sessionRef: handle.ref,
      };
    }

    return {
      workerId,
      role: request.role,
      status: 'success',
      outputArtifacts: [],
      metrics: initialMetrics,
      sessionOutcome: 'session_active',
      sessionRef: handle.ref,
    };
  }

  private async processAgentResult(
    agentResult: AgentResult,
    workerId: string,
    startedAt: string,
    request: DispatchRequest,
    context: {
      readonly role: RoleContract;
      readonly constraints: WorkerConstraints;
    },
    metricsInput: MetricsInput,
    emitOutputArtifacts: (refs: readonly ArtifactRef[]) => void,
    onStreamEvent?: StreamEventCallback,
  ): Promise<DispatchResult> {
    if (agentResult.status !== 'success' || !agentResult.artifactContent) {
      this.updateWorkerState(workerId, 'failed');
      this.abortControllers.delete(workerId);

      const metrics = this.metricsRecorder.buildMetrics(
        startedAt,
        agentResult.tokenUsage?.inputTokens ?? 0,
        agentResult.tokenUsage?.outputTokens ?? 0,
        0,
        'agent',
      );

      const errorType =
        agentResult.status === 'timeout' ? ('timeout' as const) : ('agent_error' as const);
      const workerError = {
        type: errorType,
        message: agentResult.error ?? 'Agent dispatch failed',
        retryable: false,
      };

      onStreamEvent?.({
        timestamp: new Date().toISOString(),
        type: 'stderr',
        content: `[agent-result-error] role=${request.role} worker=${workerId}: ${workerError.message}`,
      });

      this.metricsRecorder.emitFailed(metricsInput, workerError, metrics, false);
      this.recordJournal(
        metricsInput,
        [],
        agentResult.status === 'timeout' ? 'timeout' : 'failure',
        metrics,
        workerError,
      );

      return {
        workerId,
        role: request.role,
        status: agentResult.status === 'timeout' ? 'timeout' : 'failure',
        outputArtifacts: [],
        error: workerError,
        metrics,
      };
    }

    const schema = context.constraints.outputSchema;
    const validation =
      schema && Object.keys(schema).length > 0
        ? this.promptEngine.validateOutput(agentResult.artifactContent, {
            role: request.role,
            artifactType: context.constraints.requiredOutputType,
            schema,
            format: context.constraints.outputFormat ?? 'json',
            required: true,
            repairEnabled: false,
            maxRepairAttempts: 0,
          })
        : { valid: true as const, errors: [] };

    if (!validation.valid) {
      this.updateWorkerState(workerId, 'failed');
      this.abortControllers.delete(workerId);

      const metrics = this.metricsRecorder.buildMetrics(
        startedAt,
        agentResult.tokenUsage?.inputTokens ?? 0,
        agentResult.tokenUsage?.outputTokens ?? 0,
        0,
        'agent',
      );

      const workerError: WorkerError = {
        type: 'invalid_output',
        message: validation.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
        retryable: false,
      };

      onStreamEvent?.({
        timestamp: new Date().toISOString(),
        type: 'stderr',
        content: `[output-validation-error] role=${request.role} worker=${workerId}: ${workerError.message}`,
      });

      this.metricsRecorder.emitFailed(metricsInput, workerError, metrics, false);
      this.recordJournal(metricsInput, [], 'failure', metrics, workerError);

      return {
        workerId,
        role: request.role,
        status: 'failure',
        outputArtifacts: [],
        error: workerError,
        metrics,
      };
    }

    const ref = await this.artifactStore.store({
      type: context.constraints.requiredOutputType,
      name: `${context.role.id}-output`,
      content: agentResult.artifactContent,
      producedBy: context.role.id,
    });

    const agentInputTokens = agentResult.tokenUsage?.inputTokens ?? 0;
    const agentOutputTokens = agentResult.tokenUsage?.outputTokens ?? 0;

    const metrics = this.metricsRecorder.buildMetrics(
      startedAt,
      agentInputTokens,
      agentOutputTokens,
      0,
      'agent',
    );

    this.metricsRecorder.emitCompleted(metricsInput, [ref], metrics, 0);
    this.recordProvenance(workerId, request, [ref]);
    this.recordJournal(metricsInput, [ref], 'success', metrics);
    this.updateWorkerState(workerId, 'completed');
    this.abortControllers.delete(workerId);
    emitOutputArtifacts([ref]);

    return {
      workerId,
      role: request.role,
      status: 'success',
      outputArtifacts: [ref],
      metrics,
    };
  }

  private recordProvenance(
    workerId: string,
    request: DispatchRequest,
    outputArtifacts: readonly ArtifactRef[],
  ): void {
    if (!this.provenanceTracker) {
      return;
    }
    for (const output of outputArtifacts) {
      this.provenanceTracker.recordDerivation(output, request.inputArtifacts, workerId);
    }
  }

  private recordJournal(
    input: MetricsInput,
    outputArtifacts: readonly ArtifactRef[],
    status: DispatchStatus,
    metrics: WorkerMetrics,
    error?: WorkerError,
  ): void {
    if (!this.journalWriter) {
      return;
    }
    const eventType =
      status === 'success' ? ('worker_completed' as const) : ('worker_failed' as const);
    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: input.runId,
      sequence: 0,
      type: eventType,
      data: {
        kind: 'worker',
        workerId: input.workerId,
        role: input.role,
        stateId: input.stateId,
        status,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        durationMs: metrics.durationMs,
        retryCount: metrics.retryCount,
        outputArtifacts,
        error: error?.message,
      },
    });
  }

  private toWorkerError(error: unknown): WorkerError {
    if (error instanceof Error) {
      return {
        type: 'agent_error',
        message: error.message,
        retryable: true,
      };
    }
    return {
      type: 'agent_error',
      message: String(error),
      retryable: false,
    };
  }

  private applyArtifactDiffs(
    sessionKey: string,
    artifacts: readonly ResolvedArtifact[],
  ): readonly ResolvedArtifact[] {
    const tracking = this.artifactTracker.track(sessionKey, artifacts);

    return artifacts.map((artifact) => {
      const entry = tracking.get(artifact.ref.type);
      if (!entry || entry.kind === 'new') {
        return artifact;
      }

      if (entry.kind === 'unchanged') {
        return {
          ...artifact,
          content: `[Unchanged since iteration ${String(entry.iterationSeen)} — content omitted]`,
        };
      }

      const diffResult = this.diffGenerator.computeDiff(entry.previousContent, artifact.content);
      return {
        ...artifact,
        content: diffResult.diff
          ? `[Changed since previous iteration]\n\n${diffResult.diff}`
          : artifact.content,
      };
    });
  }

  private updateWorkerState(workerId: string, state: WorkerStatus['state']): void {
    const status = this.activeWorkers.get(workerId);
    if (status) {
      this.activeWorkers.set(workerId, {
        ...status,
        state,
        elapsedMs: Date.now() - new Date(status.startedAt).getTime(),
      });
    }
  }
}

interface KillableRunner {
  killAll(): void;
}

function isSessionCapable(runner: AgentRunner): runner is SessionCapableRunner {
  return 'supportsResumableSessions' in runner && 'dispatchWithSession' in runner;
}

function hasKillAll(runner: AgentRunner): runner is AgentRunner & KillableRunner {
  return 'killAll' in runner && typeof (runner as KillableRunner).killAll === 'function';
}
