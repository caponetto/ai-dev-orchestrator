import { join } from 'node:path';

import { DefaultJournalReader, DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import type { StatePersistence } from '@ai-dev-orchestrator/ports';
import type { PersistedState } from '@ai-dev-orchestrator/schemas';

import { loadLatestRunState } from './run-state-recovery';
import { getJournalPath } from './workspace-paths';

export const TERMINAL_STATES = new Set(['DONE', 'ABORTED']);

export function buildAbortedState(state: PersistedState): PersistedState {
  return {
    ...state,
    currentState: 'ABORTED',
    pendingTerminalState: undefined,
    terminalRecoveryState: undefined,
    entryActionContinuation: undefined,
    interruptedActionResults: undefined,
    waitingContext: undefined,
    executionPaused: false,
    previousState: state.currentState,
    stateHistory: [...state.stateHistory, 'ABORTED'],
    transitionCount: state.transitionCount + 1,
    persistedAt: new Date().toISOString(),
  };
}

export function writeAbortJournalEntries(
  runsDir: string,
  runId: string,
  state: PersistedState,
  reason: string,
): void {
  const runDir = join(runsDir, runId);
  const journalPath = getJournalPath(runDir);
  const lastSequence = new DefaultJournalReader(journalPath)
    .readAll()
    .reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
  const journalWriter = new DefaultJournalWriter(journalPath, runId, lastSequence);
  const abortDurationMs = state.stateEnteredAt
    ? Date.now() - new Date(state.stateEnteredAt).getTime()
    : 0;
  journalWriter.append({
    timestamp: new Date().toISOString(),
    runId,
    sequence: state.transitionCount,
    type: 'state_transition',
    data: {
      kind: 'state_transition',
      from: state.currentState,
      to: 'ABORTED',
      trigger: 'failure',
      durationMs: abortDurationMs,
      guardsEvaluated: 0,
      guardsPassed: 0,
      governanceRequired: false,
    },
  });
  journalWriter.append({
    timestamp: new Date().toISOString(),
    runId,
    sequence: state.transitionCount + 1,
    type: 'run_aborted',
    data: {
      kind: 'run_lifecycle',
      workflowName: state.workflowName,
      workflowVersion: state.workflowVersion,
      status: 'aborted',
      reason,
      finalState: 'ABORTED',
    },
  });
}

export type AbortRunResult =
  | { readonly outcome: 'aborted'; readonly finalState: 'ABORTED'; readonly previousState: string }
  | {
      readonly outcome: 'already_terminal';
      readonly finalState: string;
      readonly previousState: string | null;
    };

export async function abortRunState(
  statePersistence: StatePersistence,
  runsDir: string,
  runId: string,
  state: PersistedState,
  reason: string,
  options?: { expectedSessionId?: string; onOwned?: (latest: PersistedState) => Promise<void> },
): Promise<AbortRunResult> {
  // SIGTERM is asynchronous. Never overwrite an owner that is still checkpointing
  // or cleaning up, and re-read durable progress only after acquiring ownership.
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!statePersistence.probeLock(state.runId).pidRunning) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const lock = statePersistence.acquireLock(state.runId);
  try {
    const events = new DefaultJournalReader(getJournalPath(join(runsDir, runId))).readAll();
    const latest = loadLatestRunState(statePersistence, state.runId, events).state ?? state;
    if (TERMINAL_STATES.has(latest.currentState) && !latest.pendingTerminalState) {
      return {
        outcome: 'already_terminal',
        finalState: latest.currentState,
        previousState: latest.previousState,
      };
    }
    if (
      options?.expectedSessionId &&
      latest.waitingContext?.liveSessionId !== options.expectedSessionId
    ) {
      throw new Error(
        `Session ID mismatch: expected ${latest.waitingContext?.liveSessionId ?? 'no live session'}, got ${options.expectedSessionId}`,
      );
    }
    await options?.onOwned?.(latest);
    await statePersistence.save(buildAbortedState(latest));
    try {
      writeAbortJournalEntries(runsDir, runId, latest, reason);
    } catch {
      // The committed aborted checkpoint remains authoritative if journaling fails.
    }
    return { outcome: 'aborted', finalState: 'ABORTED', previousState: latest.currentState };
  } finally {
    statePersistence.releaseLock(lock);
  }
}
