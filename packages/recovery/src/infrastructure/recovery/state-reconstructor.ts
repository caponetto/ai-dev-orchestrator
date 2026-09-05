import type { JournalReader } from '@ai-dev-orchestrator/ports';
import type { JournalEvent, PersistedState, RunId } from '@ai-dev-orchestrator/schemas';

/** Function that rebuilds a PersistedState by replaying journal events. */
export type StateRebuilder = (runId: RunId, events: readonly JournalEvent[]) => PersistedState;

export class StateReconstructor {
  private readonly journalReader: JournalReader;
  private readonly rebuildState: StateRebuilder;

  constructor(journalReader: JournalReader, rebuildState: StateRebuilder) {
    this.journalReader = journalReader;
    this.rebuildState = rebuildState;
  }

  reconstruct(runId: RunId): PersistedState | null {
    const events = this.journalReader
      .readAll()
      .filter((e) => e.runId === runId)
      .slice()
      .sort((a, b) => a.sequence - b.sequence);

    if (events.length === 0) {
      return null;
    }

    return this.rebuildState(runId, events);
  }
}
