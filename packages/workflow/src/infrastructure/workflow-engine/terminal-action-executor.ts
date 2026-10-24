import type { Action, ActionResult, EntryActionContinuation } from '@ai-dev-orchestrator/schemas';

interface TerminalActionEffects {
  readonly execute: (action: Action) => Promise<readonly ActionResult[]>;
  readonly recordUsage: (results: readonly ActionResult[]) => void;
  readonly persist: (cursor: EntryActionContinuation) => Promise<void>;
  readonly pauseForSession: (results: readonly ActionResult[]) => Promise<boolean>;
  readonly pauseForBudget: (results: readonly ActionResult[]) => Promise<boolean>;
  readonly shouldStop: () => boolean;
  readonly deadlineExceeded: () => boolean;
}

/** Execute terminal actions in order, committing the cursor before observing pauses/stops. */
export async function executeTerminalActions(
  terminalState: string,
  actions: readonly Action[],
  continuation: EntryActionContinuation | null,
  effects: TerminalActionEffects,
): Promise<{ results: ActionResult[]; pausedBeforeActions: boolean }> {
  const terminalResults = [...(continuation?.completedResults ?? [])];
  const initialCursor = {
    stateId: terminalState,
    completedResults: terminalResults,
    nextActionIndex: terminalResults.length,
  };
  await effects.persist(initialCursor);
  if (await effects.pauseForSession(terminalResults)) {
    return { results: terminalResults, pausedBeforeActions: true };
  }
  if (!terminalResults.some((result) => !result.success)) {
    for (const action of actions.slice(continuation?.nextActionIndex ?? 0)) {
      const newResults = await effects.execute(action);
      effects.recordUsage(newResults);
      terminalResults.push(...newResults);
      const cursor: EntryActionContinuation = {
        stateId: terminalState,
        completedResults: [...terminalResults],
        nextActionIndex: terminalResults.length,
      };
      await effects.persist(cursor);
      if (
        (await effects.pauseForSession(terminalResults)) ||
        (await effects.pauseForBudget(terminalResults))
      ) {
        break;
      }
      if (
        effects.shouldStop() ||
        newResults.some((result) => !result.success) ||
        effects.deadlineExceeded()
      ) {
        break;
      }
    }
  }
  return { results: terminalResults, pausedBeforeActions: false };
}
