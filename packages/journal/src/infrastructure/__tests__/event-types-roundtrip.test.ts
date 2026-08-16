import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JournalEvent, JournalEventData, JournalEventType } from '@ai-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DefaultJournalReader } from '../default-journal-reader';
import { DefaultJournalWriter } from '../default-journal-writer';

const TEST_DIR = join(tmpdir(), `journal-roundtrip-${String(Date.now())}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

const EVENT_DATA: Record<JournalEventType, JournalEventData> = {
  run_started: { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0.0' },
  run_completed: {
    kind: 'run_lifecycle',
    workflowName: 'default',
    workflowVersion: '1.0.0',
    finalState: 'DONE',
  },
  run_aborted: {
    kind: 'run_lifecycle',
    workflowName: 'default',
    workflowVersion: '1.0.0',
    reason: 'user requested',
  },
  run_resumed: {
    kind: 'run_lifecycle',
    workflowName: 'default',
    workflowVersion: '1.0.0',
    status: 'resumed',
  },
  state_transition: {
    kind: 'state_transition',
    from: 'INTAKE',
    to: 'PLANNING',
    trigger: 'completion',
    durationMs: 42,
    guardsEvaluated: 1,
    guardsPassed: 1,
    governanceRequired: false,
  },
  worker_dispatched: {
    kind: 'worker',
    workerId: 'w-001',
    role: 'architect',
    stateId: 'PLANNING',
    status: 'dispatched',
  },
  worker_completed: {
    kind: 'worker',
    workerId: 'w-001',
    role: 'architect',
    stateId: 'PLANNING',
    status: 'completed',
    inputTokens: 100,
    outputTokens: 50,
  },
  worker_failed: {
    kind: 'worker',
    workerId: 'w-002',
    role: 'implementer',
    stateId: 'IMPLEMENTATION',
    status: 'failed',
    error: 'timeout',
  },
  worker_retried: {
    kind: 'worker',
    workerId: 'w-002',
    role: 'implementer',
    stateId: 'IMPLEMENTATION',
    status: 'retried',
    retryCount: 1,
  },
  artifact_stored: {
    kind: 'artifact',
    artifactRef: 'plan-v1' as never,
    producedBy: 'architect',
    sizeBytes: 1024,
  },
  governance_decision: {
    kind: 'governance',
    outcome: 'allowed',
    reason: 'all quality gates passed',
    policiesEvaluated: 3,
  },
  agreement_produced: {
    kind: 'governance',
    outcome: 'allowed',
    reason: 'plan approved',
    agreementType: 'plan_approval',
  },
  finding_raised: {
    kind: 'finding',
    findingId: 'f-001',
    severity: 'major',
    status: 'open',
    title: 'Missing error handling',
    blocking: 'blocking',
  },
  finding_resolved: {
    kind: 'finding',
    findingId: 'f-001',
    severity: 'major',
    status: 'resolved',
    title: 'Missing error handling',
    blocking: 'blocking',
    resolvedBy: 'implementer',
  },
  escalation: {
    kind: 'governance',
    outcome: 'escalated',
    reason: 'iteration limit exceeded',
    escalationReason: 'iteration_limit_exceeded',
  },
  human_input_requested: {
    kind: 'human',
    action: 'input_requested',
    stateId: 'WAITING_FOR_HUMAN',
    reason: 'clarification needed',
  },
  human_input_received: {
    kind: 'human',
    action: 'input_received',
    stateId: 'WAITING_FOR_HUMAN',
    inputType: 'text',
  },
  human_approval: {
    kind: 'human',
    action: 'approval',
    stateId: 'WAITING_FOR_HUMAN',
    approvedBy: 'user',
  },
  human_rejection: { kind: 'human', action: 'rejection', stateId: 'WAITING_FOR_HUMAN' },
  error: {
    kind: 'error',
    errorCode: 'PROVIDER_TIMEOUT',
    message: 'Provider timed out',
    stateId: 'IMPLEMENTATION',
    recoverable: true,
  },
};

describe('Journal event types round-trip', () => {
  it('writes and reads back all 21 event types', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    const writer = new DefaultJournalWriter(filePath, 'run-rt');
    const reader = new DefaultJournalReader(filePath);

    const eventTypes = Object.keys(EVENT_DATA) as JournalEventType[];
    expect(eventTypes).toHaveLength(20);

    for (const type of eventTypes) {
      writer.append({
        timestamp: '2026-01-01T00:00:00Z',
        runId: 'run-rt',
        sequence: 0,
        type,
        data: EVENT_DATA[type],
      } as JournalEvent);
    }

    const events = reader.readAll();
    expect(events).toHaveLength(20);

    for (let i = 0; i < eventTypes.length; i++) {
      const event = events[i];
      expect(event.type).toBe(eventTypes[i]);
      expect(event.data.kind).toBe(EVENT_DATA[eventTypes[i]].kind);
      expect(event.sequence).toBe(i + 1);
    }
  });

  it('round-trips each event type individually', () => {
    const eventTypes = Object.keys(EVENT_DATA) as JournalEventType[];

    for (const type of eventTypes) {
      const filePath = join(TEST_DIR, `journal-${type}.md`);
      const writer = new DefaultJournalWriter(filePath, 'run-single');
      const reader = new DefaultJournalReader(filePath);

      const original = {
        timestamp: '2026-06-15T10:30:00Z',
        runId: 'run-single',
        sequence: 0,
        type,
        data: EVENT_DATA[type],
      } as JournalEvent;

      writer.append(original);
      const [read] = reader.readAll();

      expect(read).toBeDefined();
      expect(read.type).toBe(type);
      expect(read.runId).toBe('run-single');
      expect(read.data.kind).toBe(original.data.kind);
    }
  });

  it('batch-writes all event types and reads them back in order', () => {
    const filePath = join(TEST_DIR, 'journal-batch.md');
    const writer = new DefaultJournalWriter(filePath, 'run-batch');
    const reader = new DefaultJournalReader(filePath);

    const eventTypes = Object.keys(EVENT_DATA) as JournalEventType[];

    const batch = eventTypes.map(
      (type) =>
        ({
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-batch',
          sequence: 0,
          type,
          data: EVENT_DATA[type],
        }) as JournalEvent,
    );

    writer.appendBatch(batch);

    const events = reader.readAll();
    expect(events).toHaveLength(20);

    for (let i = 0; i < eventTypes.length; i++) {
      expect(events[i].type).toBe(eventTypes[i]);
    }
  });
});
