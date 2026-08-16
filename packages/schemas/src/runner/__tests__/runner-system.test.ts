import { describe, expect, it } from 'vitest';

import {
  agentConstraintsSchema,
  agentResultSchema,
  agentSessionHandleSchema,
  agentSessionRefSchema,
  agentSessionSnapshotSchema,
  agentSessionStateSchema,
  agentTaskSchema,
  agentTokenUsageSchema,
  clarificationPayloadSchema,
  dispatchOverridesSchema,
  dispatchRequestSchema,
  dispatchResultSchema,
  dispatchStatusSchema,
  liveClarificationResponsePayloadSchema,
  livePermissionResponsePayloadSchema,
  permissionPayloadSchema,
  pollResponseSchema,
  reconnectMetaSchema,
  resolvedArtifactSchema,
  retryPolicySchema,
  sessionDispatchOutcomeSchema,
  sessionPendingRequestSchema,
  submitResponseSchema,
  workerConstraintsSchema,
  workerErrorSchema,
  workerErrorTypeSchema,
  workerInvocationRecordSchema,
  workerMetricsSchema,
  workerStatusSchema,
} from '../runner-system';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('agentSessionStateSchema', () => {
  it.each([
    'running',
    'awaiting_human',
    'paused',
    'reconnecting',
    'completed',
    'failed',
    'aborted',
    'orphaned',
  ])('accepts "%s"', (val) => {
    expect(agentSessionStateSchema.safeParse(val).success).toBe(true);
  });
});

describe('agentSessionRefSchema', () => {
  it('validates a session ref', () => {
    const data = {
      sessionId: 'sess-1',
      runId: 'r-1',
      stateId: 'IMPL',
      role: 'planner',
      transport: 'stdio',
    };
    expect(agentSessionRefSchema.safeParse(data).success).toBe(true);
  });
});

describe('permissionPayloadSchema', () => {
  it('validates a minimal permission payload', () => {
    const data = { action: 'file_write', resource: '/src/main.ts' };
    expect(permissionPayloadSchema.safeParse(data).success).toBe(true);
  });

  it('validates with all fields', () => {
    const data = {
      action: 'shell_execute',
      resource: 'npm test',
      detail: 'Running tests',
      riskLevel: 'medium',
      granted: true,
      reason: 'Safe command',
    };
    expect(permissionPayloadSchema.safeParse(data).success).toBe(true);
  });
});

describe('clarificationPayloadSchema', () => {
  it('validates a clarification payload', () => {
    const data = { question: 'What database to use?', context: 'DB selection phase' };
    expect(clarificationPayloadSchema.safeParse(data).success).toBe(true);
  });

  it('validates with options and answer', () => {
    const data = {
      question: 'Framework?',
      options: ['React', 'Vue', 'Svelte'],
      answer: 'React',
    };
    expect(clarificationPayloadSchema.safeParse(data).success).toBe(true);
  });
});

describe('sessionPendingRequestSchema (discriminated union)', () => {
  it('validates a permission request', () => {
    const data = {
      requestId: 'req-1',
      kind: 'permission',
      createdAt: '2026-01-01T00:00:00Z',
      payload: { action: 'file_write', resource: '/src/main.ts' },
    };
    expect(sessionPendingRequestSchema.safeParse(data).success).toBe(true);
  });

  it('validates a clarification request', () => {
    const data = {
      requestId: 'req-2',
      kind: 'clarification',
      createdAt: '2026-01-01T00:00:00Z',
      payload: { question: 'What to do?' },
    };
    expect(sessionPendingRequestSchema.safeParse(data).success).toBe(true);
  });
});

describe('reconnectMetaSchema (discriminated union)', () => {
  it('validates stdio reconnect', () => {
    const data = { type: 'stdio', pid: 12345 };
    expect(reconnectMetaSchema.safeParse(data).success).toBe(true);
  });

  it('validates remote reconnect', () => {
    const data = {
      type: 'remote',
      remoteSessionId: 'rsess-1',
      reconnectUrl: 'https://api.example.com/reconnect',
    };
    expect(reconnectMetaSchema.safeParse(data).success).toBe(true);
  });
});

