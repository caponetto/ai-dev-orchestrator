import type { JournalEvent } from '@ai-dev-orchestrator/schemas';
import { stringify } from 'yaml';

/** Format a journal event as a YAML code block in Markdown. */
export function formatEvent(event: JournalEvent): string {
  const yaml = stringify(event).trimEnd();
  return `\`\`\`yaml\n${yaml}\n\`\`\`\n\n`;
}

/** Format multiple events into a single Markdown string. */
export function formatEvents(events: readonly JournalEvent[]): string {
  return events.map(formatEvent).join('');
}

/** Create the Markdown header for a new journal file. */
export function formatJournalHeader(runId: string): string {
  return `# Workflow Journal — ${runId}\n\n`;
}
