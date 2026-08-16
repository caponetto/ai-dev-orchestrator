import { describe, expect, it } from 'vitest';

import {
  artifactContentViewSchema,
  artifactDetailViewSchema,
  artifactEntryViewSchema,
  artifactInventoryViewSchema,
  contractProgressViewSchema,
  dashboardEventSchema,
  dashboardEventTypeSchema,
  dashboardSessionViewSchema,
  dashboardWaitingContextSchema,
  findingEntryViewSchema,
  findingsViewSchema,
  iterationProgressViewSchema,
  parallelInfoSchema,
  projectSettingsViewSchema,
  roleUsageViewSchema,
  runConfigViewSchema,
  runStateViewSchema,
  runStatusSchema,
  runSummaryViewSchema,
  settingsGovernanceSchema,
  settingsPermissionPolicySchema,
  settingsRoleAssignmentSchema,
  stateNodeSchema,
  subsystemHealthViewSchema,
  systemHealthViewSchema,
  transitionEdgeSchema,
  usageBreakdownViewSchema,
} from '../dashboard-domain';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('runStatusSchema', () => {
  it.each(['running', 'paused', 'waiting', 'completed', 'aborted', 'failed', 'interrupted'])(
    'accepts "%s"',
    (s) => {
      expect(runStatusSchema.safeParse(s).success).toBe(true);
    },
  );

  it('rejects unknown status', () => {
    expect(runStatusSchema.safeParse('pending').success).toBe(false);
  });
});

