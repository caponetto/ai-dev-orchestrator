import type {
  ArtifactRef,
  EntryActionContinuation,
  JournalEvent,
  PersistedState,
  PersistedWaitingContext,
  RunId,
} from '@ai-dev-orchestrator/schemas';
import { ITERATION_STATE_MAPPING } from '@ai-dev-orchestrator/schemas';

import { computeStateChecksum } from './checksum-verifier';
import { SCHEMA_VERSION } from './schema-version';

export interface RebuildContext {
  currentState: string;
  previousState: string | null;
  stateEnteredAt: string;
  transitionCount: number;
  stateHistory: string[];
  iterationCounts: Record<string, number>;
  judgeArbitrationCounts: Record<string, number>;
  artifactMap: Map<string, ArtifactRef>;
  lastProducedArtifact: ArtifactRef | null;
  workflowName: string;
  workflowVersion: string;
  waitingContext: PersistedWaitingContext | undefined;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  hasReceivedUsage: boolean;
  budgetApproved?: boolean;
  pendingTerminalState?: string;
  terminalRecoveryState?: string;
  entryActionContinuation?: EntryActionContinuation;
  executionPaused?: boolean;
  workerMetricsByRole?: PersistedState['workerMetricsByRole'];
}

export function applyRunStarted(
  ctx: RebuildContext,
  event: JournalEvent & { type: 'run_started' },
): void {
  ctx.workflowName = event.data.workflowName;
  ctx.workflowVersion = event.data.workflowVersion;
}

export function applyStateTransition(
  ctx: RebuildContext,
  event: JournalEvent & { type: 'state_transition' },
): void {
  if (event.data.transitionCount != null && event.data.transitionCount <= ctx.transitionCount) {
    return;
  }
  ctx.previousState = event.data.from;
  if (event.data.pendingTerminalState || event.data.terminalActionsPending) {
    ctx.terminalRecoveryState =
      event.data.terminalRecoveryState ?? ctx.terminalRecoveryState ?? event.data.from;
    ctx.pendingTerminalState = event.data.pendingTerminalState ?? event.data.to;
    ctx.currentState =
      event.data.to === 'WAITING_FOR_HUMAN' ? event.data.to : ctx.terminalRecoveryState;
  } else {
    ctx.currentState = event.data.to;
    ctx.pendingTerminalState = undefined;
    ctx.terminalRecoveryState = undefined;
  }
  ctx.stateEnteredAt = event.timestamp;
  ctx.transitionCount++;
  if (ctx.stateHistory.at(-1) !== event.data.from) {
    ctx.stateHistory.push(event.data.from);
  }
  ctx.stateHistory.push(event.data.to);
  const entry = ITERATION_STATE_MAPPING[event.data.to];
  if (entry?.counter === 'iteration') {
    ctx.iterationCounts[entry.contractId] = (ctx.iterationCounts[entry.contractId] ?? 0) + 1;
  } else if (entry?.counter === 'judge') {
    const contractId = event.data.contractId ?? entry.contractId;
    ctx.judgeArbitrationCounts[contractId] = (ctx.judgeArbitrationCounts[contractId] ?? 0) + 1;
  }
  if (event.data.iterationCounts) {
    ctx.iterationCounts = { ...event.data.iterationCounts };
  }
  if (event.data.judgeArbitrationCounts) {
    ctx.judgeArbitrationCounts = { ...event.data.judgeArbitrationCounts };
  }
}

