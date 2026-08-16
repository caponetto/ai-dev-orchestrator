import { describe, expect, it } from 'vitest';

import {
  checkpointRestoredDataSchema,
  checkpointSavedDataSchema,
  eventBusConfigSchema,
  eventFilterSchema,
  eventInputSchema,
  eventSchema,
  eventSourceSchema,
  eventTypeSchema,
  runAbortedDataSchema,
  runCompletedDataSchema,
  runPausedDataSchema,
  runResumedDataSchema,
  runStartedDataSchema,
  stateEnteredDataSchema,
  stateExitedDataSchema,
  subscriptionOptionsSchema,
  subscriptionSchema,
  systemErrorDataSchema,
  systemWarningDataSchema,
  transitionCompletedDataSchema,
  transitionDeniedDataSchema,
  transitionRequestedDataSchema,
  workerCancelledDataSchema,
  workerCompletedDataSchema,
  workerDispatchedDataSchema,
  workerFailedDataSchema,
  workerRetriedDataSchema,
  workerTimeoutDataSchema,
} from '../event-system';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('eventTypeSchema', () => {
  it('accepts valid event types', () => {
    expect(eventTypeSchema.safeParse('run.started').success).toBe(true);
    expect(eventTypeSchema.safeParse('worker.dispatched').success).toBe(true);
    expect(eventTypeSchema.safeParse('system.error').success).toBe(true);
  });

  it('rejects unknown event type', () => {
    expect(eventTypeSchema.safeParse('run.unknown').success).toBe(false);
  });
});

describe('eventSourceSchema', () => {
  it('accepts valid sources', () => {
    expect(eventSourceSchema.safeParse('workflow_engine').success).toBe(true);
    expect(eventSourceSchema.safeParse('governance').success).toBe(true);
  });

  it('rejects unknown source', () => {
    expect(eventSourceSchema.safeParse('unknown_source').success).toBe(false);
  });
});

describe('eventFilterSchema', () => {
  it('validates an empty filter (all optional)', () => {
    expect(eventFilterSchema.safeParse({}).success).toBe(true);
  });

  it('validates with types and source', () => {
    const data = { types: ['run.started', 'run.completed'], source: 'workflow_engine' };
    expect(eventFilterSchema.safeParse(data).success).toBe(true);
  });
});

