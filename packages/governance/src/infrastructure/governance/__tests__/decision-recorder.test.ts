import type { JournalWriter } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { GovernanceDecision, JournalEvent } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { DecisionRecorder } from '../decision-recorder';

function makeDecision(overrides: Partial<GovernanceDecision> = {}): GovernanceDecision {
  return {
    timestamp: new Date().toISOString(),
    runId: createRunId('run-001'),
    transitionRequested: { from: 'PLAN_REVIEW', to: 'IMPLEMENTATION' },
    policiesEvaluated: [],
    outcome: 'allowed',
    reason: 'All policies passed',
    artifactsInspected: [],
    ...overrides,
  };
}

function makeMockJournalWriter(): JournalWriter & { appendedEvents: JournalEvent[] } {
  const appendedEvents: JournalEvent[] = [];
  return {
    appendedEvents,
    append: vi.fn((event: JournalEvent) => {
      appendedEvents.push(event);
    }),
    appendBatch: vi.fn((events: readonly JournalEvent[]) => {
      appendedEvents.push(...events);
    }),
  };
}

describe('DecisionRecorder', () => {
  it('records and retrieves decisions', () => {
    const recorder = new DecisionRecorder();
    const decision = makeDecision();
    recorder.record(decision);

    expect(recorder.getDecisions()).toHaveLength(1);
    expect(recorder.getDecisions()[0]).toEqual(decision);
  });

  it('returns immutable copy of decisions', () => {
    const recorder = new DecisionRecorder();
    recorder.record(makeDecision());

    const decisions = recorder.getDecisions();
    expect(decisions).toHaveLength(1);
  });

  it('filters decisions by run ID', () => {
    const recorder = new DecisionRecorder();
    recorder.record(makeDecision({ runId: createRunId('run-001') }));
    recorder.record(makeDecision({ runId: createRunId('run-002') }));
    recorder.record(makeDecision({ runId: createRunId('run-001') }));

    expect(recorder.getDecisionsForRun(createRunId('run-001'))).toHaveLength(2);
    expect(recorder.getDecisionsForRun(createRunId('run-002'))).toHaveLength(1);
    expect(recorder.getDecisionsForRun(createRunId('run-003'))).toHaveLength(0);
  });

  it('works without a journal writer (backward compatible)', () => {
    const recorder = new DecisionRecorder();
    const decision = makeDecision();
    recorder.record(decision);

    expect(recorder.getDecisions()).toHaveLength(1);
  });

  it('persists decisions to journal when writer is provided', () => {
    const writer = makeMockJournalWriter();
    const recorder = new DecisionRecorder(writer);
    const decision = makeDecision();
    recorder.record(decision);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(writer.append).toHaveBeenCalledTimes(1);
    expect(writer.appendedEvents).toHaveLength(1);

    const journalEvent = writer.appendedEvents[0];
    expect(journalEvent.type).toBe('governance_decision');
    expect(journalEvent.runId).toBe('run-001');
    expect(journalEvent.timestamp).toBe(decision.timestamp);
  });

  it('writes correct governance event data to journal', () => {
    const writer = makeMockJournalWriter();
    const recorder = new DecisionRecorder(writer);
    const decision = makeDecision({
      outcome: 'denied',
      reason: 'Quality gate failed',
      transitionRequested: { from: 'IMPLEMENTATION', to: 'VERIFICATION' },
      policiesEvaluated: [
        { policy: 'coverage_gate', evaluated: true, result: 'fail', detail: 'Coverage too low' },
        { policy: 'lint_gate', evaluated: true, result: 'pass', detail: 'Lint passed' },
      ],
    });
    recorder.record(decision);

    const eventData = writer.appendedEvents[0].data;
    expect(eventData).toEqual({
      kind: 'governance',
      outcome: 'denied',
      reason: 'Quality gate failed',
      transitionFrom: 'IMPLEMENTATION',
      transitionTo: 'VERIFICATION',
      policiesEvaluated: 2,
    });
  });

  it('persists multiple decisions to journal', () => {
    const writer = makeMockJournalWriter();
    const recorder = new DecisionRecorder(writer);
    recorder.record(makeDecision({ runId: createRunId('run-001') }));
    recorder.record(makeDecision({ runId: createRunId('run-002') }));
    recorder.record(makeDecision({ runId: createRunId('run-001') }));

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(writer.append).toHaveBeenCalledTimes(3);
    expect(writer.appendedEvents).toHaveLength(3);
    expect(writer.appendedEvents[0].runId).toBe('run-001');
    expect(writer.appendedEvents[1].runId).toBe('run-002');
    expect(writer.appendedEvents[2].runId).toBe('run-001');
  });

  it('still stores in-memory even when journal write is provided', () => {
    const writer = makeMockJournalWriter();
    const recorder = new DecisionRecorder(writer);
    recorder.record(makeDecision({ runId: createRunId('run-001') }));
    recorder.record(makeDecision({ runId: createRunId('run-002') }));

    expect(recorder.getDecisions()).toHaveLength(2);
    expect(recorder.getDecisionsForRun(createRunId('run-001'))).toHaveLength(1);
    expect(recorder.getDecisionsForRun(createRunId('run-002'))).toHaveLength(1);
  });
});
