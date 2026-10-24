import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { REVIEW_ARTIFACT_TYPES } from '@ai-dev-orchestrator/artifacts';
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
} from '@ai-dev-orchestrator/ports';
import { createRunId, noopLogger } from '@ai-dev-orchestrator/ports';
import type { ShutdownCoordinator } from '@ai-dev-orchestrator/recovery';
import { renderReport } from '@ai-dev-orchestrator/run-manifest';
import type {
  Action,
  ActionResult,
  ArtifactRef,
  EngineState,
  EntryActionContinuation,
  GovernanceOutcome,
  HumanInput,
  LockHandle,
  PersistedState,
  PersistedWaitingContext,
  RunId,
  RunManifest,
  RunResult,
  ScriptDirectives,
  TransitionTrigger,
  WaitingContext,
  WorkflowRunConfig,
} from '@ai-dev-orchestrator/schemas';
import { getErrorMessage } from '@ai-dev-orchestrator/utils';

import {
  MaxTransitionsExceededError,
  ActionExecutionError,
  TransitionError,
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

  private abortCompletion: Promise<void> | null = null;
  private executionActive = false;
  private activeExecution: Promise<RunResult> | null = null;
  private pendingTerminalState: string | null = null;
  private terminalRecoveryState: string | null = null;
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
  private executionPaused = false;
  private interruptedActionResults: readonly ActionResult[] | null = null;
  private entryActionContinuation: EntryActionContinuation | null = null;

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
      (stateId) =>
        (!this.aborted ||
          (stateId === this.currentState &&
            this.config?.workflowDefinition.terminalStates.includes(stateId) === true)) &&
        !this.executionPaused &&
        (this.aborted || !this.isDeadlineExceeded()),
    );
    this.reviewInterpreter = new ReviewResultInterpreter(
      opts.artifactStore,
      opts.contractRegistry,
      this.logger,
    );
  }

  /** Hydrate engine state from a persisted checkpoint so that resume() can proceed. */
  restore(config: WorkflowRunConfig, state: PersistedState): void {
    if (this.executionActive || this.abortCompletion) {
      throw new Error('Cannot restore while workflow execution is active');
    }
    this.resetRunState();
    config = { ...config, repoRoot: state.repoRoot ?? config.repoRoot };
    this.pendingTerminalState = state.pendingTerminalState ?? null;
    this.terminalRecoveryState =
      state.terminalRecoveryState ?? (this.pendingTerminalState ? state.currentState : null);
    this.config = config;
    this.runId = createRunId(config.runId);
    this.currentState = state.currentState;
    this.previousState = state.previousState;
    this.stateEnteredAt = state.stateEnteredAt;
    this.transitionCount = state.transitionCount;
    this.stateHistory = new StateHistory(state.stateHistory);
    this.waitingContext = state.waitingContext ?? null;
    this.budgetApproved = state.budgetApproved ?? false;
    this.executionPaused = state.executionPaused ?? false;
    this.interruptedActionResults = state.interruptedActionResults ?? null;
    this.entryActionContinuation = state.entryActionContinuation ?? null;
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
    return this.runExclusive(() => this.startRun(config));
  }

  private async startRun(config: WorkflowRunConfig): Promise<RunResult> {
    this.resetRunState();
    this.config = config;
    this.runId = createRunId(config.runId);
    this.currentState = config.workflowDefinition.initialState;
    this.budgetApproved = false;
    this.executionPaused = false;
    this.aborted = false;
    this.stateEnteredAt = new Date().toISOString();
    this.transitionCount = 0;
    this.stateHistory = new StateHistory();
    this.stateHistory.record(this.currentState);
    this.stateTimestamps = [];
    this.prepareTerminalActions();

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
      throw error;
    } finally {
      this.releaseLockIfHeld();
    }
  }

  /** @inheritdoc */
  async pause(context: WaitingContext): Promise<void> {
    this.executionPaused = true;
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
    if (this.activeExecution && this.executionPaused) {
      await this.activeExecution;
    }
    return this.runExclusive(() => this.resumeWithLock(input));
  }

  private async resumeWithLock(input: HumanInput): Promise<RunResult> {
    const savedWaitingContext = this.waitingContext;
    try {
      return await this.resumeRun(input);
    } catch (error: unknown) {
      if (
        (this.currentState === 'WAITING_FOR_HUMAN' ||
          this.config?.workflowDefinition.states[this.currentState]?.type === 'wait') &&
        !this.waitingContext
      ) {
        this.waitingContext = savedWaitingContext;
      }
      if (this.config && this.lockHandle) {
        await this.saveCheckpoint().catch(() => undefined);
      }
      throw error;
    } finally {
      this.releaseLockIfHeld();
    }
  }

  private async resumeRun(input: HumanInput): Promise<RunResult> {
    if (!this.config) {
      throw new Error('No active run to resume');
    }
    const pendingHumanTransition = this.entryActionContinuation;
    const originalWait = pendingHumanTransition?.resumeWaitingContext;
    const isOriginalGate =
      this.waitingContext?.reason === originalWait?.reason &&
      this.waitingContext?.requestingState === originalWait?.requestingState;
    if (
      pendingHumanTransition?.resumeInput &&
      pendingHumanTransition.stateId === this.currentState &&
      (!this.waitingContext || isOriginalGate) &&
      !this.executionPaused
    ) {
      input = pendingHumanTransition.resumeInput;
      this.waitingContext = pendingHumanTransition.resumeWaitingContext ?? null;
    }
    const savedWaitingContext = this.waitingContext;
    this.waitingContext = null;

    if (this.executionPaused && savedWaitingContext) {
      if (!this.lockHandle) {
        this.lockHandle = this.statePersistence.acquireLock(this.runId);
      }
      this.executionPaused = false;
      if (input.type === 'rejection') {
        await this.abort('Paused run rejected by human');
        return {
          runId: this.runId,
          finalState: this.currentState,
          artifactInventory: [],
          manifest: this.buildEarlyManifest(),
        };
      }
      const fromState = this.currentState;
      this.previousState = fromState;
      this.currentState = savedWaitingContext.requestingState;
      this.stateEnteredAt = new Date().toISOString();
      this.transitionCount += 1;
      this.stateHistory.record(this.currentState);
      this.recordTransition(fromState, this.currentState, 'human_approved');
      await this.saveCheckpoint();
      return this.runLoop(
        this.config,
        this.config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT,
      );
    }

    if (
      savedWaitingContext?.reason === 'live_session_awaiting_human' &&
      !savedWaitingContext.liveSessionId
    ) {
      throw new Error(
        'Cannot resume live session: checkpoint or journal is missing session identity',
      );
    }
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

      if (this.aborted) {
        return this.interruptedResult();
      }

      if (!handle) {
        const snapshot = await this.sessionSupervisor.getSnapshot(sessionId);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during session I/O
        if (this.aborted) {
          return this.interruptedResult();
        }
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

      const requestId =
        savedWaitingContext.pendingRequestId ?? handle.pendingRequests[0]?.requestId;
      if (requestId) {
        await this.sessionSupervisor.sendHumanResponse(sessionId, requestId, responsePayload);
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during session I/O
      if (this.aborted) {
        return this.interruptedResult();
      }
      const advance = await this.sessionSupervisor.waitForAdvance(sessionId);

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during session I/O
      if (this.aborted) {
        return {
          runId: this.runId,
          finalState: this.currentState,
          artifactInventory: [],
          manifest: this.buildEarlyManifest(),
        };
      }

      if (advance.kind === 'completed') {
        this.recordStateExit();
        this.previousState = this.currentState;
        this.currentState = savedWaitingContext.requestingState;
        this.stateEnteredAt = new Date().toISOString();
        this.transitionCount += 1;
        this.stateHistory.record(this.currentState);

        this.recordTransition(this.previousState, this.currentState, 'human_approved');
        const roleId = handle.ref.role;
        const sessionAction: Action = { type: 'dispatch_worker', params: { role: roleId } };
        const outputType = this.roleRegistry?.getRole(roleId)?.ownedArtifacts[0];
        let sessionActionResult: ActionResult;
        try {
          if (!outputType) {
            throw new Error(`No output artifact contract configured for session role '${roleId}'`);
          }
          if (!advance.artifactContent) {
            throw new Error(`Session for role '${roleId}' completed without output`);
          }
          const artifactRef = await this.artifactStore.store({
            type: outputType,
            name: `${roleId}-output`,
            content: advance.artifactContent,
            producedBy: roleId,
            runId: this.runId,
          });
          sessionActionResult = { action: sessionAction, success: true, artifactRef };
        } catch (error: unknown) {
          sessionActionResult = {
            action: sessionAction,
            success: false,
            error: getErrorMessage(error),
          };
        }
        if (advance.tokenUsage) {
          sessionActionResult = {
            ...sessionActionResult,
            usageSnapshot: {
              totalInputTokens: advance.tokenUsage.inputTokens,
              totalOutputTokens: advance.tokenUsage.outputTokens,
              byRole: {
                [roleId]: { ...advance.tokenUsage, durationMs: advance.durationMs },
              },
            },
          };
        }

        this.accumulateUsage([sessionActionResult]);
        const continuation = this.entryActionContinuation ?? {
          stateId: this.currentState,
          completedResults: [],
          nextActionIndex:
            (this.config.workflowDefinition.states[this.currentState].entryActions?.findIndex(
              (action) => action.type === 'dispatch_worker' && action.params.role === roleId,
            ) ?? -1) + 1,
        };
        const isExitSession =
          continuation.completedExitResults?.some(
            (result) => result.sessionRef?.sessionId === sessionId,
          ) ?? false;
        const sourceResults = isExitSession
          ? (continuation.completedExitResults ?? [])
          : continuation.completedResults;
        const pendingIndex = sourceResults.findIndex(
          (result) => result.sessionRef?.sessionId === sessionId,
        );
        const completedResults = await Promise.all(
          sourceResults.map(async (result, index) =>
            index === pendingIndex
              ? this.completeSessionAction(result, sessionId, sessionActionResult)
              : result,
          ),
        );
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire while storing a dynamic aggregate
        if (this.aborted) {
          return this.interruptedResult();
        }
        if (pendingIndex < 0) {
          completedResults.push(sessionActionResult);
        }
        this.entryActionContinuation = {
          ...continuation,
          ...(isExitSession ? { completedExitResults: completedResults } : { completedResults }),
        };
        this.journalWriter.append({
          timestamp: new Date().toISOString(),
          runId: this.runId,
          sequence: 0,
          type: sessionActionResult.success ? 'worker_completed' : 'worker_failed',
          data: {
            kind: 'worker',
            workerId: sessionId,
            role: roleId,
            stateId: this.currentState,
            status: sessionActionResult.success ? 'success' : 'failed',
            inputTokens: advance.tokenUsage?.inputTokens,
            outputTokens: advance.tokenUsage?.outputTokens,
            durationMs: advance.durationMs,
            error: sessionActionResult.error,
            entryActionContinuation: structuredClone(this.entryActionContinuation),
            outputArtifacts: sessionActionResult.artifactRef
              ? [sessionActionResult.artifactRef]
              : [],
          },
        });
        if (await this.pauseForSession(completedResults, this.entryActionContinuation)) {
          return this.interruptedResult();
        }
        await this.saveCheckpoint();
        const transitionLimit = this.config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT;
        try {
          return await this.runLoop(this.config, transitionLimit);
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

    if (input.type === 'rejection' && savedWaitingContext?.reason === 'token_budget_exceeded') {
      if (!this.lockHandle) {
        this.lockHandle = this.statePersistence.acquireLock(this.runId);
      }
      this.interruptedActionResults = null;
      this.entryActionContinuation = null;
      await this.abort('Token budget extension rejected by human');
      return {
        runId: this.runId,
        finalState: this.currentState,
        artifactInventory: [],
        manifest: this.buildEarlyManifest(),
      };
    }

    if ((input.type === 'rejection' || input.type === 'text') && input.content) {
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
      const requestingState = savedWaitingContext.requestingState;
      const hasRequestingState = Object.prototype.hasOwnProperty.call(
        this.config.workflowDefinition.states,
        requestingState,
      );
      if (!hasRequestingState) {
        throw new Error(
          `Cannot resume budget escalation: invalid requesting state '${requestingState}'`,
        );
      }

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
          reason: savedWaitingContext.reason,
          inputType: 'approval',
          ...(input.content ? { message: input.content } : {}),
        },
      });

      const targetState = requestingState;
      this.recordStateExit();
      const fromState = this.currentState;
      this.previousState = this.currentState;
      this.currentState = targetState;
      this.stateEnteredAt = new Date().toISOString();
      this.transitionCount += 1;
      this.stateHistory.record(this.currentState);
      this.recordTransition(fromState, this.currentState, 'human_approved', undefined, {
        guardsEvaluated: 1,
        guardsPassed: 1,
      });

      this.logger.info(
        `[LifecycleController] Budget escalation approved — resuming state '${targetState}'`,
      );

      this.budgetApproved = true;
      const savedResults = this.interruptedActionResults ?? undefined;
      this.interruptedActionResults = null;
      if (savedResults) {
        this.entryActionContinuation = {
          ...this.entryActionContinuation,
          stateId: this.currentState,
          completedResults: savedResults,
          nextActionIndex: savedResults.length,
        };
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

    if (stateDefinition.type === 'review') {
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during asynchronous guard evaluation
      if (this.aborted) {
        return {
          runId: this.runId,
          finalState: this.currentState,
          artifactInventory: [],
          manifest: this.buildEarlyManifest(),
        };
      }
      if (evaluated?.governanceDecision === 'escalated') {
        this.escalationCount += 1;
        await this.enterWaitingForHuman({
          waitingContext: {
            reason: 'governance_escalation',
            requiredInput: 'approval',
            requestingState: savedWaitingContext?.requestingState ?? this.currentState,
            autoResumeSafe: false,
            presentedArtifacts: savedWaitingContext?.presentedArtifacts ?? [],
            waitingSince: new Date().toISOString(),
          },
          trigger: 'escalation',
          reason: 'governance_escalation',
          governanceOpts: { governanceRequired: true, governanceOutcome: 'escalated' },
        });
        return {
          runId: this.runId,
          finalState: this.currentState,
          artifactInventory: [],
          manifest: this.buildEarlyManifest(),
        };
      }
      if (evaluated) {
        const continuation =
          this.entryActionContinuation?.stateId === this.currentState
            ? this.entryActionContinuation
            : null;
        const exitResults = [...(continuation?.completedExitResults ?? [])];
        const exitContext: EntryActionContinuation = {
          stateId: this.currentState,
          completedResults: continuation?.completedResults ?? [],
          nextActionIndex: stateDefinition.entryActions?.length ?? 0,
          completedExitResults: exitResults,
          resumeInput: input,
          resumeWaitingContext: savedWaitingContext ?? undefined,
        };
        this.entryActionContinuation = exitContext;
        for (const action of (stateDefinition.exitActions ?? []).slice(exitResults.length)) {
          if (exitResults.some((result) => !result.success)) {
            break;
          }
          const results = await this.dispatcher.executeAll([action], this.runId, this.currentState);
          exitResults.push(...results);
          this.accumulateUsage(results);
          this.entryActionContinuation = { ...exitContext, completedExitResults: [...exitResults] };
          await this.saveCheckpoint();
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during exit actions or checkpoint I/O
          if (this.aborted) {
            return this.interruptedResult();
          }
          if (
            (await this.pauseForSession(exitResults, this.entryActionContinuation)) ||
            (await this.pauseForBudget(exitContext.completedResults, this.entryActionContinuation))
          ) {
            return this.interruptedResult();
          }
          if (this.executionPaused) {
            return this.interruptedResult();
          }
          this.checkDeadline();
        }
        if (exitResults.some((result) => !result.success)) {
          this.entryActionContinuation = null;
          await this.failActions('exit', exitResults);
          return this.runLoop(
            this.config,
            this.config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT,
          );
        }
        this.entryActionContinuation = null;
        this.recordStateExit();
        const fromState = this.currentState;
        this.previousState = this.currentState;
        this.currentState = evaluated.definition.target;
        this.prepareTerminalActions();
        this.stateEnteredAt = new Date().toISOString();
        this.transitionCount += 1;
        this.stateHistory.record(this.currentState);
        this.recordIterationEntry(this.currentState, definition.states[this.currentState].type);

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
            iterationCounts: this.contractCounts('currentIteration'),
            judgeArbitrationCounts: this.contractCounts('judgeArbitrations'),
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
    return this.runExclusive(() => this.retryRun());
  }

  private async retryRun(): Promise<RunResult> {
    if (!this.config) {
      throw new Error('No active run to retry — call restore() first');
    }

    const definition = this.config.workflowDefinition;
    if (this.waitingContext) {
      throw new Error('Cannot retry a waiting run — use resume()');
    }
    let retryState: string | undefined;
    if (definition.terminalStates.includes(this.currentState) && !this.pendingTerminalState) {
      if (this.currentState !== 'FAILED' && this.currentState !== 'ABORTED') {
        throw new Error(`Cannot retry from terminal state '${this.currentState}'`);
      }
      const source = this.previousState;
      if (!source || !Object.hasOwn(definition.states, source)) {
        throw new Error(`Run has no previous workflow state to retry from`);
      }
      if (
        definition.terminalStates.includes(source) ||
        definition.states[source].type === 'terminal'
      ) {
        throw new Error(`Cannot retry from terminal state '${source}'`);
      }
      if (definition.states[source].type === 'wait') {
        throw new Error(`Cannot retry from waiting state '${source}' without human input`);
      }
      retryState = source;
    }

    this.dispatcher.setUserPrompt(this.config.sources[0]);
    this.dispatcher.setWorkflowMetadata(definition.name, definition.version);
    this.dispatcher.setConfigVariables(this.buildConfigVariables(this.config));
    this.dispatcher.setRepoRoot(this.config.repoRoot ?? '');
    this.dispatcher.setRunDir(this.config.runDir ?? '');

    this.lockHandle = this.statePersistence.acquireLock(this.runId);

    try {
      this.aborted = false;
      this.startedAt = Date.now();
      if (retryState) {
        this.previousState = this.currentState;
        this.currentState = retryState;
        this.stateEnteredAt = new Date().toISOString();
        this.transitionCount += 1;
        this.stateHistory.record(retryState);
        this.entryActionContinuation = null;
        this.interruptedActionResults = null;
        // Make the retry target durable before executing its actions. Pending terminal
        // cleanup uses its existing cursor and never enters this rewind path.
        await this.saveCheckpoint();
      }
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
      return await this.runLoop(this.config, transitionLimit);
    } catch (error: unknown) {
      this.journalRunLoopError(error);
      throw error;
    } finally {
      this.releaseLockIfHeld();
    }
  }

  /** @inheritdoc */
  async abort(reason: string): Promise<void> {
    if (this.abortCompletion) {
      return this.abortCompletion;
    }
    const completion = this.abortRun(reason);
    this.abortCompletion = completion;
    try {
      await completion;
    } finally {
      this.abortCompletion = null;
    }
  }

  private async abortRun(reason: string): Promise<void> {
    if (this.aborted || this.currentState === 'ABORTED') {
      return;
    }
    this.aborted = true;
    this.executionPaused = false;
    this.pendingTerminalState = null;
    this.terminalRecoveryState = null;

    this.recordStateExit();
    const fromState = this.currentState;
    this.previousState = this.currentState;
    this.currentState = 'ABORTED';
    this.prepareTerminalActions();
    this.stateEnteredAt = new Date().toISOString();
    this.stateHistory.record('ABORTED');
    this.transitionCount += 1;
    this.waitingContext = null;
    this.entryActionContinuation = null;
    this.interruptedActionResults = null;
    const cancellation = this.runner.cancelAllWorkers().catch(() => undefined);

    try {
      if (!this.lockHandle && this.config) {
        this.lockHandle = this.statePersistence.acquireLock(this.runId);
      }
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
    } finally {
      await cancellation;
      if (!this.executionActive) {
        try {
          if (this.lockHandle) {
            await this.finishPendingAbort();
          }
        } finally {
          this.releaseLockIfHeld();
        }
      }
    }
  }

  /** @inheritdoc */
  getState(): EngineState {
    const isWaiting = this.waitingContext !== null;
    return {
      runId: this.runId,
      currentState: this.aborted ? this.currentState : this.checkpointState(),
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
    const humanContinuation = this.entryActionContinuation;
    if (
      humanContinuation?.resumeInput &&
      humanContinuation.stateId === this.currentState &&
      !this.aborted
    ) {
      this.waitingContext = humanContinuation.resumeWaitingContext ?? null;
      return this.resumeRun(humanContinuation.resumeInput);
    }
    if (this.pendingTerminalState && !this.executionPaused && !this.waitingContext) {
      this.currentState = this.pendingTerminalState;
    }
    const escalatedModels = new Map<string, string>();
    const attemptedEscalations = new Set<string>();
    let replayDispatchContext: Pick<
      EntryActionContinuation,
      'humanFeedback' | 'previousReviewContent' | 'iterationCount'
    > = {};

    this.shutdownCoordinator?.onShutdown(() => {
      this.runner.cancelAllWorkers().catch(() => undefined);
    });

    while (
      !definition.terminalStates.includes(this.currentState) &&
      !this.aborted &&
      !this.executionPaused
    ) {
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

      this.checkDeadline();

      const actionState = this.currentState;
      const stateDefinition = definition.states[actionState];

      if (!initialActionResults && (await this.pauseForBudget())) {
        break;
      }

      if (stateDefinition.type === 'wait' && !initialActionResults) {
        let waitActionResults: readonly ActionResult[] = [];
        const continuation =
          this.entryActionContinuation?.stateId === actionState
            ? this.entryActionContinuation
            : null;
        const waitRequestingState =
          continuation?.waitRequestingState ?? this.previousState ?? actionState;
        if (stateDefinition.entryActions) {
          this.entryActionContinuation = null;
          const newResults = continuation?.completedResults.some(
            (result) => !result.success || result.sessionOutcome === 'awaiting_human',
          )
            ? []
            : await this.dispatcher.executeAll(
                stateDefinition.entryActions.slice(continuation?.nextActionIndex ?? 0),
                this.runId,
                actionState,
              );
          this.accumulateUsage(newResults);
          waitActionResults = [...(continuation?.completedResults ?? []), ...newResults];
        }

        if (
          (await this.pauseForSession(waitActionResults, { waitRequestingState })) ||
          (await this.pauseForBudget(waitActionResults, { waitRequestingState }))
        ) {
          break;
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

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- pause() may fire during wait actions or inventory reads
        if (this.executionPaused) {
          this.entryActionContinuation = {
            stateId: actionState,
            waitRequestingState,
            completedResults: waitActionResults,
            nextActionIndex: waitActionResults.length,
          };
          await this.saveCheckpoint();
          this.releaseLockIfHeld();
          break;
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during wait actions or inventory reads
        if (this.aborted) {
          break;
        }
        this.checkDeadline();
        if (waitActionResults.some((result) => !result.success)) {
          this.journalWriter.append({
            timestamp: new Date().toISOString(),
            runId: this.runId,
            sequence: 0,
            type: 'error',
            data: {
              kind: 'error',
              errorCode: 'wait_action_failed',
              message: waitActionResults
                .filter((result) => !result.success)
                .map((result) => result.error ?? 'Wait action failed')
                .join('; '),
              stateId: actionState,
              recoverable: false,
            },
          });
          initialActionResults = waitActionResults;
          skipInitialUsageAccumulation = true;
          continue;
        }
        const requestingState = waitRequestingState;
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

      let completedExitResults: readonly ActionResult[] = [];
      let actionResults: readonly ActionResult[] = [];
      let dispatchContext: Pick<
        EntryActionContinuation,
        'humanFeedback' | 'previousReviewContent' | 'iterationCount'
      > = {};
      const saveManualPause = async (): Promise<boolean> => {
        if (!this.executionPaused) {
          return false;
        }
        this.entryActionContinuation = {
          ...dispatchContext,
          stateId: actionState,
          completedResults: actionResults,
          nextActionIndex: actionResults.length,
          completedExitResults,
        };
        await this.saveCheckpoint();
        this.releaseLockIfHeld();
        return true;
      };
      if (initialActionResults) {
        dispatchContext = replayDispatchContext;
        actionResults = initialActionResults;
        initialActionResults = undefined;
        if (!skipInitialUsageAccumulation) {
          this.accumulateUsage(actionResults);
        }
        skipInitialUsageAccumulation = false;
        this.checkAlertThresholds();
      } else if (this.entryActionContinuation?.stateId === this.currentState) {
        const continuation = this.entryActionContinuation;
        this.entryActionContinuation = null;
        dispatchContext = {
          humanFeedback: continuation.humanFeedback,
          previousReviewContent: continuation.previousReviewContent,
          iterationCount: continuation.iterationCount,
        };
        completedExitResults = continuation.completedExitResults ?? [];
        const remainingResults = continuation.completedResults.some(
          (result) => !result.success || result.sessionOutcome === 'awaiting_human',
        )
          ? []
          : await this.dispatcher.executeAll(
              (stateDefinition.entryActions ?? []).slice(continuation.nextActionIndex),
              this.runId,
              this.currentState,
              undefined,
              continuation.humanFeedback,
              continuation.previousReviewContent,
              continuation.iterationCount,
            );
        this.accumulateUsage(remainingResults);
        actionResults = [...continuation.completedResults, ...remainingResults];
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
        dispatchContext = {
          humanFeedback: feedback,
          previousReviewContent: reviewContent,
          iterationCount: iterCount,
        };
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

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during action dispatch
      if (this.aborted) {
        break;
      }

      if (await saveManualPause()) {
        break;
      }
      this.checkDeadline();

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

      if (await this.pauseForBudget(actionResults, dispatchContext)) {
        break;
      }

      const trigger = await this.reviewInterpreter.interpret(
        actionResults,
        this.currentState,
        stateDefinition.type,
      );

      if (await saveManualPause()) {
        break;
      }
      this.checkDeadline();

      if (
        trigger === 'human_input' &&
        (await this.pauseForSession(actionResults, dispatchContext))
      ) {
        break;
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during guard evaluation
      if (this.aborted) {
        break;
      }
      if (await saveManualPause()) {
        break;
      }
      this.checkDeadline();
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
        const failureState = ['FAILED', 'ABORTED'].find((state) =>
          definition.terminalStates.includes(state),
        );
        if (failureState) {
          this.recordStateExit();
          const fromState = this.currentState;
          this.previousState = fromState;
          this.currentState = failureState;
          this.prepareTerminalActions();
          this.stateEnteredAt = new Date().toISOString();
          this.transitionCount += 1;
          this.stateHistory.record(this.currentState);
          this.recordTransition(fromState, this.currentState, 'failure');
          await this.saveCheckpoint();
          break;
        }
        await this.saveCheckpoint();
        throw new TransitionError(this.currentState, '', noTransitionMsg);
      }

      if (evaluated.governanceDecision === 'escalated') {
        this.escalationCount += 1;
      }

      if (evaluated.governanceDecision === 'escalated') {
        const dispatchAction = stateDefinition.entryActions?.find(
          (a): a is Extract<Action, { type: 'dispatch_worker' }> => a.type === 'dispatch_worker',
        );
        const roleId = dispatchAction?.params.role;
        const escalationKey = `${String(this.transitionCount)}:${this.currentState}:${roleId ?? ''}`;
        const currentModel =
          escalatedModels.get(escalationKey) ??
          (roleId ? this.workerModelByRole[roleId] : undefined);
        const nextTier =
          roleId && this.roleRegistry ? this.roleRegistry.getNextTier(roleId, currentModel) : null;
        const attemptKey = `${escalationKey}:${nextTier?.model ?? ''}`;

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

        if (nextTier && dispatchAction && !attemptedEscalations.has(attemptKey)) {
          attemptedEscalations.add(attemptKey);
          escalatedModels.set(escalationKey, nextTier.model);
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
            dispatchContext.humanFeedback,
            dispatchContext.previousReviewContent,
            dispatchContext.iterationCount,
          );
          this.accumulateUsage(reDispatchResults);
          const dispatchIndex = stateDefinition.entryActions?.indexOf(dispatchAction) ?? 0;
          const tailResults = reDispatchResults.every(
            (result) => result.success && result.sessionOutcome !== 'awaiting_human',
          )
            ? await this.dispatcher.executeAll(
                (stateDefinition.entryActions ?? []).slice(dispatchIndex + 1),
                this.runId,
                this.currentState,
                undefined,
                dispatchContext.humanFeedback,
                dispatchContext.previousReviewContent,
                dispatchContext.iterationCount,
              )
            : [];
          this.accumulateUsage(tailResults);
          const confidenceReport = extractConfidenceReport(reDispatchResults);
          if (confidenceReport) {
            this.lastConfidenceScore = confidenceReport.score;
            this.guardChecker.setLastConfidenceReport(confidenceReport);
          }
          initialActionResults = [
            ...actionResults.slice(0, dispatchIndex),
            ...reDispatchResults,
            ...tailResults,
          ];
          replayDispatchContext = dispatchContext;
          actionResults = initialActionResults;
          if (await saveManualPause()) {
            break;
          }
          this.checkDeadline();
          skipInitialUsageAccumulation = true;
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

      if (stateDefinition.exitActions) {
        const exitResults = completedExitResults.some(
          (result) => !result.success || result.sessionOutcome === 'awaiting_human',
        )
          ? []
          : await this.dispatcher.executeAll(
              stateDefinition.exitActions.slice(completedExitResults.length),
              this.runId,
              this.currentState,
            );
        this.accumulateUsage(exitResults);
        completedExitResults = [...completedExitResults, ...exitResults];
        const exitContext = {
          ...dispatchContext,
          completedResults: actionResults,
          nextActionIndex: actionResults.length,
          completedExitResults,
        };
        if (
          (await this.pauseForSession(completedExitResults, exitContext)) ||
          (await this.pauseForBudget(actionResults, exitContext))
        ) {
          break;
        }

        if (await saveManualPause()) {
          break;
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during exit actions
        if (this.aborted) {
          break;
        }
        this.checkDeadline();
        if (completedExitResults.some((result) => !result.success)) {
          await this.failActions('exit', completedExitResults);
          continue;
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort() may fire during exit actions
      if (this.aborted) {
        break;
      }

      this.recordStateExit();
      this.previousState = this.currentState;
      this.currentState = evaluated.definition.target;
      this.prepareTerminalActions();
      this.stateEnteredAt = new Date().toISOString();
      this.transitionCount += 1;
      this.stateHistory.record(this.currentState);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      this.recordIterationEntry(this.currentState, definition.states[this.currentState]?.type);
      this.lastTrigger = trigger;
      this.lastReviewContent = this.isRejectionTrigger(trigger)
        ? await this.resolveReviewContent(artifactRefs)
        : await this.resolveUnapprovedReviewReport(artifactRefs);
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

    const attemptedTerminals = new Set<string>();
    while (definition.terminalStates.includes(this.currentState)) {
      attemptedTerminals.add(this.currentState);
      const stateDefinition = definition.states[this.currentState];
      if (stateDefinition.entryActions) {
        const terminalState = this.currentState;
        const continuation =
          this.entryActionContinuation?.stateId === terminalState
            ? this.entryActionContinuation
            : null;
        const terminalResults = [...(continuation?.completedResults ?? [])];
        this.entryActionContinuation = {
          stateId: terminalState,
          completedResults: terminalResults,
          nextActionIndex: terminalResults.length,
        };
        await this.saveCheckpoint();
        if (await this.pauseForSession(terminalResults)) {
          break;
        }
        if (!terminalResults.some((result) => !result.success)) {
          for (const action of stateDefinition.entryActions.slice(
            continuation?.nextActionIndex ?? 0,
          )) {
            const newResults = await this.dispatcher.executeAll(
              [action],
              this.runId,
              terminalState,
            );
            this.accumulateUsage(newResults);
            terminalResults.push(...newResults);
            this.entryActionContinuation = {
              stateId: terminalState,
              completedResults: [...terminalResults],
              nextActionIndex: terminalResults.length,
            };
            await this.saveCheckpoint();
            if (
              (await this.pauseForSession(terminalResults)) ||
              (await this.pauseForBudget(terminalResults))
            ) {
              break;
            }
            if (
              this.executionPaused ||
              (this.aborted && this.currentState !== terminalState) ||
              newResults.some((result) => !result.success) ||
              (!this.aborted && this.isDeadlineExceeded())
            ) {
              break;
            }
          }
        }
        if (
          !this.executionPaused &&
          this.currentState === 'WAITING_FOR_HUMAN' &&
          this.waitingContext
        ) {
          break;
        }
        if (this.executionPaused) {
          this.entryActionContinuation = {
            stateId: terminalState,
            completedResults: terminalResults,
            nextActionIndex: terminalResults.length,
          };
          await this.saveCheckpoint();
          this.releaseLockIfHeld();
          break;
        }
        if (this.aborted && this.currentState !== terminalState) {
          continue;
        }
        this.checkDeadline();
        if (terminalResults.some((result) => !result.success)) {
          await this.failActions('terminal', terminalResults, attemptedTerminals);
          continue;
        }
      }
      this.pendingTerminalState = null;
      this.terminalRecoveryState = null;
      this.entryActionContinuation = null;
      this.journalWriter.append({
        timestamp: new Date().toISOString(),
        runId: this.runId,
        sequence: 0,
        type:
          this.currentState === 'FAILED'
            ? 'run_failed'
            : this.currentState === 'ABORTED'
              ? 'run_aborted'
              : 'run_completed',
        data: {
          kind: 'run_lifecycle',
          workflowName: definition.name,
          workflowVersion: definition.version,
          finalState: this.currentState,
        },
      });
      await this.saveCheckpoint();
      this.releaseLockIfHeld();
      break;
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

  private contractCounts(
    counter: 'currentIteration' | 'judgeArbitrations',
  ): Record<string, number> {
    return Object.fromEntries(
      this.contractRegistry
        .listContracts()
        .map((contract) => [
          contract.id,
          this.contractRegistry.getIterationState(contract.id)[counter],
        ]),
    );
  }

  private async completeSessionAction(
    result: ActionResult,
    sessionId: string,
    completion: ActionResult,
  ): Promise<ActionResult> {
    if (!result.workerResults) {
      return completion;
    }
    const workerResults = result.workerResults.map((worker) =>
      worker.sessionRef?.sessionId === sessionId
        ? {
            ...worker,
            success: completion.success,
            error: completion.error,
            artifactRef: completion.artifactRef,
            sessionOutcome: 'completed' as const,
            pendingRequest: undefined,
          }
        : worker,
    );
    const pending = workerResults.find((worker) => worker.sessionOutcome === 'awaiting_human');
    return this.dispatcher.finalizeDynamicResult({
      ...result,
      success: workerResults.some((worker) => worker.success),
      workerResults,
      artifactRefs: workerResults.flatMap((worker) =>
        worker.artifactRef ? [worker.artifactRef] : [],
      ),
      sessionOutcome: pending ? 'awaiting_human' : 'completed',
      sessionRef: pending?.sessionRef,
      pendingRequest: pending?.pendingRequest,
    });
  }

  private async failActions(
    phase: string,
    results: readonly ActionResult[],
    excludedStates: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const message = results
      .filter((result) => !result.success)
      .map((result) => result.error ?? `${result.action.type} failed`)
      .join('; ');
    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: 0,
      type: 'error',
      data: {
        kind: 'error',
        errorCode: `${phase}_action_failed`,
        message,
        stateId: this.currentState,
        recoverable: false,
      },
    });
    const target = ['FAILED', 'ABORTED'].find(
      (state) =>
        this.config?.workflowDefinition.terminalStates.includes(state) &&
        !excludedStates.has(state),
    );
    if (!target) {
      await this.saveCheckpoint();
      throw new ActionExecutionError(phase, message);
    }
    this.recordStateExit();
    const from = this.currentState;
    this.previousState = from;
    this.currentState = target;
    this.waitingContext = null;
    this.entryActionContinuation = null;
    this.prepareTerminalActions();
    this.stateEnteredAt = new Date().toISOString();
    this.transitionCount += 1;
    this.stateHistory.record(target);
    this.recordTransition(from, target, 'failure');
    await this.saveCheckpoint();
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
    validationOpts?: {
      guardsEvaluated: number;
      guardsPassed: number;
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
        transitionCount: this.transitionCount,
        from,
        to,
        trigger,
        durationMs,
        guardsEvaluated: validationOpts?.guardsEvaluated ?? 0,
        guardsPassed: validationOpts?.guardsPassed ?? 0,
        governanceRequired: governanceOpts?.governanceRequired ?? false,
        terminalActionsPending: this.pendingTerminalState === to || undefined,
        pendingTerminalState: this.pendingTerminalState ?? undefined,
        terminalRecoveryState: this.terminalRecoveryState ?? undefined,
        governanceOutcome: governanceOpts?.governanceOutcome,
        contractId: governanceOpts?.contractId ?? targetContract?.id,
        iterationCounts: Object.fromEntries(
          this.contractRegistry
            .listContracts()
            .map((contract) => [
              contract.id,
              this.contractRegistry.getIterationState(contract.id).currentIteration,
            ]),
        ),
        judgeArbitrationCounts: Object.fromEntries(
          this.contractRegistry
            .listContracts()
            .map((contract) => [
              contract.id,
              this.contractRegistry.getIterationState(contract.id).judgeArbitrations,
            ]),
        ),
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
  }): Promise<void> {
    if (this.currentState !== 'WAITING_FOR_HUMAN') {
      this.recordStateExit();
      this.previousState = this.currentState;
      this.currentState = 'WAITING_FOR_HUMAN';
      this.stateEnteredAt = new Date().toISOString();
      this.transitionCount += 1;
      this.stateHistory.record(this.currentState);
      this.recordTransition(
        this.previousState,
        this.currentState,
        opts.trigger,
        opts.governanceOpts,
      );
    }

    if (opts.recordIteration) {
      this.recordIterationEntry(this.currentState, opts.stateType);
    }

    this.waitingContext = opts.waitingContext;

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
    this.releaseLockIfHeld();
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
      currentState: this.checkpointState(),
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
      budgetApproved: this.budgetApproved,
      executionPaused: this.executionPaused,
      pendingTerminalState: this.pendingTerminalState ?? undefined,
      terminalRecoveryState: this.terminalRecoveryState ?? undefined,
      governanceDecisionCount: this.governanceDecisionCount,
      escalationCount: this.escalationCount,
      workerMetricsByRole: Object.fromEntries(
        Object.entries(this.workerMetricsByRole).map(([k, v]) => [k, { ...v }]),
      ),
      stateTimestamps: this.stateTimestamps.map((e) => ({ ...e })),
      interruptedActionResults: this.interruptedActionResults ?? undefined,
      entryActionContinuation: this.entryActionContinuation ?? undefined,
    };
    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: 0,
      type: 'workflow_checkpoint',
      data: { kind: 'workflow_checkpoint', state: structuredClone(state) },
    });
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
    this.waitingContext = null;
    this.recordStateExit();
    const from = this.currentState;
    this.previousState = from;
    this.currentState = ctx.requestingState;
    this.stateEnteredAt = new Date().toISOString();
    this.transitionCount += 1;
    this.stateHistory.record(this.currentState);
    this.recordTransition(from, this.currentState, 'failure');
    this.interruptedActionResults = null;
    const continuation = this.entryActionContinuation;
    if (
      continuation?.completedExitResults?.some(
        (result) => result.sessionRef?.sessionId === ctx.liveSessionId,
      )
    ) {
      this.entryActionContinuation = {
        ...continuation,
        completedExitResults: continuation.completedExitResults.map((result) =>
          result.sessionRef?.sessionId === ctx.liveSessionId
            ? { action: result.action, success: false, error: reason }
            : result,
        ),
      };
      await this.saveCheckpoint();
      if (!this.config) {
        throw new Error('No active run for dead session recovery');
      }
      return this.runLoop(
        this.config,
        this.config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT,
      );
    }
    const failedAction = this.entryActionContinuation?.completedResults.find(
      (result) => result.sessionRef?.sessionId === ctx.liveSessionId,
    )?.action ??
      this.config?.workflowDefinition.states[this.currentState].entryActions?.find(
        (action) =>
          action.type === 'dispatch_worker' || action.type === 'dispatch_parallel_workers',
      ) ?? { type: 'notify_human', params: { reason } };
    this.entryActionContinuation = {
      stateId: this.currentState,
      nextActionIndex:
        this.config?.workflowDefinition.states[this.currentState].entryActions?.length ?? 0,
      completedResults: [{ action: failedAction, success: false, error: reason }],
    };
    await this.saveCheckpoint();
    if (!this.config) {
      throw new Error('No active run for dead session recovery');
    }
    return this.runLoop(this.config, this.config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT);
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

  private async pauseForSession(
    results: readonly ActionResult[],
    context: Partial<EntryActionContinuation> = {},
  ): Promise<boolean> {
    if (this.aborted || this.executionPaused) {
      return false;
    }
    const session = results.find(
      (result) => result.sessionOutcome === 'awaiting_human' && result.sessionRef,
    );
    if (!session?.sessionRef) {
      return false;
    }
    this.entryActionContinuation = {
      ...this.entryActionContinuation,
      stateId: this.currentState,
      completedResults: results,
      nextActionIndex: results.length,
      ...context,
    };
    await this.enterWaitingForHuman({
      waitingContext: {
        reason: 'live_session_awaiting_human',
        requiredInput: session.pendingRequest?.kind === 'clarification' ? 'text' : 'approval',
        requestingState: this.currentState,
        autoResumeSafe: false,
        presentedArtifacts: [],
        waitingSince: new Date().toISOString(),
        liveSessionId: session.sessionRef.sessionId,
        pendingRequestId: session.pendingRequest?.requestId,
        liveRequestType: session.pendingRequest?.kind,
        sessionTransport: session.sessionRef.transport,
      },
      trigger: 'human_input',
      reason: 'live_session_awaiting_human',
      sessionId: session.sessionRef.sessionId,
    });
    return true;
  }

  private async pauseForBudget(
    results?: readonly ActionResult[],
    context: Partial<EntryActionContinuation> = {},
  ): Promise<boolean> {
    const limit = this.config?.budgetMaxTokens;
    const totalTokens = this.cumulativeInputTokens + this.cumulativeOutputTokens;
    if (
      this.aborted ||
      this.executionPaused ||
      this.budgetApproved ||
      limit == null ||
      totalTokens <= limit
    ) {
      return false;
    }
    if (results) {
      this.interruptedActionResults = results;
      this.entryActionContinuation = {
        ...this.entryActionContinuation,
        ...context,
        stateId: this.currentState,
        completedResults: results,
        nextActionIndex: results.length,
      };
    }
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
          limit,
          cumulativeTokens: totalTokens,
        },
      },
      trigger: 'escalation',
      reason: 'token_budget_exceeded',
      governanceOpts: { governanceRequired: true, governanceOutcome: 'escalated' },
    });
    return true;
  }

  private checkpointState(): string {
    return this.pendingTerminalState === this.currentState
      ? (this.terminalRecoveryState ?? this.currentState)
      : this.currentState;
  }

  private prepareTerminalActions(): void {
    if (
      this.config?.workflowDefinition.terminalStates.includes(this.currentState) &&
      this.config.workflowDefinition.states[this.currentState].entryActions?.length
    ) {
      this.pendingTerminalState = this.currentState;
      this.terminalRecoveryState ??= this.previousState ?? this.currentState;
    } else if (this.config?.workflowDefinition.terminalStates.includes(this.currentState)) {
      this.pendingTerminalState = null;
      this.terminalRecoveryState = null;
    }
  }

  private async settleAbort(): Promise<void> {
    if (this.abortCompletion) {
      await this.abortCompletion;
    }
  }

  private async finishPendingAbort(): Promise<RunResult | undefined> {
    if (this.pendingTerminalState === 'ABORTED' && this.currentState === 'ABORTED' && this.config) {
      if (!this.lockHandle) {
        this.lockHandle = this.statePersistence.acquireLock(this.runId);
      }
      return this.runLoop(
        this.config,
        this.config.globalTransitionLimit ?? DEFAULT_TRANSITION_LIMIT,
      );
    }
    return undefined;
  }

  private async runExclusive(operation: () => Promise<RunResult>): Promise<RunResult> {
    if (this.executionActive || this.abortCompletion) {
      throw new Error('Workflow execution is already active');
    }
    this.executionActive = true;
    this.activeExecution = this.executeOwned(operation);
    return this.activeExecution;
  }

  private async executeOwned(operation: () => Promise<RunResult>): Promise<RunResult> {
    try {
      const result = await operation();
      await this.settleAbort();
      return (await this.finishPendingAbort()) ?? result;
    } finally {
      this.releaseLockIfHeld();
      this.activeExecution = null;
      this.executionActive = false;
    }
  }

  private interruptedResult(): RunResult {
    return {
      runId: this.runId,
      finalState: this.currentState,
      artifactInventory: [],
      manifest: this.buildEarlyManifest(),
    };
  }

  private resetRunState(): void {
    this.previousState = null;
    this.waitingContext = null;
    this.cumulativeInputTokens = 0;
    this.cumulativeOutputTokens = 0;
    this.hasReceivedUsage = false;
    this.firedThresholdIndex = -1;
    this.lastHumanFeedback = null;
    this.lastReviewContent = null;
    this.lastTrigger = null;
    this.governanceDecisionCount = 0;
    this.escalationCount = 0;
    this.aborted = false;
    this.budgetApproved = false;
    this.executionPaused = false;
    this.interruptedActionResults = null;
    this.entryActionContinuation = null;
    this.pendingTerminalState = null;
    this.terminalRecoveryState = null;
    this.workerMetricsByRole = {};
    this.workerFailuresByRole = {};
    this.workerModelByRole = {};
    this.lastConfidenceScore = null;
    this.guardChecker.setLastConfidenceReport(null);
    this.dispatcher.setDispatchCounter(0);
    this.runner.setWorkerCounter(0);
    for (const contract of this.contractRegistry.listContracts()) {
      this.contractRegistry.resetIterationCount(contract.id);
    }
    this.contractRegistry.restoreJudgeArbitrationCounts(
      new Map(this.contractRegistry.listContracts().map((contract) => [contract.id, 0])),
    );
  }

  private isDeadlineExceeded(): boolean {
    return this.workflowTimeoutMs > 0 && Date.now() - this.startedAt > this.workflowTimeoutMs;
  }

  private checkDeadline(): void {
    if (this.isDeadlineExceeded() && !this.aborted && !this.executionPaused) {
      throw new WorkflowTimeoutError(this.currentState, this.workflowTimeoutMs);
    }
  }

  private journalRunLoopError(error: unknown): void {
    const message = getErrorMessage(error);
    try {
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
    } catch (journalError: unknown) {
      this.logger.warn(`Failed to journal run error: ${getErrorMessage(journalError)}`);
    }
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
