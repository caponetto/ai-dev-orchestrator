import type { JournalWriter } from '@ai-orchestrator/ports';
import type { JournalEvent } from '@ai-orchestrator/schemas';

import { flushToFile } from './disk-flusher';
import { formatEvent, formatEvents, formatJournalHeader } from './journal-formatter';
import { SequenceFactory } from './sequence-factory';

/** Default journal writer that appends formatted events to a Markdown file. */
export class DefaultJournalWriter implements JournalWriter {
  private readonly filePath: string;
  private readonly runId: string;
  private readonly sequence: SequenceFactory;

  constructor(filePath: string, runId: string, startSequence = 0) {
    this.filePath = filePath;
    this.runId = runId;
    this.sequence = new SequenceFactory(startSequence);
  }

  /** @inheritdoc */
  append(event: JournalEvent): void {
    const sequenced = this.assignSequence(event);
    const formatted = formatEvent(sequenced);
    flushToFile(this.filePath, formatted, formatJournalHeader(this.runId));
  }

  /** @inheritdoc */
  appendBatch(events: readonly JournalEvent[]): void {
    const sequenced = events.map((e) => this.assignSequence(e));
    const formatted = formatEvents(sequenced);
    flushToFile(this.filePath, formatted, formatJournalHeader(this.runId));
  }

  private assignSequence(event: JournalEvent): JournalEvent {
    return { ...event, sequence: this.sequence.next() };
  }
}
