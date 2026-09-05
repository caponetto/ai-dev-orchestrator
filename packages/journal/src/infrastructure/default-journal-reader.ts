import { existsSync, readFileSync } from 'node:fs';

import type { JournalReader } from '@ai-dev-orchestrator/ports';
import type { JournalEvent, JournalFilter } from '@ai-dev-orchestrator/schemas';
import { parse } from 'yaml';

/** Default journal reader that parses YAML blocks from a Markdown journal file. */
export class DefaultJournalReader implements JournalReader {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** @inheritdoc */
  readAll(): readonly JournalEvent[] {
    return this.parseJournal();
  }

  /** @inheritdoc */
  query(filter: JournalFilter): readonly JournalEvent[] {
    const events = this.parseJournal();
    return events.filter((event) => this.matchesFilter(event, filter));
  }

  /** @inheritdoc */
  range(start: string, end: string): readonly JournalEvent[] {
    const events = this.parseJournal();
    return events.filter((e) => e.timestamp >= start && e.timestamp <= end);
  }

  /** @inheritdoc */
  tail(count: number): readonly JournalEvent[] {
    const events = this.parseJournal();
    return events.slice(-count);
  }

  private parseJournal(): JournalEvent[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const content = readFileSync(this.filePath, 'utf8');
    const yamlBlockRegex = /```yaml\n([\s\S]*?)```/g;
    const events: JournalEvent[] = [];

    let match: RegExpExecArray | null = yamlBlockRegex.exec(content);
    while (match !== null) {
      try {
        const event = parse(match[1]) as JournalEvent;
        events.push(event);
      } catch {
        // Skip malformed blocks
      }
      match = yamlBlockRegex.exec(content);
    }

    return events;
  }

  private matchesFilter(event: JournalEvent, filter: JournalFilter): boolean {
    if (filter.eventType && event.type !== filter.eventType) {
      return false;
    }

    if (filter.stateId) {
      const data = event.data;
      if (
        'from' in data &&
        data.from !== filter.stateId &&
        'to' in data &&
        data.to !== filter.stateId
      ) {
        return false;
      }
      if ('stateId' in data && data.stateId !== filter.stateId) {
        return false;
      }
    }

    if (filter.role) {
      if ('role' in event.data && event.data.role !== filter.role) {
        return false;
      }
    }

    if (filter.after && event.timestamp < filter.after) {
      return false;
    }
    if (filter.before && event.timestamp > filter.before) {
      return false;
    }

    return true;
  }
}
