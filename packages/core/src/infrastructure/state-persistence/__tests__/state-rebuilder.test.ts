import { createRunId } from '@ai-dev-orchestrator/ports';
import type { JournalEvent, StateTransitionData } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { DefaultStatePersistence } from '../default-state-persistence';

const runId = createRunId('replay');
let sequence = 0;
function transition(
  from: string,
  to: string,
  extra: Partial<StateTransitionData> = {},
): JournalEvent {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    runId,
    sequence: ++sequence,
    type: 'state_transition',
    data: {
      kind: 'state_transition',
      from,
      to,
      trigger: 'completion',
      durationMs: 1,
      guardsEvaluated: 0,
      guardsPassed: 0,
      governanceRequired: false,
      ...extra,
    },
  };
}
function rebuild(events: JournalEvent[]) {
  const state = new DefaultStatePersistence('/private/tmp/replay-unused').reconstructFromJournal(
    runId,
    events,
  );
  if (!state) {
    throw new Error('Expected reconstructed state');
  }
  return state;
}

describe('journal accounting reconstruction', () => {
  it('does not consume a newer wait when replaying a checkpointed-answer diagnostic', () => {
    const base = rebuild([transition('INTAKE', 'WORK')]);
    const waitingContext = {
      reason: 'clarification_needed',
      requiredInput: 'text' as const,
      requestingState: 'WORK',
      waitingSince: 'new-wait',
      autoResumeSafe: false,
      presentedArtifacts: [],
    };
    const lastHumanAnswer = {
      stateId: 'WAIT',
      requestingState: 'WORK',
      waitingSince: 'old-wait',
      content: 'accepted',
    };
    const snapshot: JournalEvent = {
      timestamp: '',
      runId,
      sequence: ++sequence,
      type: 'workflow_checkpoint',
      data: { kind: 'workflow_checkpoint', state: { ...base, waitingContext, lastHumanAnswer } },
    };
    const diagnostic: JournalEvent = {
      timestamp: '',
      runId,
      sequence: ++sequence,
      type: 'human_input_received',
      data: { kind: 'human', action: 'answer_checkpointed', stateId: 'WAIT' },
    };
    expect(rebuild([snapshot, diagnostic])).toMatchObject({ waitingContext, lastHumanAnswer });
  });
  it.each([true, false])(
    'restores per-role completion metrics once (checkpoint metrics present: %s)',
    (hasMetrics) => {
      const base = rebuild([transition('INTAKE', 'WORK')]);
      const metrics = {
        inputTokens: 0,
        outputTokens: 0,
        dispatches: 1,
        durationMs: 0,
        artifactsProduced: 0,
      };
      const checkpoint: JournalEvent = {
        timestamp: '',
        runId,
        sequence: ++sequence,
        type: 'workflow_checkpoint',
        data: {
          kind: 'workflow_checkpoint',
          state: { ...base, workerMetricsByRole: hasMetrics ? { planner: metrics } : undefined },
        },
      };
      const event: JournalEvent = {
        timestamp: '',
        runId,
        sequence: ++sequence,
        type: 'worker_completed',
        data: {
          kind: 'worker',
          workerId: 'session',
          role: 'planner',
          inputTokens: 30,
          outputTokens: 20,
          durationMs: 5,
          entryActionContinuation: { stateId: 'WORK', completedResults: [], nextActionIndex: 1 },
        },
      };
      const recovered = rebuild([checkpoint, event]);
      expect(recovered.workerMetricsByRole?.planner).toEqual({
        ...metrics,
        inputTokens: 30,
        outputTokens: 20,
        durationMs: 5,
        dispatches: hasMetrics ? 2 : 1,
      });
      const saved: JournalEvent = {
        timestamp: '',
        runId,
        sequence: ++sequence,
        type: 'workflow_checkpoint',
        data: { kind: 'workflow_checkpoint', state: recovered },
      };
      expect(rebuild([checkpoint, event, saved]).workerMetricsByRole).toEqual(
        recovered.workerMetricsByRole,
      );
      expect(metrics.inputTokens).toBe(0);
    },
  );

  it.each([
    ['PLAN_REVIEW', 'plan_review_loop'],
    ['CODE_REVIEW', 'implementation_review_loop'],
    ['REFINEMENT', 'clarification_loop'],
    ['ACCEPTANCE_VALIDATION', 'acceptance_validation_loop'],
    ['DECOMPOSITION_REVIEW', 'decomposition_review_loop'],
  ])('counts every %s visit in legacy journals', (state, contract) => {
    const rebuilt = rebuild([
      transition('PRODUCE', state),
      transition(state, 'PRODUCE'),
      transition('PRODUCE', state),
    ]);
    expect(rebuilt.iterationCounts[contract]).toBe(2);
    expect(rebuilt.stateHistory).toEqual(['PRODUCE', state, 'PRODUCE', state]);
  });

  it('preserves self-transitions as separate state visits', () => {
    expect(
      rebuild([transition('PLAN_REVIEW', 'PLAN_REVIEW'), transition('PLAN_REVIEW', 'PLAN_REVIEW')])
        .stateHistory,
    ).toEqual(['PLAN_REVIEW', 'PLAN_REVIEW', 'PLAN_REVIEW']);
  });

  it('sums completed and failed worker usage, including zero and missing metrics', () => {
    const events: JournalEvent[] = [transition('INTAKE', 'PLANNING')];
    for (const [type, inputTokens, outputTokens] of [
      ['worker_failed', 100, 20],
      ['worker_completed', 200, 40],
      ['worker_completed', 0, 0],
      ['worker_failed', undefined, undefined],
    ] as const) {
      events.push({
        timestamp: '2026-01-01T00:00:01Z',
        runId,
        sequence: ++sequence,
        type,
        data: {
          kind: 'worker',
          workerId: String(sequence),
          role: 'planner',
          stateId: 'PLANNING',
          status: type,
          inputTokens,
          outputTokens,
        },
      });
    }
    const state = rebuild(events);
    expect(state.cumulativeInputTokens).toBe(300);
    expect(state.cumulativeOutputTokens).toBe(60);
    expect(state.hasReceivedUsage).toBe(true);
    expect(rebuild([transition('INTAKE', 'PLANNING')]).hasReceivedUsage).toBe(false);
  });

  it('restores exact contract snapshots for custom states without deriving extra rounds', () => {
    const state = rebuild([
      transition('PLAN_REVIEW', 'CUSTOM', {
        iterationCounts: { custom_loop: 7 },
        judgeArbitrationCounts: { custom_loop: 2 },
      }),
      transition('CUSTOM', 'PLAN_REVIEW', {
        iterationCounts: { custom_loop: 7, plan_review_loop: 4 },
        judgeArbitrationCounts: {},
      }),
    ]);
    expect(state.iterationCounts).toEqual({ custom_loop: 7, plan_review_loop: 4 });
    expect(state.judgeArbitrationCounts).toEqual({});
  });

  it('resets review rounds on human rejection while preserving judge arbitration counts', () => {
    const events = [
      transition('PLANNING', 'PLAN_REVIEW'),
      transition('PLAN_REVIEW', 'JUDGE_REVIEW'),
    ];
    events.push({
      timestamp: '2026-01-01T00:00:01Z',
      runId,
      sequence: ++sequence,
      type: 'human_rejection',
      data: { kind: 'human', action: 'rejection', stateId: 'WAITING_FOR_HUMAN' },
    });
    events.push(transition('WAITING_FOR_HUMAN', 'PLAN_REVIEW'));
    const state = rebuild(events);
    expect(state.iterationCounts).toEqual({ plan_review_loop: 1 });
    expect(state.judgeArbitrationCounts).toEqual({ implementation_review_loop: 1 });
  });
});

