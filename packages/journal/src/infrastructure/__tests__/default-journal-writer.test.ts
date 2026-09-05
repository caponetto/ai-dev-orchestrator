import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JournalEvent } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DefaultJournalWriter } from '../default-journal-writer';

const TEST_DIR = join(tmpdir(), `journal-writer-test-${String(Date.now())}`);

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
    sequence: 0,
    type: 'run_started',
    data: {
      kind: 'run_lifecycle',
      workflowName: 'default',
      workflowVersion: '1.0.0',
    },
    ...overrides,
  } as JournalEvent;
}

describe('DefaultJournalWriter', () => {
  it('appends a single event with header', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    const writer = new DefaultJournalWriter(filePath, 'run-001');
    writer.append(makeEvent());
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('# Workflow Journal');
    expect(content).toContain('run-001');
    expect(content).toContain('run_started');
  });

  it('assigns monotonic sequence numbers', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    const writer = new DefaultJournalWriter(filePath, 'run-001');
    writer.append(makeEvent());
    writer.append(makeEvent({ type: 'state_transition' }));
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('sequence: 1');
    expect(content).toContain('sequence: 2');
  });

  it('appends batch of events', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    const writer = new DefaultJournalWriter(filePath, 'run-001');
    writer.appendBatch([
      makeEvent({ type: 'run_started' }),
      makeEvent({ type: 'state_transition' }),
    ]);
    const content = readFileSync(filePath, 'utf8');
    expect(content.match(/```yaml/g)).toHaveLength(2);
  });

  it('continues sequence from start value', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    const writer = new DefaultJournalWriter(filePath, 'run-001', 10);
    writer.append(makeEvent());
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('sequence: 11');
  });
});
