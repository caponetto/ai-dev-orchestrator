import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { REVIEW_ARTIFACT_TYPES } from '@ai-orchestrator/artifacts';
import type {
  AgentSessionSupervisor,
  AgentStreamBus,
  AgreementGate,
  ArtifactStore,
  ExecutionAnalytics,
  GovernanceEngine,
  IterationContractRegistry,
  JournalWriter,
  Logger,
  ManifestProducer,
  ManifestWriter,
  ProjectContextStore,
  RoleRegistry,
  RunnerSystem,
  StalenessDetector,
  StatePersistence,
  WorkflowEngine,
} from '@ai-orchestrator/ports';
import { createRunId, noopLogger } from '@ai-orchestrator/ports';
import type { ShutdownCoordinator } from '@ai-orchestrator/recovery';
import { renderReport } from '@ai-orchestrator/run-manifest';
import type {
  Action,
  ActionResult,
  ArtifactRef,
  EngineState,
  GovernanceOutcome,
  HumanInput,
  LockHandle,
  PersistedState,
  PersistedWaitingContext,
  RoleId,
  RunId,
  RunManifest,
  RunResult,
  ScriptDirectives,
  TransitionTrigger,
  WaitingContext,
  WorkflowRunConfig,
} from '@ai-orchestrator/schemas';
import { getErrorMessage } from '@ai-orchestrator/utils';

import {
  MaxTransitionsExceededError,
  WorkflowTimeoutError,
} from '../../domain/workflow-engine/errors';

import { ActionDispatcher } from './action-dispatcher';
import { extractConfidenceReport } from './confidence-extractor';
import { GuardChecker } from './guard-checker';
import { PostRunContextUpdater } from './post-run-context-updater';
import { ReviewResultInterpreter } from './review-result-interpreter';
import { StateHistory } from './state-history';
import { TransitionEvaluator } from './transition-evaluator';

const DEFAULT_TRANSITION_LIMIT = 200;

export interface LifecycleControllerOptions {
  runner: RunnerSystem;
  artifactStore: ArtifactStore;
  governanceEngine: GovernanceEngine;
  contractRegistry: IterationContractRegistry;
  journalWriter: JournalWriter;
  statePersistence: StatePersistence;
  manifestProducer: ManifestProducer;
  shutdownCoordinator?: ShutdownCoordinator;
  workflowTimeoutMs?: number;
  stalenessDetector?: StalenessDetector;
  manifestWriter?: ManifestWriter;
  agentStreamBus?: AgentStreamBus;
  agreementGate?: AgreementGate;
  sessionSupervisor?: AgentSessionSupervisor;
  projectContextStore?: ProjectContextStore;
  roleRegistry?: RoleRegistry;
  executionAnalytics?: ExecutionAnalytics;
  logger?: Logger;
}

/** Main FSM orchestration controller. Implements the WorkflowEngine port. */
export class LifecycleController implements WorkflowEngine {
  private readonly runner: RunnerSystem;
  private readonly artifactStore: ArtifactStore;
  private readonly governanceEngine: GovernanceEngine;
  private readonly contractRegistry: IterationContractRegistry;
  private readonly journalWriter: JournalWriter;
  private readonly statePersistence: StatePersistence;
  private readonly manifestProducer: ManifestProducer;
  private readonly manifestWriter?: ManifestWriter;
  private readonly shutdownCoordinator?: ShutdownCoordinator;
  private readonly sessionSupervisor?: AgentSessionSupervisor;
  private readonly agentStreamBus?: AgentStreamBus;
  private readonly workflowTimeoutMs: number;
  private readonly logger: Logger;
  private readonly guardChecker: GuardChecker;
  private readonly contextUpdater: PostRunContextUpdater | null;
  private readonly executionAnalytics: ExecutionAnalytics | undefined;
  private readonly roleRegistry: RoleRegistry | undefined;
  private readonly evaluator: TransitionEvaluator;
  private readonly dispatcher: ActionDispatcher;
  private readonly reviewInterpreter: ReviewResultInterpreter;