describe('budget approval reconstruction', () => {
  it('restores budget authorization only from an explicit budget approval', () => {
    const humanEvent = (
      type: 'human_approval' | 'human_rejection',
      reason: string,
    ): JournalEvent => ({
      timestamp: '2026-01-01T00:00:01Z',
      runId,
      sequence: ++sequence,
      type,
      data: { kind: 'human', action: type, stateId: 'WAITING_FOR_HUMAN', reason },
    });
    expect(rebuild([humanEvent('human_approval', 'token_budget_exceeded')]).budgetApproved).toBe(
      true,
    );
    expect(
      rebuild([humanEvent('human_approval', 'governance_escalation')]).budgetApproved,
    ).toBeUndefined();
    expect(
      rebuild([humanEvent('human_rejection', 'token_budget_exceeded')]).budgetApproved,
    ).toBeUndefined();
  });
});

describe('terminal action reconstruction', () => {
  it('keeps terminal entry pending until a durable run completion event', () => {
    const entry = transition('WRAP_UP', 'DONE', { terminalActionsPending: true });
    const pending = rebuild([entry]);
    expect(pending.currentState).toBe('WRAP_UP');
    expect(pending.pendingTerminalState).toBe('DONE');
    const finished = rebuild([
      entry,
      {
        timestamp: '2026-01-01T00:00:02Z',
        runId,
        sequence: ++sequence,
        type: 'run_completed',
        data: {
          kind: 'run_lifecycle',
          workflowName: 'test',
          workflowVersion: '1',
          finalState: 'DONE',
        },
      },
    ]);
    expect(finished.currentState).toBe('DONE');
    expect(finished.pendingTerminalState).toBeUndefined();
  });

  it('retains pending cleanup through terminal failure fallback and tolerates legacy lifecycle events', () => {
    const pending = rebuild([
      transition('WORK', 'DONE', { terminalActionsPending: true }),
      transition('DONE', 'FAILED', { terminalActionsPending: true }),
    ]);
    expect(pending.currentState).toBe('WORK');
    expect(pending.pendingTerminalState).toBe('FAILED');
    expect(pending.terminalRecoveryState).toBe('WORK');
    expect(
      rebuild([
        transition('WORK', 'DONE'),
        {
          timestamp: '2026-01-01T00:00:02Z',
          runId,
          sequence: ++sequence,
          type: 'run_completed',
          data: { kind: 'run_lifecycle', workflowName: 'legacy', workflowVersion: '1' },
        },
      ]).currentState,
    ).toBe('DONE');
  });
});

