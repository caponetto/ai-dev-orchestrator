import { describe, expect, it } from 'vitest';

import {
  budgetExhaustionContextSchema,
  entryActionContinuationSchema,
  lockHandleSchema,
  persistedStateSchema,
  persistedWaitingContextSchema,
  stateValidationResultSchema,
} from '../state-persistence';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('entryActionContinuationSchema', () => {
  it('preserves completed actions and dispatch context for a resumed state', () => {
    const continuation = {
      stateId: 'PLAN_REVIEW',
      nextActionIndex: 1,
      completedResults: [
        {
          action: { type: 'dispatch_worker', params: { role: 'plan_reviewer' } },
          success: true,
          sessionOutcome: 'awaiting_human',
          sessionRef: { sessionId: 's1' },
        },
      ],
      completedExitResults: [
        { action: { type: 'record_journal', params: { event: 'run_resumed' } }, success: true },
      ],
      humanFeedback: 'Check transactions',
      previousReviewContent: 'Earlier findings',
      iterationCount: 2,
      resumeInput: { type: 'text', content: 'Use PostgreSQL' },
      resumeWaitingContext: {
        reason: 'clarification_needed',
        requiredInput: 'text',
        requestingState: 'REFINEMENT',
        autoResumeSafe: false,
        presentedArtifacts: [],
        waitingSince: '2026-01-01T00:00:00Z',
      },
    };
    expect(entryActionContinuationSchema.parse(JSON.parse(JSON.stringify(continuation)))).toEqual(
      continuation,
    );
  });

  it.each([-1, 0.5])('rejects invalid action cursor %s', (nextActionIndex) => {
    expect(
      entryActionContinuationSchema.safeParse({
        stateId: 'PLAN_REVIEW',
        completedResults: [],
        nextActionIndex,
      }).success,
    ).toBe(false);
  });
});

