import { join } from 'node:path';

import { DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import type { StatePersistence } from '@ai-dev-orchestrator/ports';
import type { PersistedState } from '@ai-dev-orchestrator/schemas';

import { getJournalPath } from './workspace-paths';

export const TERMINAL_STATES = new Set(['DONE', 'ABORTED']);

export function buildAbortedState(state: PersistedState): PersistedState {
  return {
    ...state,
    currentState: 'ABORTED',
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
  const journalWriter = new DefaultJournalWriter(getJournalPath(runDir), runId);
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

export async function abortRunState(
  statePersistence: StatePersistence,
  runsDir: string,
  runId: string,
  state: PersistedState,
  reason: string,
): Promise<void> {
  await statePersistence.save(buildAbortedState(state));

  try {
    writeAbortJournalEntries(runsDir, runId, state, reason);
  } catch {
    // Journal write failure is non-fatal for abort
  }
}