  private runId: RunId = createRunId('');
  private currentState = '';
  private previousState: string | null = null;
  private stateEnteredAt = '';
  private transitionCount = 0;
  private stateHistory: StateHistory = new StateHistory();
  private config: WorkflowRunConfig | null = null;
  private startedAt = 0;
  private lockHandle: LockHandle | null = null;
  private waitingContext: PersistedWaitingContext | null = null;
  private cumulativeInputTokens = 0;
  private cumulativeOutputTokens = 0;
  private firedThresholdIndex = -1;
  private lastHumanFeedback: string | null = null;
  private lastReviewContent: string | null = null;
  private lastTrigger: string | null = null;
  private hasReceivedUsage = false;
  private governanceDecisionCount = 0;
  private escalationCount = 0;
  private aborted = false;
  private stateTimestamps: { stateId: string; enteredAt: string; exitedAt: string }[] = [];
  private workerMetricsByRole: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      dispatches: number;
      durationMs: number;
      artifactsProduced: number;
    }
  > = {};
  private workerFailuresByRole: Record<string, { error: string; model?: string }[]> = {};
  private workerModelByRole: Record<string, string> = {};
  private lastConfidenceScore: number | null = null;
  private budgetApproved = false;
  private interruptedActionResults: readonly ActionResult[] | null = null;

  constructor(opts: LifecycleControllerOptions) {
    this.runner = opts.runner;
    this.artifactStore = opts.artifactStore;
    this.governanceEngine = opts.governanceEngine;
    this.contractRegistry = opts.contractRegistry;
    this.journalWriter = opts.journalWriter;
    this.statePersistence = opts.statePersistence;
    this.manifestProducer = opts.manifestProducer;
    this.manifestWriter = opts.manifestWriter;
    this.shutdownCoordinator = opts.shutdownCoordinator;
    this.sessionSupervisor = opts.sessionSupervisor;
    this.agentStreamBus = opts.agentStreamBus;
    this.workflowTimeoutMs = opts.workflowTimeoutMs ?? 0;
    this.logger = opts.logger ?? noopLogger;
    this.guardChecker = new GuardChecker(
      opts.artifactStore,
      opts.contractRegistry,
      this.logger,
      opts.projectContextStore,
    );
    this.contextUpdater = opts.projectContextStore
      ? new PostRunContextUpdater(opts.projectContextStore)
      : null;
    this.executionAnalytics = opts.executionAnalytics;
    this.roleRegistry = opts.roleRegistry;
    this.evaluator = new TransitionEvaluator(this.guardChecker, opts.governanceEngine, this.logger);
    this.dispatcher = new ActionDispatcher(
      opts.runner,
      opts.artifactStore,
      opts.journalWriter,
      opts.stalenessDetector,
      opts.agentStreamBus,
      opts.agreementGate,
      this.logger,
    );
    this.reviewInterpreter = new ReviewResultInterpreter(
      opts.artifactStore,
      opts.contractRegistry,
      this.logger,
    );
  }

  /** Hydrate engine state from a persisted checkpoint so that resume() can proceed. */
  restore(config: WorkflowRunConfig, state: PersistedState): void {
    this.config = config;
    this.runId = createRunId(config.runId);
    this.currentState = state.currentState;
    this.previousState = state.previousState;
    this.stateEnteredAt = state.stateEnteredAt;
    this.transitionCount = state.transitionCount;
    this.stateHistory = new StateHistory(state.stateHistory);
    this.waitingContext = state.waitingContext ?? null;
    this.startedAt = Date.now();

    this.dispatcher.setUserPrompt(config.sources[0]);
    this.dispatcher.setWorkflowMetadata(
      config.workflowDefinition.name,
      config.workflowDefinition.version,
    );
    this.dispatcher.setConfigVariables(this.buildConfigVariables(config));
    this.dispatcher.setRepoRoot(config.repoRoot ?? '');
    this.dispatcher.setRunDir(config.runDir ?? '');
    if (state.dispatchCounter != null) {
      this.dispatcher.setDispatchCounter(state.dispatchCounter);
      this.runner.setWorkerCounter(state.dispatchCounter);
    }

    this.contractRegistry.restoreIterationCounts(new Map(Object.entries(state.iterationCounts)));

    if (state.judgeArbitrationCounts) {
      this.contractRegistry.restoreJudgeArbitrationCounts(
        new Map(Object.entries(state.judgeArbitrationCounts)),
      );
    }

    this.lastHumanFeedback = state.lastHumanFeedback ?? null;
    this.lastReviewContent = state.lastReviewContent ?? null;
    this.lastTrigger = state.lastTrigger ?? null;
    this.cumulativeInputTokens = state.cumulativeInputTokens ?? 0;
    this.cumulativeOutputTokens = state.cumulativeOutputTokens ?? 0;
    this.firedThresholdIndex = state.firedThresholdIndex ?? -1;
    this.hasReceivedUsage = state.hasReceivedUsage ?? false;
    this.governanceDecisionCount = state.governanceDecisionCount ?? 0;
    this.escalationCount = state.escalationCount ?? 0;
    this.workerMetricsByRole = state.workerMetricsByRole
      ? Object.fromEntries(Object.entries(state.workerMetricsByRole).map(([k, v]) => [k, { ...v }]))
      : {};
    this.stateTimestamps = Array.isArray(state.stateTimestamps)
      ? state.stateTimestamps.map(
          (e: { stateId: string; enteredAt: string; exitedAt: string }) => ({
            ...e,
          }),
        )
      : [];
  }

  /** @inheritdoc */
  async start(config: WorkflowRunConfig): Promise<RunResult> {
    this.config = config;
    this.runId = createRunId(config.runId);
    this.currentState = config.workflowDefinition.initialState;
    this.stateEnteredAt = new Date().toISOString();
    this.transitionCount = 0;
    this.stateHistory = new StateHistory();
    this.stateHistory.record(this.currentState);
    this.stateTimestamps = [];

    this.dispatcher.setUserPrompt(config.sources[0]);
    this.dispatcher.setWorkflowMetadata(
      config.workflowDefinition.name,
      config.workflowDefinition.version,
    );
    this.dispatcher.setConfigVariables(this.buildConfigVariables(config));
    this.dispatcher.setRepoRoot(config.repoRoot ?? '');
    this.dispatcher.setRunDir(config.runDir ?? '');

    this.lockHandle = this.statePersistence.acquireLock(this.runId);

    const transitionLimit = config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT;
    this.startedAt = Date.now();

    try {
      return await this.runLoop(config, transitionLimit);
    } catch (error: unknown) {
      this.journalRunLoopError(error);
      this.releaseLockIfHeld();
      throw error;
    }
  }

  /** @inheritdoc */
  async pause(context: WaitingContext): Promise<void> {
    this.recordStateExit();
    this.previousState = this.currentState;
    this.currentState = 'WAITING_FOR_HUMAN';
    this.stateEnteredAt = new Date().toISOString();
    this.stateHistory.record('WAITING_FOR_HUMAN');

    this.waitingContext = {
      reason: context.reason,
      requiredInput: context.requiredInput,
      requestingState: context.requestingState,
      autoResumeSafe: context.autoResumeSafe,
      presentedArtifacts: context.presentedArtifacts,
      waitingSince: context.waitingSince,
    };

    this.transitionCount += 1;
    this.recordTransition(this.previousState, 'WAITING_FOR_HUMAN', 'human_input');

    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: 0,
      type: 'human_input_requested',
      data: {
        kind: 'human',
        action: 'input_requested',
        stateId: this.currentState,
        reason: context.reason,
      },
    });

    await this.saveCheckpoint();
  }

  /** @inheritdoc */
  async resume(input: HumanInput): Promise<RunResult> {
    if (!this.config) {
      throw new Error('No active run to resume');
    }
    const savedWaitingContext = this.waitingContext;
    this.waitingContext = null;

    if (savedWaitingContext?.liveSessionId) {
      if (!this.sessionSupervisor) {
        throw new Error(
          'Cannot resume session: no session supervisor configured. ' +
            `Session ${savedWaitingContext.liveSessionId} requires a supervisor for reattach.`,
        );
      }

      if (!this.lockHandle) {
        this.lockHandle = this.statePersistence.acquireLock(this.runId);
      }

      const sessionId = savedWaitingContext.liveSessionId;
      const handle = await this.sessionSupervisor.attach(sessionId);

      if (!handle) {
        const snapshot = await this.sessionSupervisor.getSnapshot(sessionId);
        if (snapshot && savedWaitingContext.sessionTransport === 'stdio') {
          return this.handleDeadSession(
            savedWaitingContext,
            `Local stdio session ${sessionId} cannot be recovered after process restart — ` +
              `child process stdin/stdout handles are severed when the parent exits.`,
          );
        }
        if (snapshot && savedWaitingContext.sessionTransport === 'remote') {
          return this.handleDeadSession(
            savedWaitingContext,
            `Remote session ${sessionId} reconnect failed — ` +
              `transport factory unavailable or lease expired.`,
          );
        }
        return this.handleDeadSession(savedWaitingContext);
      }

      this.journalWriter.append({
        timestamp: new Date().toISOString(),
        runId: this.runId,
        sequence: 0,
        type: 'human_input_received',
        data: {
          kind: 'human',
          action: 'session_resumed',
          stateId: this.currentState,
          sessionId,
        },
      });

      const responsePayload =
        input.type === 'approval'
          ? { granted: true, reason: input.content }
          : input.type === 'rejection'
            ? { granted: false, reason: input.content }
            : { answer: input.content };

      const requestId = savedWaitingContext.pendingRequestId;
      if (requestId) {
        await this.sessionSupervisor.sendHumanResponse(sessionId, requestId, responsePayload);
      }

      const advance = await this.sessionSupervisor.waitForAdvance(sessionId);

      if (advance.kind === 'completed') {
        this.recordStateExit();
        this.previousState = this.currentState;
        this.currentState = savedWaitingContext.requestingState;
        this.stateEnteredAt = new Date().toISOString();
        this.transitionCount += 1;
        this.stateHistory.record(this.currentState);

        const sessionArtifactRef: ArtifactRef | undefined = advance.artifactContent
          ? await this.artifactStore
              .store({
                type: 'implementation',
                name: 'session-output',
                content: advance.artifactContent,
                producedBy: savedWaitingContext.requestingState,
                runId: this.runId,
              })
              .catch(() => undefined)
          : undefined;

        const sessionActionResult: ActionResult = {
          action: {
            type: 'dispatch_worker',
            params: { role: savedWaitingContext.requestingState as RoleId },
          },
          success: true,
          artifactRef: sessionArtifactRef,
        };

        const transitionLimit = this.config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT;
        try {
          return await this.runLoop(this.config, transitionLimit, [sessionActionResult]);
        } catch (error: unknown) {
          this.journalRunLoopError(error);
          this.releaseLockIfHeld();
          throw error;
        }
      }

      if (advance.kind === 'awaiting_human') {
        const originatingState = savedWaitingContext.requestingState;
        if (this.currentState !== 'WAITING_FOR_HUMAN') {
          this.recordStateExit();
          this.previousState = this.currentState;
          this.currentState = 'WAITING_FOR_HUMAN';
          this.stateEnteredAt = new Date().toISOString();
          this.transitionCount += 1;
          this.stateHistory.record(this.currentState);
        }

        this.waitingContext = {
          reason: 'live_session_awaiting_human',
          requiredInput: advance.pendingRequest.kind === 'clarification' ? 'text' : 'approval',
          requestingState: originatingState,
          autoResumeSafe: false,
          presentedArtifacts: [],
          waitingSince: new Date().toISOString(),
          liveSessionId: sessionId,
          pendingRequestId: advance.pendingRequest.requestId,
          liveRequestType: advance.pendingRequest.kind,
          sessionTransport: savedWaitingContext.sessionTransport,
        };

        await this.saveCheckpoint();
        this.releaseLockIfHeld();

        return {
          runId: this.runId,
          finalState: this.currentState,
          artifactInventory: [],
          manifest: this.buildEarlyManifest(),
        };
      }

      return this.handleDeadSession(savedWaitingContext, advance.error);
    }

    if (input.type === 'rejection' && input.content) {
      this.lastHumanFeedback = input.content;
    }

    // A human rejection restarts a loop from scratch — reset iteration counts
    // so the agents get a fresh budget of iterations for the rework.
    if (input.type === 'rejection') {
      for (const contract of this.contractRegistry.listContracts()) {
        this.contractRegistry.resetIterationCount(contract.id);
      }
    }

    // Budget escalation approval: return to the state that was interrupted.
    if (
      input.type === 'approval' &&
      savedWaitingContext?.reason === 'token_budget_exceeded' &&
      savedWaitingContext.requestingState
    ) {
      if (!this.lockHandle) {
        this.lockHandle = this.statePersistence.acquireLock(this.runId);
      }
      this.journalWriter.append({
        timestamp: new Date().toISOString(),
        runId: this.runId,
        sequence: 0,
        type: 'human_approval',
        data: {
          kind: 'human',
          action: 'approval',
          stateId: this.currentState,
          inputType: 'approval',
          ...(input.content ? { message: input.content } : {}),
        },
      });

      const targetState = savedWaitingContext.requestingState;
      this.recordStateExit();
      const fromState = this.currentState;
      this.previousState = this.currentState;
      this.currentState = targetState;
      this.stateEnteredAt = new Date().toISOString();
      this.transitionCount += 1;
      this.stateHistory.record(this.currentState);
      this.recordTransition(fromState, this.currentState, 'human_approved');

      this.logger.info(
        `[LifecycleController] Budget escalation approved — resuming state '${targetState}'`,
      );

      this.budgetApproved = true;
      const savedResults = this.interruptedActionResults ?? undefined;
      this.interruptedActionResults = null;
      await this.saveCheckpoint();
      const transitionLimit = this.config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT;
      try {
        return await this.runLoop(this.config, transitionLimit, savedResults, !!savedResults);
      } catch (error: unknown) {
        this.journalRunLoopError(error);
        await this.saveCheckpoint().catch(() => undefined);
        this.releaseLockIfHeld();
        throw error;
      }
    }

    // Acquire lock early so checkpoint saves are consistent with journal writes.
    if (!this.lockHandle) {
      this.lockHandle = this.statePersistence.acquireLock(this.runId);
    }

    let trigger: TransitionTrigger =
      input.type === 'approval'
        ? 'human_approved'
        : input.type === 'rejection'
          ? 'human_rejected'
          : 'human_input';

    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: 0,
      type:
        input.type === 'approval'
          ? 'human_approval'
          : input.type === 'rejection'
            ? 'human_rejection'
            : 'human_input_received',
      data: {
        kind: 'human',
        action: input.type,
        stateId: this.currentState,
        inputType: input.type,
        ...(input.content ? { message: input.content } : {}),
      },
    });

    const definition = this.config.workflowDefinition;
    const stateDefinition = definition.states[this.currentState];

    if (this.currentState !== 'WAITING_FOR_HUMAN' && stateDefinition.type === 'review') {
      const mappedTrigger: TransitionTrigger =
        input.type === 'approval'
          ? 'review_approved'
          : input.type === 'rejection'
            ? 'review_rejected'
            : trigger;
      this.logger.debug(
        `[LifecycleController] resume from review state ${this.currentState}, mapping trigger '${trigger}' → '${mappedTrigger}'`,
      );
      trigger = mappedTrigger;
    }

    const context = {
      runId: this.runId,
      currentIteration: this.stateHistory.visitCount(this.currentState),
      stateHistory: [...this.stateHistory.getHistory()],
      waitingContext: savedWaitingContext
        ? {
            reason: savedWaitingContext.reason,
            requiredInput: savedWaitingContext.requiredInput,
            requestingState: savedWaitingContext.requestingState,
            autoResumeSafe: savedWaitingContext.autoResumeSafe,
            presentedArtifacts: savedWaitingContext.presentedArtifacts,
            waitingSince: savedWaitingContext.waitingSince,
          }
        : undefined,
      tokenUsage: {
        inputTokens: this.cumulativeInputTokens,
        outputTokens: this.cumulativeOutputTokens,
        totalTokens: this.cumulativeInputTokens + this.cumulativeOutputTokens,
      },
      repoRoot: this.config.repoRoot,
    };

    if (!this.aborted) {
      const evaluated = await this.evaluator.evaluate(stateDefinition, trigger, context);
      if (evaluated) {
        this.recordStateExit();
        const fromState = this.currentState;
        this.previousState = this.currentState;
        this.currentState = evaluated.definition.target;
        this.stateEnteredAt = new Date().toISOString();
        this.transitionCount += 1;
        this.stateHistory.record(this.currentState);

        if (trigger === 'human_rejected') {
          const requestingState = savedWaitingContext?.requestingState ?? fromState;
          const reqLabel = definition.states[requestingState].label ?? requestingState;
          const toLabel = definition.states[this.currentState].label ?? this.currentState;
          if (!definition.terminalStates.includes(this.currentState)) {
            this.agentStreamBus?.publish({
              runId: this.runId,
              stateId: this.currentState,
              roleId: 'orchestrator',
              dispatchId: `human-rejection-${String(Date.now())}`,
              timestamp: new Date().toISOString(),
              type: 'status',
              content: `Human rejected ${reqLabel} — going back to ${toLabel}.`,
              structuredData: {
                action: 'human_rejection',
                fromState: requestingState,
                toState: this.currentState,
                trigger,
              },
            });
          }
        }

        this.journalWriter.append({
          timestamp: new Date().toISOString(),
          runId: this.runId,
          sequence: 0,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: fromState,
            to: this.currentState,
            trigger,
            durationMs: 0,
            guardsEvaluated: evaluated.guardsResult.length,
            guardsPassed: evaluated.guardsResult.filter((g) => g.passed).length,
            governanceRequired: evaluated.definition.governanceRequired,
            governanceOutcome: 'allowed',
            contractId: this.contractRegistry.getContractForState(this.currentState)?.id,
          },
        });
      } else {
        const reqState = savedWaitingContext?.requestingState ?? 'unknown';
        this.logger.warn(
          `[LifecycleController] No matching transition from '${this.currentState}' with trigger '${trigger}' (requestingState: '${reqState}'). ` +
            `The workflow definition may be missing a transition for this requestingState.`,
        );
        if (savedWaitingContext) {
          this.waitingContext = savedWaitingContext;
          await this.saveCheckpoint();
          this.releaseLockIfHeld();
          return {
            runId: this.runId,
            finalState: this.currentState,
            artifactInventory: [],
            manifest: this.buildEarlyManifest(),
          };
        }
      }
    }

    await this.saveCheckpoint();

    const transitionLimit = this.config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT;
    try {
      return await this.runLoop(this.config, transitionLimit);
    } catch (error: unknown) {
      this.journalRunLoopError(error);
      await this.saveCheckpoint().catch(() => undefined);
      this.releaseLockIfHeld();
      throw error;
    }
  }

  /** @inheritdoc */
  async retry(): Promise<RunResult> {
    if (!this.config) {
      throw new Error('No active run to retry — call restore() first');
    }

    const definition = this.config.workflowDefinition;
    if (definition.terminalStates.includes(this.currentState)) {
      throw new Error(
        `Cannot retry from terminal state '${this.currentState}' — checkpoint must be rewritten before retry`,
      );
    }

    this.aborted = false;
    this.startedAt = Date.now();

    this.dispatcher.setUserPrompt(this.config.sources[0]);
    this.dispatcher.setWorkflowMetadata(definition.name, definition.version);
    this.dispatcher.setConfigVariables(this.buildConfigVariables(this.config));
    this.dispatcher.setRepoRoot(this.config.repoRoot ?? '');
    this.dispatcher.setRunDir(this.config.runDir ?? '');

    this.lockHandle = this.statePersistence.acquireLock(this.runId);

    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: 0,
      type: 'run_resumed',
      data: {
        kind: 'run_lifecycle',
        workflowName: definition.name,
        workflowVersion: definition.version,
        status: 'retrying',
        reason: `Retrying from state '${this.currentState}'`,
      },
    });

    const transitionLimit = this.config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT;
    try {
      return await this.runLoop(this.config, transitionLimit);
    } catch (error: unknown) {
      this.journalRunLoopError(error);
      this.releaseLockIfHeld();
      throw error;
    }
  }

  /** @inheritdoc */
  async abort(reason: string): Promise<void> {
    if (this.aborted || this.currentState === 'ABORTED') {
      return;
    }
    this.aborted = true;

    await this.runner.cancelAllWorkers().catch(() => undefined);

    this.recordStateExit();
    const fromState = this.currentState;
    this.previousState = this.currentState;
    this.currentState = 'ABORTED';
    this.stateEnteredAt = new Date().toISOString();
    this.stateHistory.record('ABORTED');
    this.waitingContext = null;

    this.recordTransition(fromState, 'ABORTED', 'failure');

    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: 0,
      type: 'run_aborted',
      data: {
        kind: 'run_lifecycle',
        workflowName: this.config?.workflowDefinition.name ?? 'default',
        workflowVersion: this.config?.workflowDefinition.version ?? '1.0.0',
        reason,
      },
    });

    this.agentStreamBus?.publish({
      runId: this.runId,
      stateId: 'ABORTED',
      roleId: 'orchestrator',
      dispatchId: `abort-${String(Date.now())}`,
      timestamp: new Date().toISOString(),
      type: 'status',
      content: `Workflow '${this.config?.workflowDefinition.name ?? 'unknown'}' was aborted.`,
      structuredData: { action: 'aborted' },
    });

    await this.saveCheckpoint();

    const manifest = this.buildEarlyManifest();
    if (this.manifestWriter) {
      this.manifestWriter.write(this.runId, manifest);
    }

    this.releaseLockIfHeld();
  }

  /** @inheritdoc */
  getState(): EngineState {
    const isWaiting = this.currentState === 'WAITING_FOR_HUMAN';
    return {
      runId: this.runId,
      currentState: this.currentState,
      previousState: this.previousState,
      stateEnteredAt: this.stateEnteredAt,
      transitionCount: this.transitionCount,
      isWaitingForHuman: isWaiting,
      waitingContext:
        isWaiting && this.waitingContext
          ? {
              reason: this.waitingContext.reason,
              requiredInput: this.waitingContext.requiredInput,
              requestingState: this.waitingContext.requestingState,
              autoResumeSafe: this.waitingContext.autoResumeSafe,
              presentedArtifacts: this.waitingContext.presentedArtifacts,
              waitingSince: this.waitingContext.waitingSince,
              budgetExhaustion: this.waitingContext.budgetExhaustion,
            }
          : undefined,
    };
  }

  private async runLoop(
    config: WorkflowRunConfig,
    transitionLimit: number,
    initialActionResults?: readonly ActionResult[],
    skipInitialUsageAccumulation?: boolean,
  ): Promise<RunResult> {
    const definition = config.workflowDefinition;

    this.shutdownCoordinator?.onShutdown(() => {
      this.runner.cancelAllWorkers().catch(() => undefined);
    });

    while (!definition.terminalStates.includes(this.currentState) && !this.aborted) {
      if (this.transitionCount >= transitionLimit) {
        throw new MaxTransitionsExceededError(this.transitionCount, transitionLimit);
      }

      if (this.shutdownCoordinator?.isShutdownRequested()) {
        this.journalWriter.append({
          timestamp: new Date().toISOString(),
          runId: this.runId,
          sequence: 0,
          type: 'run_aborted',
          data: {
            kind: 'run_lifecycle',
            workflowName: config.workflowDefinition.name,
            workflowVersion: config.workflowDefinition.version,
            reason: `shutdown:${this.shutdownCoordinator.getShutdownReason()}`,
            status: 'interrupted',
          },
        });
        await this.saveCheckpoint();
        break;
      }

      if (this.workflowTimeoutMs > 0 && Date.now() - this.startedAt > this.workflowTimeoutMs) {
        throw new WorkflowTimeoutError(this.currentState, this.workflowTimeoutMs);
      }

      const stateDefinition = definition.states[this.currentState];

      if (
        config.budgetMaxTokens != null &&
        stateDefinition.type !== 'wait' &&
        !this.budgetApproved
      ) {
        const totalTokens = this.cumulativeInputTokens + this.cumulativeOutputTokens;
        if (totalTokens > config.budgetMaxTokens) {
          this.logger.warn(
            `[LifecycleController] Pre-action budget exceeded in state '${this.currentState}': ${String(totalTokens)} > ${String(config.budgetMaxTokens)}`,
          );
          await this.enterWaitingForHuman({
            waitingContext: {
              reason: 'token_budget_exceeded',
              requiredInput: 'approval',
              requestingState: this.currentState,
              autoResumeSafe: false,
              presentedArtifacts: [],
              waitingSince: new Date().toISOString(),
              budgetExhaustion: {
                limitType: 'token',
                current: totalTokens,
                limit: config.budgetMaxTokens,
                cumulativeTokens: totalTokens,
              },
            },
            trigger: 'escalation',
            reason: 'token_budget_exceeded',
            governanceOpts: { governanceRequired: true, governanceOutcome: 'escalated' },
            releaseLock: true,
          });
          break;
        }
      }

      if (stateDefinition.type === 'wait') {
        let waitActionResults: readonly ActionResult[] = [];
        if (stateDefinition.entryActions) {
          waitActionResults = await this.dispatcher.executeAll(
            stateDefinition.entryActions,
            this.runId,
            this.currentState,
          );
          this.accumulateUsage(waitActionResults);
        }

        const notifyAction = stateDefinition.entryActions?.find(
          (a): a is Extract<Action, { type: 'notify_human' }> => a.type === 'notify_human',
        );
        const reason = notifyAction?.params.reason ?? 'waiting_for_human';
        let presentedArtifacts: ArtifactRef[] = waitActionResults
          .map((r) => r.artifactRef)
          .filter((ref): ref is NonNullable<typeof ref> => ref !== undefined);
        try {
          const inv = await this.artifactStore.inventory();
          if (inv.artifacts.length > 0) {
            const inventoryRefs = inv.artifacts.map((a) => a.ref);
            const seen = new Set(inventoryRefs.map((r) => `${r.type}:${r.name}`));
            presentedArtifacts = [
              ...inventoryRefs,
              ...presentedArtifacts.filter((r) => !seen.has(`${r.type}:${r.name}`)),
            ];
          }
        } catch (err: unknown) {
          this.logger.debug(
            `[LifecycleController] Inventory read failed in wait state: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        const requestingState = this.previousState ?? this.currentState;
        const needsTextInput = reason === 'clarification_needed';
        this.waitingContext = {
          reason,
          requiredInput: needsTextInput ? 'text' : 'approval',
          requestingState,
          autoResumeSafe: !needsTextInput,
          presentedArtifacts,
          waitingSince: new Date().toISOString(),
        };

        this.journalWriter.append({
          timestamp: new Date().toISOString(),
          runId: this.runId,
          sequence: 0,
          type: 'human_input_requested',
          data: {
            kind: 'human',
            action: 'input_requested',
            stateId: this.currentState,
            reason,
          },
        });

        await this.saveCheckpoint();
        this.releaseLockIfHeld();
        break;
      }

      let actionResults: readonly ActionResult[] = [];
      if (initialActionResults) {
        actionResults = initialActionResults;
        initialActionResults = undefined;
        if (!skipInitialUsageAccumulation) {
          this.accumulateUsage(actionResults);
        }
        skipInitialUsageAccumulation = false;
        this.checkAlertThresholds();
      } else if (stateDefinition.entryActions) {
        const feedback = this.lastHumanFeedback ?? undefined;
        this.lastHumanFeedback = null;
        const reviewContent = this.lastReviewContent ?? undefined;
        this.lastReviewContent = null;
        const contract = this.contractRegistry.getContractForState(this.currentState);
        const iterState = contract
          ? this.contractRegistry.getIterationState(contract.id)
          : undefined;
        const iterCount = iterState?.currentIteration;
        actionResults = await this.dispatcher.executeAll(
          stateDefinition.entryActions,
          this.runId,
          this.currentState,
          undefined,
          feedback,
          reviewContent,
          iterCount,
        );
        this.accumulateUsage(actionResults);
        this.checkAlertThresholds();
      }

      // After worker dispatch returns, check if shutdown was requested while awaiting.
      // Without this, a killed worker's failure result flows into the transition evaluator
      // and lands in FAILED instead of ABORTED.
      if (this.shutdownCoordinator?.isShutdownRequested()) {
        await this.abort(`shutdown:${this.shutdownCoordinator.getShutdownReason()}`);
        break;
      }

      const confidenceReport = extractConfidenceReport(actionResults);
      if (confidenceReport) {
        this.lastConfidenceScore = confidenceReport.score;
        this.guardChecker.setLastConfidenceReport(confidenceReport);
      }

      const scriptDirectives = applyScriptDirectives(actionResults);
      if (scriptDirectives?.repoRoot) {
        (config as { repoRoot?: string }).repoRoot = scriptDirectives.repoRoot;
        this.config = config;
        this.dispatcher.setRepoRoot(scriptDirectives.repoRoot);
        this.dispatcher.setConfigVariables(this.buildConfigVariables(config));
      }

      if (config.budgetMaxTokens != null && !this.budgetApproved) {
        const totalTokens = this.cumulativeInputTokens + this.cumulativeOutputTokens;
        if (totalTokens > config.budgetMaxTokens) {
          this.logger.warn(
            `[LifecycleController] Token budget exceeded after action execution: ${String(totalTokens)} > ${String(config.budgetMaxTokens)}`,
          );
          this.interruptedActionResults = actionResults;
          await this.enterWaitingForHuman({
            waitingContext: {
              reason: 'token_budget_exceeded',
              requiredInput: 'approval',
              requestingState: this.currentState,
              autoResumeSafe: false,
              presentedArtifacts: [],
              waitingSince: new Date().toISOString(),
              budgetExhaustion: {
                limitType: 'token',
                current: totalTokens,
                limit: config.budgetMaxTokens,
                cumulativeTokens: totalTokens,
              },
            },
            trigger: 'escalation',
            reason: 'token_budget_exceeded',
            governanceOpts: { governanceRequired: true, governanceOutcome: 'escalated' },
            releaseLock: true,
          });
          break;
        }
      }

      const trigger = await this.reviewInterpreter.interpret(
        actionResults,
        this.currentState,
        stateDefinition.type,
      );

      if (trigger === 'human_input') {
        const sessionResult = actionResults.find((r) => r.sessionOutcome === 'awaiting_human');
        if (sessionResult?.sessionRef) {
          await this.enterWaitingForHuman({
            waitingContext: {
              reason: 'live_session_awaiting_human',
              requiredInput:
                sessionResult.pendingRequest?.kind === 'clarification' ? 'text' : 'approval',
              requestingState: this.currentState,
              autoResumeSafe: false,
              presentedArtifacts: [],
              waitingSince: new Date().toISOString(),
              liveSessionId: sessionResult.sessionRef.sessionId,
              pendingRequestId: sessionResult.pendingRequest?.requestId,
              liveRequestType: sessionResult.pendingRequest?.kind,
              sessionTransport: sessionResult.sessionRef.transport,
            },
            trigger: 'human_input',
            reason: 'live_session_awaiting_human',
            sessionId: sessionResult.sessionRef.sessionId,
            releaseLock: true,
          });
          break;
        }
      }

      const artifactRefs = actionResults.flatMap((r) => {
        if (r.artifactRefs && r.artifactRefs.length > 0) {
          return [...r.artifactRefs];
        }
        return r.artifactRef ? [r.artifactRef] : [];
      });

      let allArtifactRefs = artifactRefs;
      try {
        const inv = await this.artifactStore.inventory();
        if (inv.artifacts.length > 0) {
          const inventoryRefs = inv.artifacts.map((a) => a.ref);
          const seen = new Set(inventoryRefs.map((r) => `${r.type}:${r.name}`));
          allArtifactRefs = [
            ...inventoryRefs,
            ...artifactRefs.filter((r) => !seen.has(`${r.type}:${r.name}`)),
          ];
        }
      } catch (err: unknown) {
        this.logger.debug(
          `[LifecycleController] Inventory read failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (this.contextUpdater && config.repoRoot) {
        const codebaseRef = artifactRefs.find((r) => r.type === 'codebase_context');
        if (codebaseRef) {
          await this.persistCodebaseContext(codebaseRef, config.repoRoot).catch((err: unknown) => {
            this.logger.debug(
              `[LifecycleController] Failed to persist codebase context: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      }

      const context = {
        runId: this.runId,
        currentIteration: this.stateHistory.visitCount(this.currentState),
        stateHistory: [...this.stateHistory.getHistory()],
        artifactRefs: allArtifactRefs,
        tokenUsage: {
          inputTokens: this.cumulativeInputTokens,
          outputTokens: this.cumulativeOutputTokens,
          totalTokens: this.cumulativeInputTokens + this.cumulativeOutputTokens,
        },
        repoRoot: config.repoRoot,
      };

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: abort() may fire during await
      if (this.aborted) {
        break;
      }

      if (this.shutdownCoordinator?.isShutdownRequested()) {
        await this.abort(`shutdown:${this.shutdownCoordinator.getShutdownReason()}`);
        break;
      }

      const evaluated = await this.evaluator.evaluate(stateDefinition, trigger, context);
      this.governanceDecisionCount += 1;

      if (!evaluated) {
        const noTransitionMsg = `No transition matched trigger '${trigger}' from state ${this.currentState}`;
        this.journalWriter.append({
          timestamp: new Date().toISOString(),
          runId: this.runId,
          sequence: 0,
          type: 'error',
          data: {
            kind: 'error',
            errorCode: 'no_matching_transition',
            message: noTransitionMsg,
            stateId: this.currentState,
            recoverable: false,
          },
        });
        this.publishError(noTransitionMsg);
        break;
      }

      if (evaluated.governanceDecision === 'escalated') {
        this.escalationCount += 1;
      }

      if (stateDefinition.exitActions) {
        await this.dispatcher.executeAll(
          stateDefinition.exitActions,
          this.runId,
          this.currentState,
        );
      }

      if (evaluated.governanceDecision === 'escalated') {
        const dispatchAction = stateDefinition.entryActions?.find(
          (a): a is Extract<Action, { type: 'dispatch_worker' }> => a.type === 'dispatch_worker',
        );
        const roleId = dispatchAction?.params.role;
        const currentModel = roleId ? this.workerModelByRole[roleId] : undefined;
        const nextTier = roleId && this.roleRegistry ? this.roleRegistry.getNextTier(roleId) : null;

        if (this.contextUpdater && this.lastConfidenceScore !== null && roleId) {
          this.contextUpdater
            .recordModelEscalation({
              roleId,
              fromModel: currentModel ?? 'unknown',
              toModel: nextTier?.model ?? 'human',
              confidenceScore: this.lastConfidenceScore,
            })
            .catch((err: unknown) => {
              this.logger.debug(
                `[LifecycleController] Failed to record model escalation: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }

        if (nextTier && dispatchAction) {
          this.logger.info(
            `[LifecycleController] Model escalation: ${currentModel ?? 'default'} → ${nextTier.model} for role "${String(roleId)}"`,
          );
          const escalatedAction: Action = {
            type: 'dispatch_worker',
            params: {
              ...dispatchAction.params,
              stateId: this.currentState,
            },
          };
          const reDispatchResults = await this.dispatcher.executeAll(
            [escalatedAction],
            this.runId,
            this.currentState,
            { model: nextTier },
          );
          this.accumulateUsage(reDispatchResults);
          const confidenceReport = extractConfidenceReport(reDispatchResults);
          if (confidenceReport) {
            this.lastConfidenceScore = confidenceReport.score;
            this.guardChecker.setLastConfidenceReport(confidenceReport);
          }
          continue;
        }

        const escalationContract = this.contractRegistry.getContractForState(this.currentState);
        await this.enterWaitingForHuman({
          waitingContext: {
            reason: 'governance_escalation',
            requiredInput: 'approval',
            requestingState: this.currentState,
            autoResumeSafe: false,
            presentedArtifacts: artifactRefs,
            waitingSince: new Date().toISOString(),
          },
          trigger: 'escalation',
          reason: 'governance_escalation',
          governanceOpts: {
            governanceRequired: true,
            governanceOutcome: 'escalated',
            contractId: escalationContract?.id,
          },
          recordIteration: true,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- state may not be a valid key
          stateType: definition.states['WAITING_FOR_HUMAN']?.type,
        });
        break;
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during evaluator await
      if (this.aborted) {
        break;
      }

      this.recordStateExit();
      this.previousState = this.currentState;
      this.currentState = evaluated.definition.target;
      this.stateEnteredAt = new Date().toISOString();
      this.transitionCount += 1;
      this.stateHistory.record(this.currentState);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      this.recordIterationEntry(this.currentState, definition.states[this.currentState]?.type);
      await this.saveCheckpoint();

      if (evaluated.governanceDecision) {
        const transitionContract = this.contractRegistry.getContractForState(this.previousState);
        this.recordTransition(this.previousState, this.currentState, trigger, {
          governanceRequired: true,
          governanceOutcome: evaluated.governanceDecision,
          contractId: transitionContract?.id,
        });
      } else {
        this.recordTransition(this.previousState, this.currentState, trigger);
      }

      this.lastTrigger = trigger;
      const stateLabel = (state: string | null) => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- state may not be a valid key
        return definition.states[state ?? '']?.label ?? state ?? 'Unknown';
      };

      const stateRoleLabel = (state: string | null): string => {
        const def = definition.states[state ?? ''];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- def may be undefined at runtime
        const dispatchAction = def?.entryActions?.find(
          (a): a is Extract<Action, { type: 'dispatch_worker' }> => a.type === 'dispatch_worker',
        );
        const roleId = dispatchAction?.params.role;
        if (roleId) {
          return roleId
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        }
        return stateLabel(state);
      };

      const isTerminalTransition = definition.terminalStates.includes(this.currentState);

      if (this.isRejectionTrigger(trigger)) {
        this.lastReviewContent = await this.resolveReviewContent(artifactRefs);

        if (!isTerminalTransition) {
          this.agentStreamBus?.publish({
            runId: this.runId,
            stateId: this.currentState,
            roleId: 'orchestrator',
            dispatchId: `rejection-${String(Date.now())}`,
            timestamp: new Date().toISOString(),
            type: 'status',
            content: `${stateRoleLabel(this.previousState)} did not approve — moving to ${stateLabel(this.currentState)}.`,
            structuredData: {
              action: 'review_rejection',
              fromState: this.previousState,
              toState: this.currentState,
              trigger,
            },
          });
        }
      } else {
        this.lastReviewContent = await this.resolveUnapprovedReviewReport(artifactRefs);

        if (this.isApprovalTrigger(trigger) && this.previousState && !isTerminalTransition) {
          this.agentStreamBus?.publish({
            runId: this.runId,
            stateId: this.currentState,
            roleId: 'orchestrator',
            dispatchId: `approval-${String(Date.now())}`,
            timestamp: new Date().toISOString(),
            type: 'status',
            content: `${stateRoleLabel(this.previousState)} approved — moving to ${stateLabel(this.currentState)}.`,
            structuredData: {
              action: 'review_approval',
              fromState: this.previousState,
              toState: this.currentState,
              trigger,
            },
          });
        }
      }
    }

    if (definition.terminalStates.includes(this.currentState)) {
      const stateDefinition = definition.states[this.currentState];
      if (stateDefinition.entryActions) {
        const terminalResults = await this.dispatcher.executeAll(
          stateDefinition.entryActions,
          this.runId,
          this.currentState,
        );
        this.accumulateUsage(terminalResults);
      }
      await this.saveCheckpoint();
      this.releaseLockIfHeld();
    }

    this.recordStateExit();

    const iterationSummaries = this.contractRegistry.listContracts().map((c) => {
      const s = this.contractRegistry.getIterationState(c.id);
      return {
        contractId: c.id,
        totalIterations: s.currentIteration,
        judgeArbitrations: s.judgeArbitrations,
        finalStatus: s.status,
        findingsTotal: s.findingsTotal,
        findingsResolved: s.findingsResolved,
      };
    });

    const { refs: artifactRefs, summaries: artifactSummaries } =
      await this.collectArtifactInventory();

    const manifest = this.manifestProducer.produce({
      runId: this.runId,
      config: {
        startedAt: new Date(this.startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        governanceDecisions: this.governanceDecisionCount,
        escalations: this.escalationCount,
        iterations: iterationSummaries,
        stateTimestamps: this.stateTimestamps,
        repoRoot: this.config?.repoRoot,
      },
      stateHistory: [...this.stateHistory.getHistory()],
      artifactInventory: artifactRefs,
      artifactSummaries: artifactSummaries,
      journalPath: this.config?.runDir ? join(this.config.runDir, 'journal.jsonl') : '',
      workerMetrics: { ...this.workerMetricsByRole },
      workflowName: this.config?.workflowDefinition.name,
      workflowVersion: this.config?.workflowDefinition.version,
      reportPath: this.config?.runDir ? join(this.config.runDir, 'report.md') : undefined,
    });

    if (this.manifestWriter) {
      this.manifestWriter.write(this.runId, manifest);
    }

    if (this.config?.runDir) {
      this.writeReportTo(join(this.config.runDir, 'report.md'), manifest);
    }
    if (this.config?.reportOutputPath) {
      this.writeReportTo(this.config.reportOutputPath, manifest);
    }

    if (definition.terminalStates.includes(this.currentState) && this.contextUpdater) {
      const outcome = this.mapTerminalStateToOutcome(this.currentState);
      await this.contextUpdater
        .recordRunOutcome({
          runId: this.runId,
          workflowVariant: config.workflowDefinition.name,
          taskSummary: config.sources[0] ?? '',
          outcome,
          ...(this.lastConfidenceScore !== null
            ? { confidenceScore: this.lastConfidenceScore }
            : {}),
        })
        .catch((err: unknown) => {
          this.logger.debug(
            `[LifecycleController] Failed to record run outcome: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

      const workerOutcomes = Object.entries(this.workerMetricsByRole).map(([role, metrics]) => {
        const failures = this.workerFailuresByRole[role] as { error: string }[] | undefined;
        return {
          role,
          success: !failures?.length,
          error: failures?.at(0)?.error,
          dispatches: metrics.dispatches,
          model: this.workerModelByRole[role],
        };
      });
      await this.contextUpdater
        .recordWorkerOutcomes(workerOutcomes, this.runId)
        .catch((err: unknown) => {
          this.logger.debug(
            `[LifecycleController] Failed to record worker outcomes: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

      if (this.executionAnalytics) {
        const analyticsOutcomes = Object.entries(this.workerMetricsByRole).map(
          ([role, metrics]) => {
            const failures = this.workerFailuresByRole[role] as
              { error: string; model?: string }[] | undefined;
            return {
              roleId: role,
              model: this.workerModelByRole[role] ?? '',
              inputTokens: metrics.inputTokens,
              outputTokens: metrics.outputTokens,
              durationMs: metrics.durationMs,
              retryCount: failures?.length ?? 0,
              status: failures?.length ? ('failure' as const) : ('success' as const),
              errorType: null,
              confidenceScore: this.lastConfidenceScore,
            };
          },
        );
        await this.executionAnalytics.recordOutcomes(analyticsOutcomes).catch((err: unknown) => {
          this.logger.debug(
            `[LifecycleController] Failed to record execution analytics: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    }

    if (definition.terminalStates.includes(this.currentState)) {
      const workflowName = this.config?.workflowDefinition.name ?? 'unknown';
      const isFailed = this.currentState === 'FAILED';
      const isAborted = this.currentState === 'ABORTED';
      const action = isFailed ? 'failed' : isAborted ? 'aborted' : 'completed';
      const content = isFailed
        ? `Workflow '${workflowName}' failed.`
        : isAborted
          ? `Workflow '${workflowName}' was aborted.`
          : `Workflow '${workflowName}' completed successfully.`;
      this.agentStreamBus?.publish({
        runId: this.runId,
        stateId: this.currentState,
        roleId: 'orchestrator',
        dispatchId: `completion-${String(Date.now())}`,
        timestamp: new Date().toISOString(),
        type: 'status',
        content,
        structuredData: { action },
      });
    }

    return {
      runId: this.runId,
      finalState: this.currentState,
      artifactInventory: artifactRefs,
      manifest,
    };
  }

  private async persistCodebaseContext(ref: ArtifactRef, repoRoot: string): Promise<void> {
    if (!this.contextUpdater) {
      return;
    }
    const artifact = await this.artifactStore.get(ref);
    const content = artifact.content as unknown as Record<string, unknown>;
    await this.contextUpdater.updateCodebaseContext({
      runId: this.runId,
      projectName: basename(repoRoot),
      projectStructure:
        typeof content['projectStructure'] === 'string' ? content['projectStructure'] : undefined,
      conventions: Array.isArray(content['conventions'])
        ? (content['conventions'] as string[])
        : undefined,
      existingPatterns: Array.isArray(content['existingPatterns'])
        ? (content['existingPatterns'] as string[])
        : undefined,
      techStack: Array.isArray(content['techStack'])
        ? (content['techStack'] as string[])
        : undefined,
    });
  }

  private recordIterationEntry(stateId: string, stateType?: string): void {
    this.contractRegistry.recordStateEntry(stateId, stateType);
  }

  private recordTransition(
    from: string,
    to: string,
    trigger: TransitionTrigger,
    governanceOpts?: {
      governanceRequired: boolean;
      governanceOutcome?: GovernanceOutcome;
      contractId?: string;
    },
  ): void {
    const durationMs = this.stateEnteredAt
      ? Date.now() - new Date(this.stateEnteredAt).getTime()
      : 0;
    const targetContract = this.contractRegistry.getContractForState(to);
    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: 0,
      type: 'state_transition',
      data: {
        kind: 'state_transition',
        from,
        to,
        trigger,
        durationMs,
        guardsEvaluated: 0,
        guardsPassed: 0,
        governanceRequired: governanceOpts?.governanceRequired ?? false,
        governanceOutcome: governanceOpts?.governanceOutcome,
        contractId: governanceOpts?.contractId ?? targetContract?.id,
      },
    });
  }

  private recordStateExit(): void {
    if (this.currentState && this.stateEnteredAt) {
      this.stateTimestamps.push({
        stateId: this.currentState,
        enteredAt: this.stateEnteredAt,
        exitedAt: new Date().toISOString(),
      });
    }
  }

  private async enterWaitingForHuman(opts: {
    waitingContext: PersistedWaitingContext;
    trigger: TransitionTrigger;
    reason: string;
    governanceOpts?: {
      governanceRequired: boolean;
      governanceOutcome?: GovernanceOutcome;
      contractId?: string;
    };
    sessionId?: string;
    recordIteration?: boolean;
    stateType?: string;
    releaseLock?: boolean;
  }): Promise<void> {
    this.recordStateExit();
    this.previousState = this.currentState;
    this.currentState = 'WAITING_FOR_HUMAN';
    this.stateEnteredAt = new Date().toISOString();
    this.transitionCount += 1;
    this.stateHistory.record(this.currentState);

    if (opts.recordIteration) {
      this.recordIterationEntry(this.currentState, opts.stateType);
    }

    this.waitingContext = opts.waitingContext;

    this.recordTransition(this.previousState, this.currentState, opts.trigger, opts.governanceOpts);

    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: 0,
      type: 'human_input_requested',
      data: {
        kind: 'human',
        action: 'input_requested',
        stateId: this.currentState,
        reason: opts.reason,
        ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      },
    });

    await this.saveCheckpoint();
    if (opts.releaseLock) {
      this.releaseLockIfHeld();
    }
  }

  private async collectArtifactInventory(): Promise<{
    refs: ArtifactRef[];
    summaries: { ref: ArtifactRef; producedBy: string; createdAt: string; sizeBytes: number }[];
  }> {
    try {
      const inv = await this.artifactStore.inventory();
      return {
        refs: inv.artifacts.map((a) => a.ref),
        summaries: inv.artifacts.map((a) => ({
          ref: a.ref,
          producedBy: a.producedBy,
          createdAt: a.createdAt,
          sizeBytes: a.sizeBytes,
        })),
      };
    } catch (err: unknown) {
      this.logger.debug(
        `[LifecycleController] Inventory collection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { refs: [], summaries: [] };
    }
  }

  private async saveCheckpoint(): Promise<void> {
    const state: PersistedState = {
      runId: this.runId,
      schemaVersion: 2,
      repoRoot: this.config?.repoRoot,
      currentState: this.currentState,
      previousState: this.previousState,
      stateEnteredAt: this.stateEnteredAt,
      transitionCount: this.transitionCount,
      stateHistory: [...this.stateHistory.getHistory()],
      iterationCounts: Object.fromEntries(
        this.contractRegistry.listContracts().map((c) => {
          const state = this.contractRegistry.getIterationState(c.id);
          return [c.id, state.currentIteration];
        }),
      ),
      judgeArbitrationCounts: Object.fromEntries(
        this.contractRegistry.listContracts().map((c) => {
          const state = this.contractRegistry.getIterationState(c.id);
          return [c.id, state.judgeArbitrations];
        }),
      ),
      activeArtifacts: [],
      lastProducedArtifact: null,
      lastHumanFeedback: this.lastHumanFeedback ?? undefined,
      lastReviewContent: this.lastReviewContent ?? undefined,
      lastTrigger: this.lastTrigger ?? undefined,
      waitingContext: this.waitingContext ?? undefined,
      workflowName: this.config?.workflowDefinition.name ?? 'default',
      workflowVersion: this.config?.workflowDefinition.version ?? '1.0.0',
      persistedAt: new Date().toISOString(),
      persistenceVersion: 1,
      checksum: '',
      cumulativeInputTokens: this.cumulativeInputTokens,
      cumulativeOutputTokens: this.cumulativeOutputTokens,
      dispatchCounter: this.dispatcher.getDispatchCounter(),
      firedThresholdIndex: this.firedThresholdIndex,
      hasReceivedUsage: this.hasReceivedUsage,
      governanceDecisionCount: this.governanceDecisionCount,
      escalationCount: this.escalationCount,
      workerMetricsByRole: Object.fromEntries(
        Object.entries(this.workerMetricsByRole).map(([k, v]) => [k, { ...v }]),
      ),
      stateTimestamps: this.stateTimestamps.map((e) => ({ ...e })),
    };
    await this.statePersistence.save(state);
    await this.writeInterimManifest();
  }

  private async writeInterimManifest(): Promise<void> {
    if (!this.manifestWriter) {
      return;
    }
    try {
      const { refs, summaries } = await this.collectArtifactInventory();
      const manifest = this.manifestProducer.produce({
        runId: this.runId,
        config: {
          startedAt: new Date(this.startedAt).toISOString(),
          completedAt: new Date().toISOString(),
          governanceDecisions: this.governanceDecisionCount,
          escalations: this.escalationCount,
          iterations: [],
          stateTimestamps: this.stateTimestamps,
          repoRoot: this.config?.repoRoot,
        },
        stateHistory: [...this.stateHistory.getHistory()],
        artifactInventory: refs,
        artifactSummaries: summaries,
        journalPath: this.config?.runDir ? join(this.config.runDir, 'journal.jsonl') : '',
        workerMetrics: { ...this.workerMetricsByRole },
        workflowName: this.config?.workflowDefinition.name,
        workflowVersion: this.config?.workflowDefinition.version,
      });
      this.manifestWriter.write(this.runId, {
        ...manifest,
        status: 'running',
        timing: { ...manifest.timing, completedAt: '' },
      });
    } catch (err: unknown) {
      this.logger.debug(
        `[LifecycleController] Interim manifest write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private accumulateUsage(actionResults: readonly ActionResult[]): void {
    for (const result of actionResults) {
      if (result.workerResults) {
        for (const wr of result.workerResults) {
          if (wr.role && wr.model) {
            this.workerModelByRole[wr.role] = wr.model;
          }
          if (!wr.success && wr.error && wr.role) {
            const role = wr.role;
            const failures = (this.workerFailuresByRole[role] ??= []);
            failures.push({ error: wr.error, model: wr.model });
          }
        }
      }

      if (!result.usageSnapshot) {
        continue;
      }
      const snap = result.usageSnapshot;
      this.cumulativeInputTokens += snap.totalInputTokens;
      this.cumulativeOutputTokens += snap.totalOutputTokens;
      this.hasReceivedUsage = true;
      for (const [role, usage] of Object.entries(snap.byRole)) {
        const existing = this.workerMetricsByRole[role] as
          (typeof this.workerMetricsByRole)[string] | undefined;
        if (existing) {
          existing.inputTokens += usage.inputTokens;
          existing.outputTokens += usage.outputTokens;
          existing.dispatches += 1;
          existing.durationMs += usage.durationMs;
        } else {
          this.workerMetricsByRole[role] = {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            dispatches: 1,
            durationMs: usage.durationMs,
            artifactsProduced: 0,
          };
        }
      }
    }
  }

  private checkAlertThresholds(): void {
    const config = this.config;
    if (!config?.budgetMaxTokens || !config.budgetAlertThresholds?.length) {
      return;
    }
    const totalTokens = this.cumulativeInputTokens + this.cumulativeOutputTokens;
    const ratio = totalTokens / config.budgetMaxTokens;
    const sorted = [...config.budgetAlertThresholds].sort((a, b) => a - b);
    for (let i = this.firedThresholdIndex + 1; i < sorted.length; i++) {
      if (ratio >= sorted[i]) {
        this.firedThresholdIndex = i;
        const pct = Math.round(sorted[i] * 100);
        this.logger.warn(
          `[LifecycleController] Budget alert: ${String(pct)}% threshold reached (${String(totalTokens)}/${String(config.budgetMaxTokens)} tokens used)`,
        );
      } else {
        break;
      }
    }
  }

  private writeReportTo(reportPath: string, manifest: RunManifest): void {
    try {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, renderReport(manifest), 'utf8');
    } catch (err: unknown) {
      this.logger.debug(
        `[LifecycleController] Report write failed for ${reportPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleDeadSession(
    ctx: PersistedWaitingContext,
    error?: string,
  ): Promise<RunResult> {
    const reason = error ?? `Session ${ctx.liveSessionId ?? 'unknown'} is no longer reachable`;

    this.recordStateExit();
    this.previousState = this.currentState;
    this.currentState = 'FAILED';
    this.stateEnteredAt = new Date().toISOString();
    this.transitionCount += 1;
    this.stateHistory.record(this.currentState);
    this.waitingContext = null;

    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: 0,
      type: 'error',
      data: {
        kind: 'error',
        errorCode: 'dead_session',
        message: reason,
        stateId: this.currentState,
        recoverable: false,
      },
    });

    this.agentStreamBus?.publish({
      runId: this.runId,
      stateId: this.currentState,
      roleId: 'orchestrator',
      dispatchId: `failure-${String(Date.now())}`,
      timestamp: new Date().toISOString(),
      type: 'status',
      content: `Workflow '${this.config?.workflowDefinition.name ?? 'unknown'}' failed: ${reason}`,
      structuredData: { action: 'failed' },
    });

    await this.saveCheckpoint();
    this.releaseLockIfHeld();

    return {
      runId: this.runId,
      finalState: this.currentState,
      artifactInventory: [],
      manifest: this.buildEarlyManifest(),
    };
  }

  private buildEarlyManifest(): RunManifest {
    return this.manifestProducer.produce({
      runId: this.runId,
      config: {
        startedAt: new Date(this.startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        governanceDecisions: this.governanceDecisionCount,
        escalations: this.escalationCount,
        iterations: [],
        stateTimestamps: this.stateTimestamps,
        repoRoot: this.config?.repoRoot,
      },
      stateHistory: [...this.stateHistory.getHistory()],
      artifactInventory: [],
      artifactSummaries: [],
      journalPath: this.config?.runDir ? join(this.config.runDir, 'journal.jsonl') : '',
      workerMetrics: { ...this.workerMetricsByRole },
      workflowName: this.config?.workflowDefinition.name,
      workflowVersion: this.config?.workflowDefinition.version,
    });
  }

  private publishError(message: string): void {
    this.agentStreamBus?.publish({
      runId: this.runId,
      stateId: this.currentState,
      roleId: 'orchestrator',
      dispatchId: `error-${String(Date.now())}`,
      timestamp: new Date().toISOString(),
      type: 'status',
      content: message,
      structuredData: { action: 'error', error: message },
    });
  }

  private journalRunLoopError(error: unknown): void {
    const message = getErrorMessage(error);
    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: 0,
      type: 'error',
      data: {
        kind: 'error',
        errorCode: 'run_loop_error',
        message,
        stateId: this.currentState,
        recoverable: false,
      },
    });
    this.publishError(message);
  }

  private releaseLockIfHeld(): void {
    if (this.lockHandle) {
      this.statePersistence.releaseLock(this.lockHandle);
      this.lockHandle = null;
    }
  }

  private isRejectionTrigger(trigger: TransitionTrigger): boolean {
    return trigger === 'review_rejected' || trigger === 'judge_rejected' || trigger === 'failure';
  }

  private isApprovalTrigger(trigger: TransitionTrigger): boolean {
    return trigger === 'review_approved' || trigger === 'judge_approved';
  }

  private async resolveReviewContent(artifactRefs: readonly ArtifactRef[]): Promise<string | null> {
    const reviewTypes = new Set([
      ...REVIEW_ARTIFACT_TYPES,
      'judge_decision',
      'verification',
    ] as const);
    const reviewRefs = artifactRefs.filter((r) => reviewTypes.has(r.type));
    if (reviewRefs.length === 0) {
      return null;
    }
    const contents: string[] = [];
    for (const ref of reviewRefs) {
      try {
        const artifact = await this.artifactStore.get(ref);
        contents.push(artifact.content);
      } catch (err: unknown) {
        this.logger.debug(
          `[LifecycleController] Failed to resolve review artifact ${ref.type}/${ref.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return contents.length > 0 ? contents.join('\n---\n') : null;
  }

  /**
   * When a non-rejection transition produces a review_report with approved=false
   * (e.g. REVIEW_SYNTHESIS → IMPLEMENTATION), preserve its content so the next
   * worker receives it as previousFindings.
   */
  private async resolveUnapprovedReviewReport(
    artifactRefs: readonly ArtifactRef[],
  ): Promise<string | null> {
    const reportRef = artifactRefs.find((r) => r.type === 'review_report');
    if (!reportRef) {
      return null;
    }
    try {
      const artifact = await this.artifactStore.get(reportRef);
      const parsed: unknown = JSON.parse(artifact.content);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'approved' in parsed &&
        parsed.approved === false
      ) {
        return artifact.content;
      }
    } catch (err: unknown) {
      this.logger.debug(
        `[LifecycleController] Failed to parse review report: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }

  private mapTerminalStateToOutcome(
    state: string,
  ): 'completed' | 'failed' | 'aborted' | 'escalated' {
    if (state === 'ABORTED') {
      return 'aborted';
    }
    if (state === 'FAILED') {
      return 'failed';
    }
    if (state === 'WAITING_FOR_HUMAN') {
      return 'escalated';
    }
    return 'completed';
  }

  private buildConfigVariables(config: WorkflowRunConfig): Record<string, string> {
    const vars: Record<string, string> = {};
    if (config.repoRoot) {
      vars['repoRoot'] = config.repoRoot;
    }
    return vars;
  }
}

export function applyScriptDirectives(
  actionResults: readonly ActionResult[],
): ScriptDirectives | undefined {
  let directives: ScriptDirectives | undefined;
  for (const result of actionResults) {
    const d = result.scriptResult?.output?.directives;
    if (d && Object.keys(d).length > 0) {
      directives = d;
    }
  }
  return directives;
}