function applyWorkerUsage(
  ctx: RebuildContext,
  event: JournalEvent & { type: 'worker_completed' | 'worker_failed' },
): void {
  ctx.cumulativeInputTokens += event.data.inputTokens ?? 0;
  ctx.cumulativeOutputTokens += event.data.outputTokens ?? 0;
  ctx.hasReceivedUsage ||=
    event.data.inputTokens !== undefined || event.data.outputTokens !== undefined;
  if (event.data.entryActionContinuation) {
    ctx.entryActionContinuation = structuredClone(event.data.entryActionContinuation);
    ctx.waitingContext = undefined;
    if (
      event.data.role &&
      (event.data.inputTokens !== undefined || event.data.outputTokens !== undefined)
    ) {
      const role = event.data.role;
      const previous = ctx.workerMetricsByRole?.[role] ?? {
        inputTokens: 0,
        outputTokens: 0,
        dispatches: 0,
        durationMs: 0,
        artifactsProduced: 0,
      };
      ctx.workerMetricsByRole = {
        ...ctx.workerMetricsByRole,
        [role]: {
          ...previous,
          inputTokens: previous.inputTokens + (event.data.inputTokens ?? 0),
          outputTokens: previous.outputTokens + (event.data.outputTokens ?? 0),
          dispatches: previous.dispatches + 1,
          durationMs: previous.durationMs + (event.data.durationMs ?? 0),
        },
      };
    }
  }
}

export function applyArtifactStored(
  ctx: RebuildContext,
  event: JournalEvent & { type: 'artifact_stored' },
): void {
  const ref = event.data.artifactRef;
  ctx.artifactMap.set(ref.type, ref);
  ctx.lastProducedArtifact = ref;
}

export function applyFinding(
  ctx: RebuildContext,
  _event: JournalEvent & { type: 'finding_raised' | 'finding_resolved' },
): void {
  const contractKey = `review_loop`;
  ctx.iterationCounts[contractKey] = ctx.iterationCounts[contractKey] ?? 0;
}

export function applyHumanInputRequested(
  ctx: RebuildContext,
  event: JournalEvent & { type: 'human_input_requested' },
): void {
  const reason = event.data.reason ?? 'waiting_for_human';
  ctx.waitingContext = {
    reason,
    requiredInput: reason === 'clarification_needed' ? 'text' : 'approval',
    requestingState: ctx.previousState ?? ctx.currentState,
    autoResumeSafe:
      reason !== 'clarification_needed' &&
      reason !== 'governance_escalation' &&
      reason !== 'live_session_awaiting_human' &&
      reason !== 'token_budget_exceeded',
    presentedArtifacts: [],
    waitingSince: event.timestamp,
    ...(event.data.sessionId ? { liveSessionId: event.data.sessionId } : {}),
  };
}

export function applyHumanResponse(
  ctx: RebuildContext,
  event: JournalEvent & { type: 'human_approval' | 'human_rejection' | 'human_input_received' },
): void {
  if (event.type === 'human_input_received' && event.data.action === 'answer_checkpointed') {
    // The earlier accepted checkpoint owns wait/continuation state; this is diagnostic only.
    return;
  }
  if (
    event.type === 'human_input_received' &&
    event.data.action === 'session_resumed' &&
    ctx.waitingContext?.liveSessionId
  ) {
    return;
  }
  ctx.waitingContext = undefined;
  if (event.type === 'human_approval' && event.data.reason === 'token_budget_exceeded') {
    ctx.budgetApproved = true;
  }
  if (event.type === 'human_rejection') {
    ctx.iterationCounts = {};
  }
}

function applyRunFinished(
  ctx: RebuildContext,
  event: JournalEvent & { type: 'run_completed' | 'run_failed' | 'run_aborted' },
): void {
  if (event.data.finalState) {
    ctx.currentState = event.data.finalState;
    ctx.pendingTerminalState = undefined;
    ctx.terminalRecoveryState = undefined;
    ctx.entryActionContinuation = undefined;
    ctx.executionPaused = false;
  }
}

type EventHandler = (ctx: RebuildContext, event: JournalEvent) => void;

const eventHandlers: Partial<Record<string, EventHandler>> = {
  run_started: applyRunStarted as EventHandler,
  run_completed: applyRunFinished as EventHandler,
  run_failed: applyRunFinished as EventHandler,
  run_aborted: applyRunFinished as EventHandler,
  state_transition: applyStateTransition as EventHandler,
  artifact_stored: applyArtifactStored as EventHandler,
  finding_raised: applyFinding as EventHandler,
  finding_resolved: applyFinding as EventHandler,
  human_input_requested: applyHumanInputRequested as EventHandler,
  human_approval: applyHumanResponse as EventHandler,
  human_rejection: applyHumanResponse as EventHandler,
  human_input_received: applyHumanResponse as EventHandler,
  worker_completed: applyWorkerUsage as EventHandler,
  worker_failed: applyWorkerUsage as EventHandler,
};

