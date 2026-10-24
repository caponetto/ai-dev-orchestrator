import { createRunId } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { ExecutionAccounting } from '../execution-accounting';
import { buildWorkflowCheckpoint } from '../workflow-checkpoint';

function input(): Parameters<typeof buildWorkflowCheckpoint>[0] {
  return {
    runId: createRunId('checkpoint'),
    config: null,
    accounting: new ExecutionAccounting(),
    iterationCounts: { review: 2 },
    judgeArbitrationCounts: { review: 1 },
    dispatchCounter: 7,
    progress: {
      currentState: 'WORK',
      previousState: null,
      stateEnteredAt: '2026-10-23T00:00:00Z',
      transitionCount: 1,
      stateHistory: ['WORK'],
      lastHumanFeedback: null,
      lastReviewContent: null,
      lastTrigger: null,
      waitingContext: null,
      budgetApproved: false,
      executionPaused: false,
      pendingTerminalState: null,
      terminalRecoveryState: null,
      governanceDecisionCount: 3,
      escalationCount: 1,
      stateTimestamps: [{ stateId: 'WORK', enteredAt: 'start', exitedAt: 'end' }],
      interruptedActionResults: null,
      entryActionContinuation: null,
    },
  };
}

describe('workflow checkpoint serialization', () => {
  it('retains the accepted answer receipt independently of transient worker feedback', () => {
    const snapshot = input();
    const lastHumanAnswer = {
      stateId: 'WAIT',
      requestingState: 'WORK',
      waitingSince: 'wait-1',
      content: 'accepted',
    };
    expect(
      buildWorkflowCheckpoint({ ...snapshot, progress: { ...snapshot.progress, lastHumanAnswer } })
        .lastHumanAnswer,
    ).toEqual(lastHumanAnswer);
  });
  it('preserves schema defaults and execution counters while omitting absent continuation state', () => {
    const checkpoint = buildWorkflowCheckpoint(input());
    expect(checkpoint).toMatchObject({
      schemaVersion: 2,
      persistenceVersion: 1,
      checksum: '',
      workflowName: 'default',
      workflowVersion: '1.0.0',
      currentState: 'WORK',
      transitionCount: 1,
      stateHistory: ['WORK'],
      iterationCounts: { review: 2 },
      judgeArbitrationCounts: { review: 1 },
      dispatchCounter: 7,
      governanceDecisionCount: 3,
      escalationCount: 1,
      cumulativeInputTokens: 0,
      cumulativeOutputTokens: 0,
      activeArtifacts: [],
      lastProducedArtifact: null,
    });
    expect(checkpoint.waitingContext).toBeUndefined();
    expect(checkpoint.lastHumanFeedback).toBeUndefined();
    expect(checkpoint.entryActionContinuation).toBeUndefined();
  });

  it('retains saved workflow metadata, feedback, waits and action cursors', () => {
    const base = input();
    const waiting = {
      reason: 'manual_pause' as const,
      requiredInput: 'approval' as const,
      requestingState: 'WORK',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: '2026-10-23T00:00:00Z',
    };
    const continuation = { stateId: 'DONE', completedResults: [], nextActionIndex: 1 };
    const checkpoint = buildWorkflowCheckpoint({
      ...base,
      config: {
        runId: 'checkpoint',
        workflowDefinition: {
          name: 'saved',
          version: '2',
          initialState: 'WORK',
          terminalStates: [],
          states: {},
        },
        sources: [],
        governancePolicy: {},
        roleAssignments: {},
        repoRoot: '/repo',
      },
      progress: {
        ...base.progress,
        lastHumanFeedback: 'answer',
        lastReviewContent: 'findings',
        lastTrigger: 'review_rejected',
        waitingContext: waiting,
        budgetApproved: true,
        executionPaused: true,
        pendingTerminalState: 'DONE',
        terminalRecoveryState: 'WORK',
        entryActionContinuation: continuation,
        interruptedActionResults: [],
      },
    });
    expect(checkpoint).toMatchObject({
      workflowName: 'saved',
      workflowVersion: '2',
      repoRoot: '/repo',
      lastHumanFeedback: 'answer',
      lastReviewContent: 'findings',
      lastTrigger: 'review_rejected',
      waitingContext: waiting,
      budgetApproved: true,
      executionPaused: true,
      pendingTerminalState: 'DONE',
      terminalRecoveryState: 'WORK',
      entryActionContinuation: continuation,
      interruptedActionResults: [],
    });
  });

  it('copies metric, history and timing values so later execution cannot change a saved snapshot', () => {
    const base = input();
    const accounting = new ExecutionAccounting();
    accounting.restore({
      workerMetricsByRole: {
        planner: {
          inputTokens: 4,
          outputTokens: 2,
          dispatches: 1,
          durationMs: 10,
          artifactsProduced: 0,
        },
      },
      cumulativeInputTokens: 4,
      cumulativeOutputTokens: 2,
    });
    const history = ['WORK'];
    const timing = { stateId: 'WORK', enteredAt: 'start', exitedAt: 'end' };
    const checkpoint = buildWorkflowCheckpoint({
      ...base,
      accounting,
      progress: { ...base.progress, stateHistory: history, stateTimestamps: [timing] },
    });
    accounting.reset();
    history.push('DONE');
    timing.exitedAt = 'later';
    expect(checkpoint.workerMetricsByRole?.['planner']?.inputTokens).toBe(4);
    expect(checkpoint.stateHistory).toEqual(['WORK']);
    expect(checkpoint.stateTimestamps?.[0]?.exitedAt).toBe('end');
  });
});
