import { describe, expect, it } from 'vitest';

import { healthResponseSchema, runSummaryViewArraySchema } from '../dashboard-api';
import { workflowStateViewSchema } from '../dashboard-domain';

describe('array schemas', () => {
  it('validates an array of run summaries', () => {
    const data = [
      {
        runId: 'r-1',
        repository: 'test',
        workflow: 'default',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:01:00Z',
        durationMs: 60000,
        totalArtifacts: 5,
        totalTokens: 1000,
        totalInputTokens: 600,
        totalOutputTokens: 400,
        finalState: 'DONE',
      },
    ];
    const parsed = runSummaryViewArraySchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });
});

describe('healthResponseSchema', () => {
  it('validates a full health response', () => {
    const data = {
      status: 'healthy',
      clients: 2,
      subsystems: [
        {
          name: 'artifact-store',
          status: 'healthy',
          lastCheckedAt: '2026-01-01T00:00:00Z',
          consecutiveFailures: 0,
          message: 'OK',
        },
      ],
      timestamp: '2026-01-01T00:00:00Z',
      uptimeMs: 5000,
      runStats: {
        total: 10,
        active: 1,
        completed: 8,
        failed: 1,
        avgDurationMs: 30000,
        latestRun: 'r-10',
      },
    };
    const parsed = healthResponseSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it('validates a minimal health response', () => {
    const data = {
      status: 'healthy',
      clients: 0,
      subsystems: [],
      timestamp: '2026-01-01T00:00:00Z',
    };
    const parsed = healthResponseSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });
});

describe('workflowStateViewSchema', () => {
  it('validates a workflow with parallel state info', () => {
    const data = {
      runId: 'r-1',
      states: [
        {
          id: 'CODE_REVIEW',
          type: 'parallel',
          label: 'Code Review',
          visited: true,
          current: false,
          timeSpentMs: 5000,
          visitCount: 1,
          parallelInfo: { type: 'fork', parallelRoles: ['static_reviewer', 'design_reviewer'] },
          roles: ['static_reviewer', 'design_reviewer'],
        },
      ],
      transitions: [
        {
          from: 'IMPLEMENTATION',
          to: 'CODE_REVIEW',
          trigger: 'done',
          traversed: true,
          traversalCount: 1,
        },
      ],
      currentState: 'CODE_REVIEW',
      visitedStates: ['SPECIFICATION', 'IMPLEMENTATION', 'CODE_REVIEW'],
      stateHistory: ['SPECIFICATION', 'IMPLEMENTATION', 'CODE_REVIEW'],
    };
    const parsed = workflowStateViewSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });
});