describe('pending terminal transition routing', () => {
  it('retains cleanup through a manual pause and resume, and clears it on failure fallback without cleanup', () => {
    const events = [
      transition('WORK', 'DONE', { pendingTerminalState: 'DONE', terminalRecoveryState: 'WORK' }),
      transition('DONE', 'WAITING_FOR_HUMAN', {
        pendingTerminalState: 'DONE',
        terminalRecoveryState: 'WORK',
      }),
    ];
    expect(rebuild(events).currentState).toBe('WAITING_FOR_HUMAN');
    expect(rebuild(events).pendingTerminalState).toBe('DONE');
    events.push(
      transition('WAITING_FOR_HUMAN', 'WORK', {
        pendingTerminalState: 'DONE',
        terminalRecoveryState: 'WORK',
      }),
    );
    expect(rebuild(events).currentState).toBe('WORK');
    expect(rebuild(events).pendingTerminalState).toBe('DONE');
    events.push(transition('DONE', 'FAILED'));
    expect(rebuild(events).currentState).toBe('FAILED');
    expect(rebuild(events).pendingTerminalState).toBeUndefined();
  });
});

describe('workflow checkpoint journal reconstruction', () => {
  it.each(['worker_completed', 'worker_failed'] as const)(
    'atomically replays a %s session cursor and its usage',
    (type) => {
      const base = rebuild([transition('INTAKE', 'WORK')]);
      const continuation = {
        stateId: 'WORK',
        nextActionIndex: 1,
        completedResults: [
          { action: { type: 'notify_human' as const, params: {} }, success: true },
        ],
        completedExitResults: [
          {
            action: { type: 'dispatch_worker' as const, params: { role: 'planner' as const } },
            success: type === 'worker_completed',
          },
        ],
      };
      const snapshot: JournalEvent = {
        timestamp: '',
        runId,
        sequence: ++sequence,
        type: 'workflow_checkpoint',
        data: {
          kind: 'workflow_checkpoint',
          state: {
            ...base,
            cumulativeInputTokens: 10,
            waitingContext: {
              reason: 'live_session_awaiting_human',
              requiredInput: 'approval',
              requestingState: 'WORK',
              autoResumeSafe: false,
              presentedArtifacts: [],
              waitingSince: '',
              liveSessionId: 'session',
            },
          },
        },
      };
      const completion: JournalEvent = {
        timestamp: '',
        runId,
        sequence: ++sequence,
        type,
        data: {
          kind: 'worker',
          workerId: 'session',
          role: 'planner',
          stateId: 'WORK',
          status: type,
          inputTokens: 30,
          outputTokens: 20,
          entryActionContinuation: continuation,
        },
      };
      const state = rebuild([snapshot, completion]);
      expect(state.waitingContext).toBeUndefined();
      expect(state.entryActionContinuation).toEqual(continuation);
      expect(state.cumulativeInputTokens).toBe(40);
      expect(state.cumulativeOutputTokens).toBe(20);
      expect(snapshot.data.state.waitingContext?.liveSessionId).toBe('session');
    },
  );

  it('restores session metadata and cursors and applies later usage without double-counting transitions', () => {
    const state = rebuild([transition('INTAKE', 'WORK')]);
    const snapshot: JournalEvent = {
      timestamp: '2026-01-01T00:00:01Z',
      runId,
      sequence: ++sequence,
      type: 'workflow_checkpoint',
      data: {
        kind: 'workflow_checkpoint',
        state: {
          ...state,
          currentState: 'WAITING_FOR_HUMAN',
          transitionCount: 2,
          previousState: 'WORK',
          stateHistory: ['INTAKE', 'WORK', 'WAITING_FOR_HUMAN'],
          cumulativeInputTokens: 100,
          cumulativeOutputTokens: 50,
          waitingContext: {
            reason: 'live_session_awaiting_human',
            requiredInput: 'approval',
            requestingState: 'WORK',
            autoResumeSafe: false,
            presentedArtifacts: [],
            waitingSince: '',
            liveSessionId: 'session',
            pendingRequestId: 'request',
            sessionTransport: 'remote',
          },
          entryActionContinuation: { stateId: 'WORK', nextActionIndex: 1, completedResults: [] },
        },
      },
    };
    const response: JournalEvent = {
      timestamp: '2026-01-01T00:00:02Z',
      runId,
      sequence: ++sequence,
      type: 'human_input_received',
      data: {
        kind: 'human',
        action: 'session_resumed',
        stateId: 'WAITING_FOR_HUMAN',
        sessionId: 'session',
      },
    };
    const usage: JournalEvent = {
      timestamp: '2026-01-01T00:00:02Z',
      runId,
      sequence: ++sequence,
      type: 'worker_completed',
      data: {
        kind: 'worker',
        workerId: 'worker',
        stateId: 'WORK',
        role: 'planner',
        status: 'success',
        inputTokens: 20,
        outputTokens: 10,
      },
    };
    const recovered = rebuild([
      snapshot,
      transition('WORK', 'WAITING_FOR_HUMAN', { transitionCount: 2 }),
      response,
      usage,
    ]);
    expect(recovered.transitionCount).toBe(2);
    expect(recovered.stateHistory).toEqual(['INTAKE', 'WORK', 'WAITING_FOR_HUMAN']);
    expect(recovered.waitingContext?.liveSessionId).toBe('session');
    expect(recovered.entryActionContinuation?.nextActionIndex).toBe(1);
    expect(recovered.cumulativeInputTokens).toBe(120);
    expect(recovered.cumulativeOutputTokens).toBe(60);
  });

  it('clears optional control state omitted from a later serialized snapshot', () => {
    const state = rebuild([transition('WORK', 'DONE')]);
    const old: JournalEvent = {
      timestamp: '',
      runId,
      sequence: ++sequence,
      type: 'workflow_checkpoint',
      data: {
        kind: 'workflow_checkpoint',
        state: {
          ...state,
          pendingTerminalState: 'DONE',
          terminalRecoveryState: 'WORK',
          executionPaused: true,
          entryActionContinuation: { stateId: 'DONE', nextActionIndex: 1, completedResults: [] },
        },
      },
    };
    const latest: JournalEvent = {
      timestamp: '',
      runId,
      sequence: ++sequence,
      type: 'workflow_checkpoint',
      data: {
        kind: 'workflow_checkpoint',
        state: JSON.parse(JSON.stringify(state)) as typeof state,
      },
    };
    const recovered = rebuild([old, latest]);
    expect(recovered.pendingTerminalState).toBeUndefined();
    expect(recovered.entryActionContinuation).toBeUndefined();
    expect(recovered.executionPaused).toBeUndefined();
  });
});

