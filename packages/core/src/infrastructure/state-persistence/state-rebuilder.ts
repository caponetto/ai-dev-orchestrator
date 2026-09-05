import type {
  ArtifactRef,
  JournalEvent,
  PersistedState,
  PersistedWaitingContext,
  RunId,
} from '@ai-dev-orchestrator/schemas';

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
  ctx.previousState = event.data.from;
  ctx.currentState = event.data.to;
  ctx.stateEnteredAt = event.timestamp;
  ctx.transitionCount++;
  if (!ctx.stateHistory.includes(event.data.from)) {
    ctx.stateHistory.push(event.data.from);
  }
  if (!ctx.stateHistory.includes(event.data.to)) {
    ctx.stateHistory.push(event.data.to);
  }
  if (event.data.to === 'JUDGE_REVIEW' && event.data.contractId) {
    ctx.judgeArbitrationCounts[event.data.contractId] =
      (ctx.judgeArbitrationCounts[event.data.contractId] ?? 0) + 1;
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
    autoResumeSafe: reason !== 'clarification_needed' && reason !== 'governance_escalation',
    presentedArtifacts: [],
    waitingSince: event.timestamp,
  };
}

export function applyHumanResponse(
  ctx: RebuildContext,
  _event: JournalEvent & { type: 'human_approval' | 'human_rejection' | 'human_input_received' },
): void {
  ctx.waitingContext = undefined;
}

type EventHandler = (ctx: RebuildContext, event: JournalEvent) => void;

const eventHandlers: Partial<Record<string, EventHandler>> = {
  run_started: applyRunStarted as EventHandler,
  state_transition: applyStateTransition as EventHandler,
  artifact_stored: applyArtifactStored as EventHandler,
  finding_raised: applyFinding as EventHandler,
  finding_resolved: applyFinding as EventHandler,
  human_input_requested: applyHumanInputRequested as EventHandler,
  human_approval: applyHumanResponse as EventHandler,
  human_rejection: applyHumanResponse as EventHandler,
  human_input_received: applyHumanResponse as EventHandler,
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
  };

  for (const event of events) {
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
  };

  const checksum = computeStateChecksum(state);
  return { ...state, checksum };
}
