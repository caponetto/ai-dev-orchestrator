import { rebuildStateFromEvents } from '@ai-orchestrator/core';
import type { JournalReader } from '@ai-orchestrator/ports';
import { createRunId } from '@ai-orchestrator/ports';
import type { JournalEvent } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { StateReconstructor } from '../state-reconstructor';

function makeReader(events: readonly JournalEvent[]): JournalReader {
  return {
    readAll: () => events,
    query: () => events,
    range: (start: string, end: string) =>
      events.filter((e) => e.timestamp >= start && e.timestamp <= end),
    tail: (n: number) => events.slice(-n),
  };
}

function makeEvent(
  seq: number,
  type: JournalEvent['type'],
  data: JournalEvent['data'],
  runId = 'run-1',
): JournalEvent {
  return {
    timestamp: new Date().toISOString(),
    runId,
    sequence: seq,
    type,
    data,
  } as JournalEvent;
}

describe('StateReconstructor', () => {
  it('returns null for empty journal', () => {
    const reader = makeReader([]);
    const reconstructor = new StateReconstructor(reader, rebuildStateFromEvents);
    const result = reconstructor.reconstruct(createRunId('run-1'));
    expect(result).toBeNull();
  });

  it('reconstructs state from run_started event', () => {
    const events = [
      makeEvent(1, 'run_started', {
        kind: 'run_lifecycle',
        workflowName: 'default',
        workflowVersion: '1.0.0',
      }),
    ];
    const reader = makeReader(events);
    const reconstructor = new StateReconstructor(reader, rebuildStateFromEvents);
    const result = reconstructor.reconstruct(createRunId('run-1'));

    expect(result).not.toBeNull();
    expect(result?.currentState).toBe('INTAKE');
    expect(result?.workflowName).toBe('default');
  });

  it('applies state transitions', () => {
    const events = [
      makeEvent(1, 'run_started', {
        kind: 'run_lifecycle',
        workflowName: 'default',
        workflowVersion: '1.0.0',
      }),
      makeEvent(2, 'state_transition', {
        kind: 'state_transition',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        durationMs: 100,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: false,
      }),
      makeEvent(3, 'state_transition', {
        kind: 'state_transition',
        from: 'PLANNING',
        to: 'IMPLEMENTATION',
        trigger: 'completion',
        durationMs: 50,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: false,
      }),
    ];
    const reader = makeReader(events);
    const reconstructor = new StateReconstructor(reader, rebuildStateFromEvents);
    const result = reconstructor.reconstruct(createRunId('run-1'));

    expect(result?.currentState).toBe('IMPLEMENTATION');
    expect(result?.previousState).toBe('PLANNING');
    expect(result?.transitionCount).toBe(2);
    expect(result?.stateHistory).toEqual(['INTAKE', 'PLANNING', 'IMPLEMENTATION']);
  });

  it('tracks in-flight workers without changing FSM state', () => {
    const events = [
      makeEvent(1, 'run_started', {
        kind: 'run_lifecycle',
        workflowName: 'default',
        workflowVersion: '1.0.0',
      }),
      makeEvent(2, 'worker_dispatched', {
        kind: 'worker',
        workerId: 'w-1',
        role: 'implementer',
        stateId: 'IMPLEMENTATION',
        status: 'dispatched',
      }),
    ];
    const reader = makeReader(events);
    const reconstructor = new StateReconstructor(reader, rebuildStateFromEvents);
    const result = reconstructor.reconstruct(createRunId('run-1'));

    expect(result?.currentState).toBe('INTAKE');
  });

  it('is deterministic: same journal produces same state', () => {
    const events = [
      makeEvent(1, 'run_started', {
        kind: 'run_lifecycle',
        workflowName: 'default',
        workflowVersion: '1.0.0',
      }),
      makeEvent(2, 'state_transition', {
        kind: 'state_transition',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        durationMs: 100,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: false,
      }),
    ];
    const reader = makeReader(events);
    const r1 = new StateReconstructor(reader, rebuildStateFromEvents).reconstruct(
      createRunId('run-1'),
    );
    const r2 = new StateReconstructor(reader, rebuildStateFromEvents).reconstruct(
      createRunId('run-1'),
    );

    expect(r1?.currentState).toBe(r2?.currentState);
    expect(r1?.transitionCount).toBe(r2?.transitionCount);
    expect(r1?.stateHistory).toEqual(r2?.stateHistory);
  });

  it('deduplicates stateHistory and tracks transitionCount on revisits', () => {
    const events = [
      makeEvent(1, 'run_started', {
        kind: 'run_lifecycle',
        workflowName: 'default',
        workflowVersion: '1.0.0',
      }),
      makeEvent(2, 'state_transition', {
        kind: 'state_transition',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        durationMs: 100,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: false,
      }),
      makeEvent(3, 'state_transition', {
        kind: 'state_transition',
        from: 'PLANNING',
        to: 'IMPLEMENTATION',
        trigger: 'completion',
        durationMs: 50,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: false,
      }),
      makeEvent(4, 'state_transition', {
        kind: 'state_transition',
        from: 'IMPLEMENTATION',
        to: 'PLANNING',
        trigger: 'review_rejected',
        durationMs: 30,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: false,
      }),
    ];
    const reader = makeReader(events);
    const result = new StateReconstructor(reader, rebuildStateFromEvents).reconstruct(
      createRunId('run-1'),
    );

    expect(result?.transitionCount).toBe(3);
    expect(result?.stateHistory).toEqual(['INTAKE', 'PLANNING', 'IMPLEMENTATION']);
    expect(result?.iterationCounts).toEqual({});
  });

  it('tracks judgeArbitrationCounts by contractId', () => {
    const events = [
      makeEvent(1, 'run_started', {
        kind: 'run_lifecycle',
        workflowName: 'default',
        workflowVersion: '1.0.0',
      }),
      makeEvent(2, 'state_transition', {
        kind: 'state_transition',
        from: 'INTAKE',
        to: 'JUDGE_REVIEW',
        trigger: 'completion',
        durationMs: 100,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: true,
        governanceOutcome: 'allowed',
        contractId: 'implementation_review_loop',
      }),
      makeEvent(3, 'state_transition', {
        kind: 'state_transition',
        from: 'JUDGE_REVIEW',
        to: 'IMPLEMENTATION',
        trigger: 'completion',
        durationMs: 50,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: false,
      }),
      makeEvent(4, 'state_transition', {
        kind: 'state_transition',
        from: 'IMPLEMENTATION',
        to: 'JUDGE_REVIEW',
        trigger: 'completion',
        durationMs: 30,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: true,
        governanceOutcome: 'allowed',
        contractId: 'implementation_review_loop',
      }),
    ];
    const reader = makeReader(events);
    const result = new StateReconstructor(reader, rebuildStateFromEvents).reconstruct(
      createRunId('run-1'),
    );

    expect(result?.judgeArbitrationCounts).toEqual({ implementation_review_loop: 2 });
  });

  it('reconstructs waitingContext from human_input_requested events', () => {
    const events = [
      makeEvent(1, 'run_started', {
        kind: 'run_lifecycle',
        workflowName: 'default',
        workflowVersion: '1.0.0',
      }),
      makeEvent(2, 'state_transition', {
        kind: 'state_transition',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        durationMs: 100,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: false,
      }),
      makeEvent(3, 'human_input_requested', {
        kind: 'human',
        action: 'input_requested',
        stateId: 'WAITING_FOR_HUMAN',
        reason: 'waiting_for_human',
      }),
    ];
    const reader = makeReader(events);
    const result = new StateReconstructor(reader, rebuildStateFromEvents).reconstruct(
      createRunId('run-1'),
    );

    expect(result?.waitingContext).toBeDefined();
    expect(result?.waitingContext?.reason).toBe('waiting_for_human');
    expect(result?.waitingContext?.requiredInput).toBe('approval');
    expect(result?.waitingContext?.autoResumeSafe).toBe(true);
  });

  it('sorts out-of-order events by sequence number', () => {
    const events = [
      makeEvent(3, 'state_transition', {
        kind: 'state_transition',
        from: 'PLANNING',
        to: 'IMPLEMENTATION',
        trigger: 'completion',
        durationMs: 50,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: false,
      }),
      makeEvent(1, 'run_started', {
        kind: 'run_lifecycle',
        workflowName: 'default',
        workflowVersion: '1.0.0',
      }),
      makeEvent(2, 'state_transition', {
        kind: 'state_transition',
        from: 'INTAKE',
        to: 'PLANNING',
        trigger: 'completion',
        durationMs: 100,
        guardsEvaluated: 1,
        guardsPassed: 1,
        governanceRequired: false,
      }),
    ];
    const reader = makeReader(events);
    const result = new StateReconstructor(reader, rebuildStateFromEvents).reconstruct(
      createRunId('run-1'),
    );

    expect(result?.currentState).toBe('IMPLEMENTATION');
    expect(result?.stateHistory).toEqual(['INTAKE', 'PLANNING', 'IMPLEMENTATION']);
  });

  it('filters events by runId', () => {
    const events = [
      makeEvent(
        1,
        'run_started',
        {
          kind: 'run_lifecycle',
          workflowName: 'default',
          workflowVersion: '1.0.0',
        },
        'run-1',
      ),
      makeEvent(
        2,
        'state_transition',
        {
          kind: 'state_transition',
          from: 'INTAKE',
          to: 'REVIEW',
          trigger: 'completion',
          durationMs: 100,
          guardsEvaluated: 1,
          guardsPassed: 1,
          governanceRequired: false,
        },
        'run-other',
      ),
      makeEvent(
        3,
        'state_transition',
        {
          kind: 'state_transition',
          from: 'INTAKE',
          to: 'PLANNING',
          trigger: 'completion',
          durationMs: 100,
          guardsEvaluated: 1,
          guardsPassed: 1,
          governanceRequired: false,
        },
        'run-1',
      ),
    ];
    const reader = makeReader(events);
    const result = new StateReconstructor(reader, rebuildStateFromEvents).reconstruct(
      createRunId('run-1'),
    );

    // Should only see transitions for run-1, not the REVIEW transition from run-other
    expect(result?.currentState).toBe('PLANNING');
    expect(result?.stateHistory).toEqual(['INTAKE', 'PLANNING']);
  });

  it('returns null when no events match the runId', () => {
    const events = [
      makeEvent(
        1,
        'run_started',
        {
          kind: 'run_lifecycle',
          workflowName: 'default',
          workflowVersion: '1.0.0',
        },
        'run-other',
      ),
    ];
    const reader = makeReader(events);
    const result = new StateReconstructor(reader, rebuildStateFromEvents).reconstruct(
      createRunId('run-1'),
    );

    expect(result).toBeNull();
  });

  it('sets workflow name and version from run_started event', () => {
    const events = [
      makeEvent(1, 'run_started', {
        kind: 'run_lifecycle',
        workflowName: 'custom-workflow',
        workflowVersion: '2.3.0',
      }),
    ];
    const reader = makeReader(events);
    const result = new StateReconstructor(reader, rebuildStateFromEvents).reconstruct(
      createRunId('run-1'),
    );

    expect(result?.workflowName).toBe('custom-workflow');
    expect(result?.workflowVersion).toBe('2.3.0');
  });

  it('produces valid PersistedState structure', () => {
    const events = [
      makeEvent(1, 'run_started', {
        kind: 'run_lifecycle',
        workflowName: 'default',
        workflowVersion: '1.0.0',
      }),
    ];
    const reader = makeReader(events);
    const result = new StateReconstructor(reader, rebuildStateFromEvents).reconstruct(
      createRunId('run-1'),
    );

    expect(result).not.toBeNull();
    expect(result?.runId).toBe('run-1');
    expect(result?.schemaVersion).toBe(1);
    expect(result?.persistenceVersion).toBe(0);
    expect(result?.activeArtifacts).toEqual([]);
    expect(result?.lastProducedArtifact).toBeNull();
    expect(result?.persistedAt).toBeTruthy();
    expect(result?.checksum).toMatch(/^sha256:/);
  });
});
