import type { JournalEvent, JournalFilter } from '@ai-orchestrator/schemas';

/**
 * Port for reading structured workflow journal events (`JournalEvent`).
 *
 * Used for state reconstruction, diagnostics, and audit. Distinct from
 * {@link EventJournal} which handles general-purpose `Event` persistence.
 */
export interface JournalReader {
  /** Read all events from the journal. */
  readAll(): readonly JournalEvent[];

  /** Query events matching a filter. */
  query(filter: JournalFilter): readonly JournalEvent[];

  /** Read events within a time range (inclusive, ISO 8601 strings). */
  range(start: string, end: string): readonly JournalEvent[];

  /** Read the last N events from the journal. */
  tail(count: number): readonly JournalEvent[];
}