describe('legacy session identity reconstruction', () => {
  it('retains the session identifier from older human input events', () => {
    const state = rebuild([
      transition('WORK', 'WAITING_FOR_HUMAN'),
      {
        timestamp: '',
        runId,
        sequence: ++sequence,
        type: 'human_input_requested',
        data: {
          kind: 'human',
          action: 'input_requested',
          stateId: 'WAITING_FOR_HUMAN',
          reason: 'live_session_awaiting_human',
          sessionId: 'legacy-session',
        },
      },
    ]);
    expect(state.waitingContext?.liveSessionId).toBe('legacy-session');
    expect(state.waitingContext?.autoResumeSafe).toBe(false);
  });
});

describe('checkpoint artifact inventory', () => {
  it('retains journaled artifacts when a control checkpoint has no inventory', () => {
    const state = rebuild([transition('INTAKE', 'WORK')]);
    const ref = { type: 'plan' as const, name: 'latest', version: 1, checksum: 'abc' };
    const first: JournalEvent = {
      timestamp: '',
      runId,
      sequence: ++sequence,
      type: 'workflow_checkpoint',
      data: {
        kind: 'workflow_checkpoint',
        state: { ...state, activeArtifacts: [ref], lastProducedArtifact: ref },
      },
    };
    const second: JournalEvent = {
      timestamp: '',
      runId,
      sequence: ++sequence,
      type: 'workflow_checkpoint',
      data: { kind: 'workflow_checkpoint', state },
    };
    expect(rebuild([first, second]).activeArtifacts).toEqual([ref]);
    expect(rebuild([first, second]).lastProducedArtifact).toEqual(ref);
  });
});