describe('agentSessionSnapshotSchema', () => {
  it('validates a snapshot', () => {
    const data = {
      ref: {
        sessionId: 'sess-1',
        runId: 'r-1',
        stateId: 'IMPL',
        role: 'planner',
        transport: 'stdio',
      },
      state: 'running',
      pendingRequests: [],
      lastProtocolTimestamp: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(agentSessionSnapshotSchema.safeParse(data).success).toBe(true);
  });
});

describe('agentSessionHandleSchema', () => {
  it('validates a handle', () => {
    const data = {
      ref: {
        sessionId: 'sess-1',
        runId: 'r-1',
        stateId: 'IMPL',
        role: 'planner',
        transport: 'stdio',
      },
      state: 'completed',
      pendingRequests: [],
    };
    expect(agentSessionHandleSchema.safeParse(data).success).toBe(true);
  });
});

describe('sessionDispatchOutcomeSchema', () => {
  it.each(['completed', 'awaiting_human', 'session_active'])('accepts "%s"', (val) => {
    expect(sessionDispatchOutcomeSchema.safeParse(val).success).toBe(true);
  });
});

describe('resolvedArtifactSchema', () => {
  it('validates a resolved artifact', () => {
    const data = { ref: validRef, content: '# Plan content' };
    expect(resolvedArtifactSchema.safeParse(data).success).toBe(true);
  });
});

describe('workerConstraintsSchema', () => {
  it('validates constraints', () => {
    const data = { maxOutputTokens: 4096, timeout: 30000, requiredOutputType: 'plan' };
    expect(workerConstraintsSchema.safeParse(data).success).toBe(true);
  });
});

describe('dispatchOverridesSchema', () => {
  it('validates empty overrides', () => {
    expect(dispatchOverridesSchema.safeParse({}).success).toBe(true);
  });

  it('validates with timeout override', () => {
    const data = { timeout: 60000, maxRetries: 5 };
    expect(dispatchOverridesSchema.safeParse(data).success).toBe(true);
  });
});

describe('dispatchRequestSchema', () => {
  it('validates a dispatch request', () => {
    const data = {
      runId: 'run-123',
      stateId: 'IMPL',
      role: 'implementer',
      inputArtifacts: [validRef],
    };
    expect(dispatchRequestSchema.safeParse(data).success).toBe(true);
  });
});

describe('workerErrorTypeSchema', () => {
  it.each([
    'agent_error',
    'timeout',
    'invalid_output',
    'schema_violation',
    'ownership_violation',
    'cancelled',
  ])('accepts "%s"', (val) => {
    expect(workerErrorTypeSchema.safeParse(val).success).toBe(true);
  });
});

describe('workerErrorSchema', () => {
  it('validates a worker error', () => {
    const data = { type: 'timeout', message: 'Request timed out', retryable: true };
    expect(workerErrorSchema.safeParse(data).success).toBe(true);
  });
});

describe('workerMetricsSchema', () => {
  it('validates worker metrics', () => {
    const data = {
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:00:05Z',
      durationMs: 5000,
      inputTokens: 1000,
      outputTokens: 500,
      retryCount: 0,
      modelUsed: 'gpt-4',
    };
    expect(workerMetricsSchema.safeParse(data).success).toBe(true);
  });
});

describe('dispatchStatusSchema', () => {
  it.each(['success', 'failure', 'timeout', 'cancelled'])('accepts "%s"', (val) => {
    expect(dispatchStatusSchema.safeParse(val).success).toBe(true);
  });
});

describe('dispatchResultSchema', () => {
  it('validates a successful result', () => {
    const data = {
      workerId: 'w-1',
      role: 'implementer',
      status: 'success',
      outputArtifacts: [validRef],
      metrics: {
        startedAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:00:05Z',
        durationMs: 5000,
        inputTokens: 1000,
        outputTokens: 500,
        retryCount: 0,
        modelUsed: 'gpt-4',
      },
    };
    expect(dispatchResultSchema.safeParse(data).success).toBe(true);
  });

  it('validates a failed result with error', () => {
    const data = {
      workerId: 'w-1',
      role: 'implementer',
      status: 'failure',
      outputArtifacts: [],
      error: { type: 'agent_error', message: 'Crash', retryable: false },
      metrics: {
        startedAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:00:05Z',
        durationMs: 5000,
        inputTokens: 1000,
        outputTokens: 0,
        retryCount: 2,
        modelUsed: 'gpt-4',
      },
    };
    expect(dispatchResultSchema.safeParse(data).success).toBe(true);
  });
});

describe('workerStatusSchema', () => {
  it('validates worker status', () => {
    const data = {
      workerId: 'w-1',
      role: 'implementer',
      state: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      elapsedMs: 5000,
    };
    expect(workerStatusSchema.safeParse(data).success).toBe(true);
  });
});

describe('workerInvocationRecordSchema', () => {
  it('validates an invocation record', () => {
    const data = {
      timestamp: '2026-01-01T00:00:00Z',
      runId: 'run-123',
      workerId: 'w-1',
      stateId: 'IMPL',
      role: 'implementer',
      model: 'gpt-4',
      inputArtifacts: [validRef],
      outputArtifacts: [validRef],
      status: 'success',
      metrics: {
        startedAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:00:05Z',
        durationMs: 5000,
        inputTokens: 1000,
        outputTokens: 500,
        retryCount: 0,
        modelUsed: 'gpt-4',
      },
    };
    expect(workerInvocationRecordSchema.safeParse(data).success).toBe(true);
  });
});

describe('retryPolicySchema', () => {
  it('validates a retry policy', () => {
    const data = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
    };
    expect(retryPolicySchema.safeParse(data).success).toBe(true);
  });
});

