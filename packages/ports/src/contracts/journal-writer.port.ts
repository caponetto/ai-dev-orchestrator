import type { JournalEvent } from '@ai-dev-orchestrator/schemas';

/**
 * Port for appending structured events to the workflow journal.
 *
 * Paired with {@link JournalReader} for the write side of the workflow
 * journal. Distinct from {@link EventJournal} which handles general `Event` types.
 */
export interface JournalWriter {
  /** Append a single event to the journal. Flushes to durable storage before returning. */
  append(event: JournalEvent): void;

  /** Append a batch of events atomically. Flushes to durable storage before returning. */
  appendBatch(events: readonly JournalEvent[]): void;
}
