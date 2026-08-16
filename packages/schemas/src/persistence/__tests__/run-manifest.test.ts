import { describe, expect, it } from 'vitest';

import {
  manifestArtifactSummarySchema,
  manifestBudgetSummarySchema,
  manifestContextSchema,
  manifestIterationSummarySchema,
  manifestTimingSchema,
  manifestTokenUsageSchema,
  manifestWorkflowInfoSchema,
  roleUsageSchema,
  runManifestSchema,
  stateTimingSchema,
  stateVisitSchema,
} from '../run-manifest';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('manifestWorkflowInfoSchema', () => {
  it('validates workflow info', () => {
    expect(
      manifestWorkflowInfoSchema.safeParse({ name: 'default', version: '1.0.0' }).success,
    ).toBe(true);
  });
});

describe('stateVisitSchema', () => {
  it('validates a state visit', () => {
    const data = {
      stateId: 'IMPL',
      enteredAt: '2026-01-01T00:00:00Z',
      exitedAt: '2026-01-01T00:01:00Z',
      durationMs: 60000,
    };
    expect(stateVisitSchema.safeParse(data).success).toBe(true);
  });
});

describe('stateTimingSchema', () => {
  it('validates state timing', () => {
    const data = {
      stateId: 'IMPL',
      enteredAt: '2026-01-01T00:00:00Z',
      exitedAt: '2026-01-01T00:01:00Z',
      durationMs: 60000,
      visits: 2,
    };
    expect(stateTimingSchema.safeParse(data).success).toBe(true);
  });
});

describe('manifestTimingSchema', () => {
  it('validates manifest timing', () => {
    const data = {
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:10:00Z',
      totalDurationMs: 600000,
      stateTimings: [],
    };
    expect(manifestTimingSchema.safeParse(data).success).toBe(true);
  });

  it('validates with optional stateTrace', () => {
    const data = {
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:10:00Z',
      totalDurationMs: 600000,
      stateTimings: [],
      stateTrace: [
        {
          stateId: 'SPEC',
          enteredAt: '2026-01-01T00:00:00Z',
          exitedAt: '2026-01-01T00:01:00Z',
          durationMs: 60000,
        },
      ],
    };
    expect(manifestTimingSchema.safeParse(data).success).toBe(true);
  });
});

describe('roleUsageSchema', () => {
  it('validates role usage', () => {
    const data = {
      role: 'architect',
      dispatches: 3,
      inputTokens: 5000,
      outputTokens: 3000,
      totalDurationMs: 15000,
      artifactsProduced: 2,
    };
    expect(roleUsageSchema.safeParse(data).success).toBe(true);
  });
});

describe('manifestArtifactSummarySchema', () => {
  it('validates a manifest artifact summary', () => {
    const data = {
      ref: validRef,
      producedBy: 'architect',
      createdAt: '2026-01-01T00:00:00Z',
      sizeBytes: 1024,
    };
    expect(manifestArtifactSummarySchema.safeParse(data).success).toBe(true);
  });
});

describe('manifestIterationSummarySchema', () => {
  it('validates iteration summary', () => {
    const data = {
      contractId: 'review-1',
      totalIterations: 3,
      judgeArbitrations: 1,
      finalStatus: 'resolved',
      findingsTotal: 5,
      findingsResolved: 5,
    };
    expect(manifestIterationSummarySchema.safeParse(data).success).toBe(true);
  });
});

describe('manifestTokenUsageSchema', () => {
  it('validates token usage', () => {
    const data = {
      totalInputTokens: 10000,
      totalOutputTokens: 5000,
      totalTokens: 15000,
      byRole: {
        architect: { input: 5000, output: 2000 },
        implementer: { input: 5000, output: 3000 },
      },
    };
    expect(manifestTokenUsageSchema.safeParse(data).success).toBe(true);
  });
});

describe('manifestBudgetSummarySchema', () => {
  it('validates with configured max', () => {
    const data = { configuredMaxTokens: 100000, budgetExceeded: false };
    expect(manifestBudgetSummarySchema.safeParse(data).success).toBe(true);
  });

  it('validates with null max', () => {
    const data = { configuredMaxTokens: null, budgetExceeded: false };
    expect(manifestBudgetSummarySchema.safeParse(data).success).toBe(true);
  });
});

describe('runManifestSchema', () => {
  it('validates a full run manifest', () => {
    const data = {
      runId: 'run-123',
      version: '1.0.0',
      repository: 'my-repo',
      workflow: { name: 'default', version: '1.0.0' },
      timing: {
        startedAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:10:00Z',
        totalDurationMs: 600000,
        stateTimings: [],
      },
      status: 'completed',
      finalState: 'DONE',
      activeRoles: [],
      artifactInventory: [],
      totalArtifacts: 0,
      totalArtifactSizeBytes: 0,
      iterations: [],
      governanceDecisions: 2,
      escalations: 0,
      humanInterventions: 0,
      agreements: [],
      tokenUsage: {
        totalInputTokens: 10000,
        totalOutputTokens: 5000,
        totalTokens: 15000,
        byRole: {},
      },
    };
    expect(runManifestSchema.safeParse(data).success).toBe(true);
  });
});

describe('manifestContextSchema', () => {
  it('validates a manifest context', () => {
    const data = {
      runId: 'run-123',
      config: {
        startedAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:10:00Z',
        governanceDecisions: 2,
        escalations: 0,
        iterations: [],
        stateTimestamps: [],
      },
      stateHistory: ['SPEC', 'IMPL', 'DONE'],
      artifactInventory: [validRef],
      journalPath: '/tmp/journal.jsonl',
      workerMetrics: {
        architect: {
          inputTokens: 5000,
          outputTokens: 2000,
          dispatches: 2,
          durationMs: 10000,
          artifactsProduced: 1,
        },
      },
    };
    expect(manifestContextSchema.safeParse(data).success).toBe(true);
  });
});