/** Rebuild a PersistedState by replaying journal events in order. */
export function rebuildStateFromEvents(
  runId: RunId,
  events: readonly JournalEvent[],
): PersistedState {
  const ctx: RebuildContext = {
    currentState: 'INTAKE',
    previousState: null,
    stateEnteredAt: events.length > 0 ? events[0].timestamp : new Date().toISOString(),
    transitionCount: 0,
    stateHistory: [],
    iterationCounts: {},
    judgeArbitrationCounts: {},
    artifactMap: new Map<string, ArtifactRef>(),
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    waitingContext: undefined,
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    hasReceivedUsage: false,
  };

  let snapshot: PersistedState | undefined;
  for (const event of events) {
    if (event.type === 'workflow_checkpoint') {
      snapshot = structuredClone(event.data.state);
      Object.assign(ctx, snapshot, {
        stateHistory: [...snapshot.stateHistory],
        waitingContext: snapshot.waitingContext,
        entryActionContinuation: snapshot.entryActionContinuation,
        executionPaused: snapshot.executionPaused,
        budgetApproved: snapshot.budgetApproved,
        pendingTerminalState: snapshot.pendingTerminalState,
        terminalRecoveryState: snapshot.terminalRecoveryState,
        lastProducedArtifact: snapshot.lastProducedArtifact ?? ctx.lastProducedArtifact,
        iterationCounts: { ...snapshot.iterationCounts },
        judgeArbitrationCounts: { ...snapshot.judgeArbitrationCounts },
        cumulativeInputTokens: snapshot.cumulativeInputTokens ?? 0,
        cumulativeOutputTokens: snapshot.cumulativeOutputTokens ?? 0,
        hasReceivedUsage: snapshot.hasReceivedUsage ?? false,
        workerMetricsByRole: snapshot.workerMetricsByRole,
        artifactMap: new Map([
          ...ctx.artifactMap,
          ...snapshot.activeArtifacts.map((ref): [string, ArtifactRef] => [ref.type, ref]),
        ]),
      });
      continue;
    }
    const handler = eventHandlers[event.type];
    if (handler) {
      handler(ctx, event);
    }
  }

  if (ctx.stateHistory.length === 0) {
    ctx.stateHistory.push(ctx.currentState);
  }

  const now = events.at(-1)?.timestamp ?? new Date().toISOString();
  const state: PersistedState = {
    ...snapshot,
    runId,
    schemaVersion: SCHEMA_VERSION,
    currentState: ctx.currentState,
    previousState: ctx.previousState,
    stateEnteredAt: ctx.stateEnteredAt,
    transitionCount: ctx.transitionCount,
    stateHistory: ctx.stateHistory,
    iterationCounts: ctx.iterationCounts,
    judgeArbitrationCounts: ctx.judgeArbitrationCounts,
    activeArtifacts: [...ctx.artifactMap.values()],
    lastProducedArtifact: ctx.lastProducedArtifact,
    waitingContext: ctx.waitingContext,
    workflowName: ctx.workflowName,
    workflowVersion: ctx.workflowVersion,
    persistedAt: now,
    persistenceVersion: ctx.transitionCount,
    checksum: '',
    cumulativeInputTokens: ctx.cumulativeInputTokens,
    cumulativeOutputTokens: ctx.cumulativeOutputTokens,
    hasReceivedUsage: ctx.hasReceivedUsage,
    budgetApproved: ctx.budgetApproved,
    pendingTerminalState: ctx.pendingTerminalState,
    terminalRecoveryState: ctx.terminalRecoveryState,
    entryActionContinuation: ctx.entryActionContinuation,
    executionPaused: ctx.executionPaused,
    ...(ctx.workerMetricsByRole ? { workerMetricsByRole: ctx.workerMetricsByRole } : {}),
  };

  const checksum = computeStateChecksum(state);
  return { ...state, checksum };
}