describe('dashboardWaitingContextSchema', () => {
  it('validates a minimal waiting context', () => {
    const data = {
      reason: 'Need approval',
      requiredInput: 'approval',
      requestingState: 'WAIT_FOR_HUMAN',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: '2026-01-01T00:00:00Z',
    };
    expect(dashboardWaitingContextSchema.safeParse(data).success).toBe(true);
  });

  it('validates with optional fields', () => {
    const data = {
      reason: 'Budget exceeded',
      requiredInput: 'approval',
      requestingState: 'IMPLEMENTATION',
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
    expect(dashboardWaitingContextSchema.safeParse(data).success).toBe(true);
  });
});

describe('dashboardSessionViewSchema', () => {
  it('validates a session view', () => {
    const data = {
      sessionId: 'sess-1',
      runId: 'r-1',
      role: 'architect',
      stateId: 'IMPL',
      transport: 'stdio',
      state: 'running',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:01:00Z',
    };
    expect(dashboardSessionViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('runStateViewSchema', () => {
  it('validates a run state view', () => {
    const data = {
      runId: 'r-1',
      status: 'running',
      currentState: 'IMPLEMENTATION',
      previousState: 'SPECIFICATION',
      startedAt: '2026-01-01T00:00:00Z',
      stateEnteredAt: '2026-01-01T00:01:00Z',
      elapsedMs: 60000,
      transitionCount: 3,
      isWaitingForHuman: false,
    };
    expect(runStateViewSchema.safeParse(data).success).toBe(true);
  });

  it('validates with null previousState', () => {
    const data = {
      runId: 'r-1',
      status: 'running',
      currentState: 'SPECIFICATION',
      previousState: null,
      startedAt: '2026-01-01T00:00:00Z',
      stateEnteredAt: '2026-01-01T00:00:00Z',
      elapsedMs: 0,
      transitionCount: 0,
      isWaitingForHuman: false,
    };
    expect(runStateViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('parallelInfoSchema', () => {
  it('validates a fork', () => {
    const data = { type: 'fork', parallelRoles: ['reviewer_a', 'reviewer_b'] };
    expect(parallelInfoSchema.safeParse(data).success).toBe(true);
  });

  it('validates a join', () => {
    expect(parallelInfoSchema.safeParse({ type: 'join' }).success).toBe(true);
  });

  it('rejects invalid type', () => {
    expect(parallelInfoSchema.safeParse({ type: 'merge' }).success).toBe(false);
  });
});

describe('stateNodeSchema', () => {
  it('validates a state node', () => {
    const data = {
      id: 'IMPL',
      type: 'action',
      label: 'Implementation',
      visited: true,
      current: true,
      timeSpentMs: 5000,
      visitCount: 1,
    };
    expect(stateNodeSchema.safeParse(data).success).toBe(true);
  });
});

describe('transitionEdgeSchema', () => {
  it('validates a transition edge', () => {
    const data = {
      from: 'SPEC',
      to: 'IMPL',
      trigger: 'completion',
      traversed: true,
      traversalCount: 1,
    };
    expect(transitionEdgeSchema.safeParse(data).success).toBe(true);
  });
});

describe('artifactEntryViewSchema', () => {
  it('validates an artifact entry', () => {
    const data = {
      ref: validRef,
      type: 'plan',
      name: 'main-plan',
      version: 1,
      producedBy: 'architect',
      createdAt: '2026-01-01T00:00:00Z',
      sizeBytes: 1024,
    };
    expect(artifactEntryViewSchema.safeParse(data).success).toBe(true);
  });

  it('validates with optional verdict', () => {
    const data = {
      ref: validRef,
      type: 'plan',
      name: 'main-plan',
      version: 1,
      producedBy: 'architect',
      createdAt: '2026-01-01T00:00:00Z',
      sizeBytes: 1024,
      verdict: 'approved',
    };
    expect(artifactEntryViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('artifactInventoryViewSchema', () => {
  it('validates an inventory view', () => {
    const data = {
      runId: 'r-1',
      artifacts: [],
      totalCount: 0,
      totalSizeBytes: 0,
      byType: {},
    };
    expect(artifactInventoryViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('artifactDetailViewSchema', () => {
  it('validates an artifact detail view', () => {
    const data = {
      ref: validRef,
      type: 'plan',
      name: 'main-plan',
      currentVersion: 1,
      producedBy: 'architect',
      createdAt: '2026-01-01T00:00:00Z',
      sizeBytes: 1024,
      versions: [
        { ref: validRef, version: 1, checksum: 'sha256-abc', createdAt: '2026-01-01T00:00:00Z' },
      ],
      dependsOn: [],
      dependedOnBy: [],
    };
    expect(artifactDetailViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('artifactContentViewSchema', () => {
  it('validates markdown content', () => {
    const data = { content: '# Hello', contentType: 'markdown', sizeBytes: 7 };
    expect(artifactContentViewSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid contentType', () => {
    expect(
      artifactContentViewSchema.safeParse({ content: '', contentType: 'html', sizeBytes: 0 })
        .success,
    ).toBe(false);
  });
});

describe('contractProgressViewSchema', () => {
  it('validates contract progress', () => {
    const data = {
      contractId: 'review-1',
      currentIteration: 2,
      maxIterations: 3,
      status: 'in_progress',
      findingsTotal: 5,
      findingsResolved: 3,
      judgeArbitrations: 1,
    };
    expect(contractProgressViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('iterationProgressViewSchema', () => {
  it('validates iteration progress', () => {
    const data = {
      runId: 'r-1',
      contracts: [],
      totalIterations: 0,
      totalFindings: 0,
      resolvedFindings: 0,
    };
    expect(iterationProgressViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('findingEntryViewSchema', () => {
  it('validates a finding entry', () => {
    const data = {
      id: 'f-1',
      severity: 'high',
      status: 'open',
      category: 'security',
      description: 'SQL injection risk',
      source: 'static_reviewer',
      iteration: 1,
    };
    expect(findingEntryViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('findingsViewSchema', () => {
  it('validates a findings view', () => {
    const data = {
      runId: 'r-1',
      findings: [],
      totalCount: 0,
      bySeverity: {},
      byStatus: {},
    };
    expect(findingsViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('roleUsageViewSchema', () => {
  it('validates role usage', () => {
    const data = {
      role: 'architect',
      inputTokens: 5000,
      outputTokens: 3000,
      dispatches: 2,
      totalDurationMs: 10000,
    };
    expect(roleUsageViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('usageBreakdownViewSchema', () => {
  it('validates a usage breakdown', () => {
    const data = {
      runId: 'r-1',
      totalInputTokens: 5000,
      totalOutputTokens: 3000,
      totalTokens: 8000,
      byRole: [],
    };
    expect(usageBreakdownViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('runSummaryViewSchema', () => {
  it('validates a run summary', () => {
    const data = {
      runId: 'r-1',
      repository: 'test',
      workflow: 'default',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:01:00Z',
      durationMs: 60000,
      totalArtifacts: 5,
      totalTokens: 8000,
      totalInputTokens: 5000,
      totalOutputTokens: 3000,
      finalState: 'DONE',
    };
    expect(runSummaryViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('runConfigViewSchema', () => {
  it('validates a run config view', () => {
    const data = {
      roles: [{ role: 'architect', model: 'gpt-4' }],
      iterationLimits: { maxReviewIterations: 3 },
      qualityGates: {
        specificationReadiness: { minCompletenessScore: 0.8 },
        implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
      },
      budget: { maxTokensPerRun: null },
    };
    expect(runConfigViewSchema.safeParse(data).success).toBe(true);
  });

  it('validates role assignment with timeoutMs, maxTurns, and maxTokens', () => {
    const data = {
      roles: [
        {
          role: 'developer',
          model: 'claude-sonnet-5',
          runner: 'claude-code',
          maxTokens: 8192,
          timeoutMs: 1200000,
          maxTurns: 25,
        },
      ],
      iterationLimits: {},
      qualityGates: {
        specificationReadiness: { minCompletenessScore: 0 },
        implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 0 },
      },
      budget: { maxTokensPerRun: null },
    };
    expect(runConfigViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('dashboardEventSchema', () => {
  it('validates a dashboard event', () => {
    const data = {
      type: 'state_changed',
      timestamp: '2026-01-01T00:00:00Z',
      runId: 'r-1',
      data: { newState: 'IMPL' },
    };
    expect(dashboardEventSchema.safeParse(data).success).toBe(true);
  });

  it('rejects unknown event type', () => {
    const data = {
      type: 'unknown_event',
      timestamp: '2026-01-01T00:00:00Z',
      runId: 'r-1',
      data: {},
    };
    expect(dashboardEventSchema.safeParse(data).success).toBe(false);
  });
});

describe('dashboardEventTypeSchema', () => {
  it('accepts valid event types', () => {
    expect(dashboardEventTypeSchema.safeParse('state_changed').success).toBe(true);
    expect(dashboardEventTypeSchema.safeParse('permission_requested').success).toBe(true);
  });
});

describe('subsystemHealthViewSchema', () => {
  it('validates a subsystem health view', () => {
    const data = {
      name: 'artifact-store',
      status: 'healthy',
      lastCheckedAt: '2026-01-01T00:00:00Z',
      consecutiveFailures: 0,
      message: 'OK',
    };
    expect(subsystemHealthViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('systemHealthViewSchema', () => {
  it('validates a system health view', () => {
    const data = {
      timestamp: '2026-01-01T00:00:00Z',
      overallStatus: 'healthy',
      subsystems: [],
    };
    expect(systemHealthViewSchema.safeParse(data).success).toBe(true);
  });
});

describe('settingsRoleAssignmentSchema', () => {
  it('validates a role assignment', () => {
    expect(settingsRoleAssignmentSchema.safeParse({ model: 'gpt-4' }).success).toBe(true);
  });

  it('validates with dispatch type', () => {
    const data = { model: 'claude-3', dispatchType: 'agent', runner: 'codex' };
    expect(settingsRoleAssignmentSchema.safeParse(data).success).toBe(true);
  });
});

describe('settingsPermissionPolicySchema', () => {
  it('validates a permission policy', () => {
    const data = { defaultAction: 'deny' };
    expect(settingsPermissionPolicySchema.safeParse(data).success).toBe(true);
  });

  it('validates with rules and trust levels', () => {
    const data = {
      defaultAction: 'ask_human',
      rules: [{ action: 'file_read', decision: 'grant' }],
      roleTrust: { architect: 'high' },
    };
    expect(settingsPermissionPolicySchema.safeParse(data).success).toBe(true);
  });
});

describe('settingsGovernanceSchema', () => {
  it('validates governance settings', () => {
    const data = {
      iterationLimits: { defaults: { maxReviewIterations: 3 } },
      qualityGates: {
        specificationReadiness: { minCompletenessScore: 0.8 },
        implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
      },
    };
    expect(settingsGovernanceSchema.safeParse(data).success).toBe(true);
  });
});

describe('projectSettingsViewSchema', () => {
  it('validates project settings', () => {
    const data = {
      roles: { assignments: { architect: { model: 'gpt-4' } } },
      governance: {
        iterationLimits: { defaults: { maxReviewIterations: 3 } },
        qualityGates: {
          specificationReadiness: { minCompletenessScore: 0.8 },
          implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
        },
      },
      runtime: { logLevel: 'info' },
      availableRunners: ['codex'],
      modelsByRunner: { codex: ['gpt-4', 'claude-3'] },
    };
    expect(projectSettingsViewSchema.safeParse(data).success).toBe(true);
  });
});
