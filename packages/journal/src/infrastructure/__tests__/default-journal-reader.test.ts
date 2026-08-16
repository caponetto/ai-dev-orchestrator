import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JournalEvent } from '@ai-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { DefaultJournalReader } from '../default-journal-reader';

const TEST_DIR = join(tmpdir(), `journal-reader-test-${String(Date.now())}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

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

function writeJournal(filePath: string, events: JournalEvent[]): void {
  let content = '# Workflow Journal — run-001\n\n';
  for (const event of events) {
    content += `\`\`\`yaml\n${stringify(event).trimEnd()}\n\`\`\`\n\n`;
  }
  writeFileSync(filePath, content, 'utf8');
}

describe('DefaultJournalReader', () => {
  it('returns empty array when file does not exist', () => {
    const reader = new DefaultJournalReader(join(TEST_DIR, 'missing.md'));
    expect(reader.readAll()).toEqual([]);
  });

  it('parses all events from journal file', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [
      makeEvent({ sequence: 1 }),
      makeEvent({ sequence: 2, type: 'state_transition' }),
    ]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.readAll();
    expect(events).toHaveLength(2);
    expect(events[0].sequence).toBe(1);
    expect(events[1].sequence).toBe(2);
  });

  it('filters by event type', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [
      makeEvent({ sequence: 1, type: 'run_started' }),
      makeEvent({
        sequence: 2,
        type: 'state_transition',
        data: {
          kind: 'state_transition',
          from: 'INTAKE',
          to: 'PLANNING',
          trigger: 'completion',
          durationMs: 100,
          guardsEvaluated: 1,
          guardsPassed: 1,
          governanceRequired: false,
        },
      }),
    ]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.query({ eventType: 'state_transition' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('state_transition');
  });

  it('filters by time range', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [
      makeEvent({ sequence: 1, timestamp: '2026-01-01T00:00:00Z' }),
      makeEvent({ sequence: 2, timestamp: '2026-01-02T00:00:00Z' }),
      makeEvent({ sequence: 3, timestamp: '2026-01-03T00:00:00Z' }),
    ]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.query({
      after: '2026-01-01T12:00:00Z',
      before: '2026-01-02T12:00:00Z',
    });
    expect(events).toHaveLength(1);
    expect(events[0].sequence).toBe(2);
  });

  it('tail returns last N events', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [
      makeEvent({ sequence: 1 }),
      makeEvent({ sequence: 2 }),
      makeEvent({ sequence: 3 }),
    ]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.tail(2);
    expect(events).toHaveLength(2);
    expect(events[0].sequence).toBe(2);
    expect(events[1].sequence).toBe(3);
  });

  it('tail returns all events when count exceeds total', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [makeEvent({ sequence: 1 })]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.tail(10);
    expect(events).toHaveLength(1);
  });

  it('range returns events within inclusive time bounds', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [
      makeEvent({ sequence: 1, timestamp: '2026-01-01T00:00:00Z' }),
      makeEvent({ sequence: 2, timestamp: '2026-01-02T00:00:00Z' }),
      makeEvent({ sequence: 3, timestamp: '2026-01-03T00:00:00Z' }),
      makeEvent({ sequence: 4, timestamp: '2026-01-04T00:00:00Z' }),
    ]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.range('2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z');
    expect(events).toHaveLength(2);
    expect(events[0].sequence).toBe(2);
    expect(events[1].sequence).toBe(3);
  });

  it('range returns empty array when no events match', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [makeEvent({ sequence: 1, timestamp: '2026-01-01T00:00:00Z' })]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.range('2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z');
    expect(events).toHaveLength(0);
  });

  it('filters by stateId matching from/to fields', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [
      makeEvent({
        sequence: 1,
        type: 'state_transition',
        data: {
          kind: 'state_transition',
          from: 'INTAKE',
          to: 'PLANNING',
          trigger: 'completion',
          durationMs: 100,
          guardsEvaluated: 1,
          guardsPassed: 1,
          governanceRequired: false,
        },
      }),
      makeEvent({
        sequence: 2,
        type: 'state_transition',
        data: {
          kind: 'state_transition',
          from: 'PLANNING',
          to: 'IMPLEMENTATION',
          trigger: 'completion',
          durationMs: 200,
          guardsEvaluated: 1,
          guardsPassed: 1,
          governanceRequired: false,
        },
      }),
    ]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.query({ stateId: 'PLANNING' });
    expect(events).toHaveLength(2);
  });

  it('filters by stateId matching stateId field', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [
      makeEvent({
        sequence: 1,
        type: 'dispatch_started',
        data: {
          kind: 'dispatch',
          stateId: 'IMPLEMENTATION',
          role: 'implementer',
          dispatchType: 'cli',
          runner: 'claude-code',
        },
      }),
      makeEvent({
        sequence: 2,
        type: 'dispatch_started',
        data: {
          kind: 'dispatch',
          stateId: 'REVIEW',
          role: 'reviewer',
          dispatchType: 'cli',
          runner: 'claude-code',
        },
      }),
    ]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.query({ stateId: 'IMPLEMENTATION' });
    expect(events).toHaveLength(1);
    expect(events[0].sequence).toBe(1);
  });

  it('filters by role', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [
      makeEvent({
        sequence: 1,
        type: 'dispatch_started',
        data: {
          kind: 'dispatch',
          stateId: 'IMPLEMENTATION',
          role: 'implementer',
          dispatchType: 'cli',
          runner: 'claude-code',
        },
      }),
      makeEvent({
        sequence: 2,
        type: 'dispatch_started',
        data: {
          kind: 'dispatch',
          stateId: 'REVIEW',
          role: 'reviewer',
          dispatchType: 'cli',
          runner: 'claude-code',
        },
      }),
    ]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.query({ role: 'implementer' });
    expect(events).toHaveLength(1);
    expect(events[0].sequence).toBe(1);
  });

  it('excludes events where from/to do not match stateId filter', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    writeJournal(filePath, [
      makeEvent({
        sequence: 1,
        type: 'state_transition',
        data: {
          kind: 'state_transition',
          from: 'INTAKE',
          to: 'PLANNING',
          trigger: 'completion',
          durationMs: 100,
          guardsEvaluated: 1,
          guardsPassed: 1,
          governanceRequired: false,
        },
      }),
    ]);

    const reader = new DefaultJournalReader(filePath);
    const events = reader.query({ stateId: 'IMPLEMENTATION' });
    expect(events).toHaveLength(0);
  });
});