describe('agentConstraintsSchema', () => {
  it('validates agent constraints', () => {
    const data = { timeout: 30000, requiredOutputType: 'plan' };
    expect(agentConstraintsSchema.safeParse(data).success).toBe(true);
  });
});

describe('agentTaskSchema', () => {
  it('validates a task', () => {
    const data = {
      taskId: 't-1',
      runId: 'r-1',
      stateId: 'IMPL',
      role: 'implementer',
      description: 'Implement the feature',
      inputArtifacts: [{ ref: validRef, content: '# Plan' }],
      repoRoot: '/home/user/project',
      runDir: '/home/user/project/.ai/runs/r-1',
      outputArtifactPath: '/home/user/project/.ai/runs/r-1/output.md',
      constraints: { timeout: 30000, requiredOutputType: 'implementation' },
    };
    expect(agentTaskSchema.safeParse(data).success).toBe(true);
  });
});

describe('agentTokenUsageSchema', () => {
  it('validates token usage', () => {
    expect(agentTokenUsageSchema.safeParse({ inputTokens: 1000, outputTokens: 500 }).success).toBe(
      true,
    );
  });
});

describe('agentResultSchema', () => {
  it('validates a successful result', () => {
    const data = {
      taskId: 't-1',
      status: 'success',
      artifactContent: '# Implementation',
      durationMs: 5000,
      tokenUsage: { inputTokens: 1000, outputTokens: 500 },
    };
    expect(agentResultSchema.safeParse(data).success).toBe(true);
  });

  it('validates a failed result', () => {
    const data = {
      taskId: 't-1',
      status: 'failure',
      error: 'Model crashed',
      durationMs: 1000,
    };
    expect(agentResultSchema.safeParse(data).success).toBe(true);
  });
});

describe('livePermissionResponsePayloadSchema', () => {
  it('validates a response', () => {
    const data = { granted: true, reason: 'Safe operation' };
    expect(livePermissionResponsePayloadSchema.safeParse(data).success).toBe(true);
  });

  it('validates empty (loose schema)', () => {
    expect(livePermissionResponsePayloadSchema.safeParse({}).success).toBe(true);
  });
});

describe('liveClarificationResponsePayloadSchema', () => {
  it('validates a response', () => {
    expect(
      liveClarificationResponsePayloadSchema.safeParse({ answer: 'Use PostgreSQL' }).success,
    ).toBe(true);
  });
});

describe('submitResponseSchema', () => {
  it('validates a submit response', () => {
    expect(submitResponseSchema.safeParse({ taskId: 't-1' }).success).toBe(true);
  });
});

describe('pollResponseSchema', () => {
  it('validates a running poll response', () => {
    expect(pollResponseSchema.safeParse({ status: 'running' }).success).toBe(true);
  });

  it('validates a completed poll response', () => {
    const data = {
      status: 'completed',
      result: { taskId: 't-1', status: 'success', artifactContent: 'done', durationMs: 1000 },
    };
    expect(pollResponseSchema.safeParse(data).success).toBe(true);
  });
});
