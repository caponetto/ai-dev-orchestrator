import type { Event } from '@ai-dev-orchestrator/schemas';

/**
 * Port for EventBus-level event persistence and replay.
 *
 * Uses the domain `Event` type for general-purpose event sourcing.
 * Distinct from {@link JournalReader}/{@link JournalWriter} which operate
 * on `JournalEvent` — the structured workflow journal used for state
 * reconstruction, diagnostics, and audit.
 */
export interface EventJournal {
  append(event: Event): void;
  readAll(): readonly Event[];
  readFrom(afterSequence: number): readonly Event[];
}