describe('budgetExhaustionContextSchema', () => {
  it('validates a budget exhaustion context', () => {
    const data = {
      limitType: 'token',
      current: 95000,
      limit: 100000,
      cumulativeTokens: 95000,
    };
    expect(budgetExhaustionContextSchema.safeParse(data).success).toBe(true);
  });

  it('validates with optional role', () => {
    const data = {
      limitType: 'token',
      current: 50000,
      limit: 100000,
      role: 'implementer',
      cumulativeTokens: 50000,
    };
    expect(budgetExhaustionContextSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid limitType', () => {
    const data = { limitType: 'memory', current: 100, limit: 200, cumulativeTokens: 100 };
    expect(budgetExhaustionContextSchema.safeParse(data).success).toBe(false);
  });
});

describe('persistedWaitingContextSchema', () => {
  it('validates a minimal waiting context', () => {
    const data = {
      reason: 'Need human approval',
      requiredInput: 'approval',
      requestingState: 'WAIT_FOR_HUMAN',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: '2026-01-01T00:00:00Z',
    };
    expect(persistedWaitingContextSchema.safeParse(data).success).toBe(true);
  });

  it('validates with all optional fields', () => {
    const data = {
      reason: 'Budget exceeded',
      requiredInput: 'approval',
      requestingState: 'IMPL',
      autoResumeSafe: true,
      presentedArtifacts: [validRef],
      waitingSince: '2026-01-01T00:00:00Z',
      budgetExhaustion: {
        limitType: 'token',
        current: 95000,
        limit: 100000,
        cumulativeTokens: 95000,
      },
      liveSessionId: 'sess-1',
      pendingRequestId: 'req-1',
      liveRequestType: 'permission',
      sessionTransport: 'stdio',
    };
    expect(persistedWaitingContextSchema.safeParse(data).success).toBe(true);
  });
});

describe('persistedStateSchema', () => {
  it('validates a minimal persisted state', () => {
    const data = {
      runId: 'run-123',
      schemaVersion: 1,
      currentState: 'IMPLEMENTATION',
      previousState: null,
      stateEnteredAt: '2026-01-01T00:00:00Z',
      transitionCount: 3,
      stateHistory: ['SPECIFICATION', 'PLANNING', 'IMPLEMENTATION'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: '2026-01-01T00:00:00Z',
      persistenceVersion: 1,
      checksum: 'sha256-abc',
    };
    expect(persistedStateSchema.safeParse(data).success).toBe(true);
    const lastHumanAnswer = {
      stateId: 'WAIT',
      requestingState: 'WORK',
      waitingSince: 'wait-1',
      content: 'accepted',
    };
    expect(persistedStateSchema.parse({ ...data, lastHumanAnswer }).lastHumanAnswer).toEqual(
      lastHumanAnswer,
    );
    expect(
      persistedStateSchema.safeParse({
        ...data,
        lastHumanAnswer: { ...lastHumanAnswer, content: 42 },
      }).success,
    ).toBe(false);
  });

  it('validates with all optional fields', () => {
    const data = {
      runId: 'run-123',
      schemaVersion: 1,
      repoRoot: '/home/user/project',
      currentState: 'CODE_REVIEW',
      previousState: 'IMPLEMENTATION',
      stateEnteredAt: '2026-01-01T00:01:00Z',
      transitionCount: 5,
      stateHistory: ['SPEC', 'PLAN', 'IMPL', 'REVIEW'],
      iterationCounts: { 'review-1': 2 },
      judgeArbitrationCounts: { 'review-1': 1 },
      activeArtifacts: [validRef],
      lastProducedArtifact: validRef,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: '2026-01-01T00:01:00Z',
      persistenceVersion: 2,
      checksum: 'sha256-def',
      cumulativeInputTokens: 10000,
      cumulativeOutputTokens: 5000,
      hasReceivedUsage: true,
      budgetApproved: true,
      executionPaused: true,
      pendingTerminalState: 'DONE',
      terminalRecoveryState: 'CODE_REVIEW',
      governanceDecisionCount: 3,
      escalationCount: 1,
      workerMetricsByRole: {
        architect: {
          inputTokens: 5000,
          outputTokens: 2000,
          dispatches: 2,
          durationMs: 10000,
          artifactsProduced: 1,
        },
      },
      firedThresholdIndex: 1,
      lastHumanFeedback: 'Looks good',
      lastReviewContent: '# Review\nAll good',
      lastTrigger: 'completion',
      stateTimestamps: [
        { stateId: 'SPEC', enteredAt: '2026-01-01T00:00:00Z', exitedAt: '2026-01-01T00:00:30Z' },
      ],
    };
    expect(persistedStateSchema.parse(data)).toEqual(data);
  });

  it('rejects missing required fields', () => {
    expect(persistedStateSchema.safeParse({ runId: 'r-1' }).success).toBe(false);
  });
});

describe('stateValidationResultSchema', () => {
  it('validates a passing result', () => {
    expect(
      stateValidationResultSchema.safeParse({ valid: true, errors: [], warnings: [] }).success,
    ).toBe(true);
  });

  it('validates a failing result', () => {
    const data = {
      valid: false,
      errors: ['Invalid checksum'],
      warnings: ['Old schema version'],
    };
    expect(stateValidationResultSchema.safeParse(data).success).toBe(true);
  });
});

describe('lockHandleSchema', () => {
  it('preserves an acquisition token while accepting legacy handles without one', () => {
    const data = {
      runId: 'run-123',
      pid: 12345,
      acquiredAt: '2026-01-01T00:00:00Z',
      lockPath: '/tmp/lock',
      hostname: 'dev-machine',
    };
    expect(lockHandleSchema.parse(data)).toEqual(data);
    const tokenized = { ...data, ownershipToken: 'f3d2b1a0-1234-4234-9234-123456789abc' };
    expect(lockHandleSchema.parse(tokenized)).toEqual(tokenized);
    expect(lockHandleSchema.safeParse({ ...data, ownershipToken: '' }).success).toBe(false);
  });

  it('validates a lock handle', () => {
    const data = {
      runId: 'run-123',
      pid: 12345,
      acquiredAt: '2026-01-01T00:00:00Z',
      lockPath: '/tmp/lock',
      hostname: 'dev-machine',
    };
    expect(lockHandleSchema.safeParse(data).success).toBe(true);
  });
});