describe('subscriptionOptionsSchema', () => {
  it('validates sync mode', () => {
    expect(subscriptionOptionsSchema.safeParse({ mode: 'sync' }).success).toBe(true);
  });

  it('validates async mode with priority', () => {
    const data = { mode: 'async', priority: 10, name: 'my-sub' };
    expect(subscriptionOptionsSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid mode', () => {
    expect(subscriptionOptionsSchema.safeParse({ mode: 'batch' }).success).toBe(false);
  });
});

describe('subscriptionSchema', () => {
  it('validates a subscription', () => {
    const data = {
      id: 'sub-1',
      filter: { types: ['run.started'] },
      options: { mode: 'async' },
    };
    expect(subscriptionSchema.safeParse(data).success).toBe(true);
  });
});

describe('eventBusConfigSchema', () => {
  it('validates empty config (all optional)', () => {
    expect(eventBusConfigSchema.safeParse({}).success).toBe(true);
  });

  it('validates full config', () => {
    const data = {
      syncTimeout: 5000,
      asyncTimeout: 30000,
      maxAsyncQueueSize: 1000,
      overflowStrategy: 'drop-oldest',
      maxConsecutiveFailures: 5,
    };
    expect(eventBusConfigSchema.safeParse(data).success).toBe(true);
  });
});

describe('run event data schemas', () => {
  it('validates runStartedDataSchema', () => {
    const data = {
      config: { workflow: 'default', repository: 'my-repo', sourceType: 'git' },
    };
    expect(runStartedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates runCompletedDataSchema', () => {
    const data = {
      outcome: 'success',
      artifactCount: 10,
      totalDurationMs: 60000,
      totalTokens: { input: 5000, output: 3000 },
    };
    expect(runCompletedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates runAbortedDataSchema', () => {
    const data = {
      reason: 'User cancelled',
      abortedBy: 'user',
      lastState: 'IMPLEMENTATION',
    };
    expect(runAbortedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates runResumedDataSchema', () => {
    const data = {
      resumedFromState: 'CODE_REVIEW',
      checkpointTimestamp: '2026-01-01T00:00:00Z',
      eventsReplayed: 42,
    };
    expect(runResumedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates runPausedDataSchema', () => {
    const data = { reason: 'human_input_required', pausedInState: 'WAIT_FOR_HUMAN' };
    expect(runPausedDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('state event data schemas', () => {
  it('validates stateEnteredDataSchema', () => {
    const data = { stateId: 'IMPL', stateType: 'action', entryActionsCount: 2 };
    expect(stateEnteredDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates stateExitedDataSchema', () => {
    const data = { stateId: 'IMPL', durationMs: 5000 };
    expect(stateExitedDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('transition event data schemas', () => {
  it('validates transitionRequestedDataSchema', () => {
    const data = { from: 'A', to: 'B', trigger: 'completion', guardsToEvaluate: 2 };
    expect(transitionRequestedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates transitionCompletedDataSchema', () => {
    const data = {
      from: 'A',
      to: 'B',
      trigger: 'completion',
      guardsEvaluated: 2,
      guardsPassed: 2,
      governanceConsulted: true,
      durationMs: 100,
    };
    expect(transitionCompletedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates transitionDeniedDataSchema', () => {
    const data = {
      from: 'A',
      to: 'B',
      trigger: 'completion',
      deniedBy: 'guard',
      reason: 'Artifact missing',
    };
    expect(transitionDeniedDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('worker event data schemas', () => {
  it('validates workerDispatchedDataSchema', () => {
    const data = {
      workerId: 'w-1',
      role: 'architect',
      model: 'gpt-4',
      inputArtifacts: [validRef],
    };
    expect(workerDispatchedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates workerCompletedDataSchema', () => {
    const data = {
      workerId: 'w-1',
      role: 'architect',
      model: 'gpt-4',
      outputArtifacts: [validRef],
      durationMs: 5000,
      inputTokens: 1000,
      outputTokens: 500,
      repairAttempts: 0,
    };
    expect(workerCompletedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates workerFailedDataSchema', () => {
    const data = {
      workerId: 'w-1',
      role: 'implementer',
      error: 'Timeout',
      errorCategory: 'timeout',
      durationMs: 30000,
      inputTokens: 1000,
      outputTokens: 0,
      willRetry: true,
    };
    expect(workerFailedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates workerRetriedDataSchema', () => {
    const data = {
      workerId: 'w-1',
      role: 'implementer',
      attempt: 2,
      maxAttempts: 3,
      retryReason: 'Transient failure',
      backoffMs: 2000,
    };
    expect(workerRetriedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates workerCancelledDataSchema', () => {
    const data = {
      workerId: 'w-1',
      role: 'reviewer',
      cancelledBy: 'user',
      reason: 'User aborted',
    };
    expect(workerCancelledDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates workerTimeoutDataSchema', () => {
    const data = { workerId: 'w-1', role: 'reviewer', timeoutMs: 30000, elapsedMs: 30001 };
    expect(workerTimeoutDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('checkpoint event data schemas', () => {
  it('validates checkpointSavedDataSchema', () => {
    const data = {
      checkpointId: 'cp-1',
      currentState: 'IMPL',
      artifactCount: 5,
      sizeBytes: 10240,
    };
    expect(checkpointSavedDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates checkpointRestoredDataSchema', () => {
    const data = {
      checkpointId: 'cp-1',
      restoredToState: 'IMPL',
      eventsSinceCheckpoint: 10,
    };
    expect(checkpointRestoredDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('system event data schemas', () => {
  it('validates systemErrorDataSchema', () => {
    const data = {
      component: 'artifact_system',
      message: 'Disk full',
      recoverable: false,
    };
    expect(systemErrorDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates systemWarningDataSchema', () => {
    const data = {
      component: 'policy_engine',
      message: 'High memory usage',
      suggestion: 'Increase limits',
    };
    expect(systemWarningDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('eventInputSchema', () => {
  it('validates a run.started event input', () => {
    const data = {
      type: 'run.started',
      data: {
        config: { workflow: 'default', repository: 'my-repo', sourceType: 'git' },
      },
      source: 'workflow_engine',
    };
    expect(eventInputSchema.safeParse(data).success).toBe(true);
  });
});

describe('eventSchema', () => {
  it('validates a full event', () => {
    const data = {
      type: 'system.warning',
      data: { component: 'x', message: 'y' },
      source: 'system',
      id: 'evt-1',
      runId: 'r-1',
      sequence: 42,
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(eventSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing id', () => {
    const data = {
      type: 'system.warning',
      data: { component: 'x', message: 'y' },
      source: 'system',
      runId: 'r-1',
      sequence: 1,
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(eventSchema.safeParse(data).success).toBe(false);
  });
});
