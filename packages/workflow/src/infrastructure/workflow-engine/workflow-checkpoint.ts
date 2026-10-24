import type {
  EntryActionContinuation,
  PersistedState,
  PersistedWaitingContext,
  RunId,
  WorkflowRunConfig,
} from '@ai-dev-orchestrator/schemas';

import type { ExecutionAccounting } from './execution-accounting';

interface WorkflowCheckpointInput {
  readonly runId: RunId;
  readonly config: WorkflowRunConfig | null;
  readonly progress: {
    readonly currentState: string;
    readonly previousState: string | null;
    readonly stateEnteredAt: string;
    readonly transitionCount: number;
    readonly stateHistory: readonly string[];
    readonly lastHumanFeedback: string | null;
    readonly lastReviewContent: string | null;
    readonly lastTrigger: string | null;
    readonly waitingContext: PersistedWaitingContext | null;
    readonly budgetApproved: boolean;
    readonly executionPaused: boolean;
    readonly pendingTerminalState: string | null;
    readonly terminalRecoveryState: string | null;
    readonly governanceDecisionCount: number;
    readonly escalationCount: number;
    readonly stateTimestamps: readonly { stateId: string; enteredAt: string; exitedAt: string }[];
    readonly interruptedActionResults: PersistedState['interruptedActionResults'] | null;
    readonly entryActionContinuation: EntryActionContinuation | null;
  };
  readonly accounting: Pick<
    ExecutionAccounting,
    | 'cumulativeInputTokens'
    | 'cumulativeOutputTokens'
    | 'firedThresholdIndex'
    | 'hasReceivedUsage'
    | 'workerMetricsByRole'
  >;
  readonly iterationCounts: Record<string, number>;
  readonly judgeArbitrationCounts: Record<string, number>;
  readonly dispatchCounter: number;
}

/** Serialize an execution snapshot without performing journal/checkpoint I/O. */
export function buildWorkflowCheckpoint(input: WorkflowCheckpointInput): PersistedState {
  return {
    runId: input.runId,
    schemaVersion: 2,
    repoRoot: input.config?.repoRoot,
    currentState: input.progress.currentState,
    previousState: input.progress.previousState,
    stateEnteredAt: input.progress.stateEnteredAt,
    transitionCount: input.progress.transitionCount,
    stateHistory: [...input.progress.stateHistory],
    iterationCounts: input.iterationCounts,
    judgeArbitrationCounts: input.judgeArbitrationCounts,
    activeArtifacts: [],
    lastProducedArtifact: null,
    lastHumanFeedback: input.progress.lastHumanFeedback ?? undefined,
    lastReviewContent: input.progress.lastReviewContent ?? undefined,
    lastTrigger: input.progress.lastTrigger ?? undefined,
    waitingContext: input.progress.waitingContext ?? undefined,
    workflowName: input.config?.workflowDefinition.name ?? 'default',
    workflowVersion: input.config?.workflowDefinition.version ?? '1.0.0',
    persistedAt: new Date().toISOString(),
    persistenceVersion: 1,
    checksum: '',
    cumulativeInputTokens: input.accounting.cumulativeInputTokens,
    cumulativeOutputTokens: input.accounting.cumulativeOutputTokens,
    dispatchCounter: input.dispatchCounter,
    firedThresholdIndex: input.accounting.firedThresholdIndex,
    hasReceivedUsage: input.accounting.hasReceivedUsage,
    budgetApproved: input.progress.budgetApproved,
    executionPaused: input.progress.executionPaused,
    pendingTerminalState: input.progress.pendingTerminalState ?? undefined,
    terminalRecoveryState: input.progress.terminalRecoveryState ?? undefined,
    governanceDecisionCount: input.progress.governanceDecisionCount,
    escalationCount: input.progress.escalationCount,
    workerMetricsByRole: Object.fromEntries(
      Object.entries(input.accounting.workerMetricsByRole).map(([k, v]) => [k, { ...v }]),
    ),
    stateTimestamps: input.progress.stateTimestamps.map((e) => ({ ...e })),
    interruptedActionResults: input.progress.interruptedActionResults ?? undefined,
    entryActionContinuation: input.progress.entryActionContinuation ?? undefined,
  };
}
