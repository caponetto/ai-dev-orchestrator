import type { JournalEvent } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { formatEvent, formatEvents, formatJournalHeader } from '../journal-formatter';

function makeEvent(overrides: Partial<JournalEvent> = {}): JournalEvent {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    runId: 'run-001',
    sequence: 1,
    type: 'run_started',
    data: {
      kind: 'run_lifecycle',
      workflowName: 'default',
      workflowVersion: '1.0.0',
    },
    ...overrides,
  } as JournalEvent;
}

describe('formatEvent', () => {
  it('wraps event in a yaml code block', () => {
    const result = formatEvent(makeEvent());
    expect(result).toContain('```yaml');
    expect(result).toContain('```\n');
    expect(result).toContain('runId: run-001');
  });

  it('ends with double newline', () => {
    const result = formatEvent(makeEvent());
    expect(result.endsWith('\n\n')).toBe(true);
  });
});

describe('formatEvents', () => {
  it('formats multiple events', () => {
    const events = [makeEvent({ sequence: 1 }), makeEvent({ sequence: 2 })];
    const result = formatEvents(events);
    expect(result.match(/```yaml/g)).toHaveLength(2);
  });

  it('returns empty string for empty array', () => {
    expect(formatEvents([])).toBe('');
  });
});

describe('formatJournalHeader', () => {
  it('creates a Markdown header with run ID', () => {
    const header = formatJournalHeader('run-001');
    expect(header).toBe('# Workflow Journal — run-001\n\n');
  });
});
