import { describe, expect, it } from 'vitest';

import {
  agreementStatusSchema,
  escalationContextSchema,
  escalationReasonSchema,
  escalationTriggerSchema,
  findingSummarySchema,
  governanceDecisionSchema,
  governanceOutcomeSchema,
  humanApprovalSchema,
  iterationSummarySchema,
  policyCheckOutcomeSchema,
  policyEvaluationSchema,
  policyTokenUsageSchema,
  transitionAllowedSchema,
  transitionDecisionSchema,
  transitionDeniedSchema,
  transitionEscalatedSchema,
  transitionRequestSchema,
} from '../governance';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('policyTokenUsageSchema', () => {
  it('validates token usage', () => {
    const data = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
    expect(policyTokenUsageSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(policyTokenUsageSchema.safeParse({ inputTokens: 1000 }).success).toBe(false);
  });
});

describe('humanApprovalSchema', () => {
  it('validates an approval', () => {
    const data = { approvedBy: 'admin', timestamp: '2026-01-01T00:00:00Z' };
    expect(humanApprovalSchema.safeParse(data).success).toBe(true);
  });

  it('validates with optional fields', () => {
    const data = {
      approvedBy: 'admin',
      timestamp: '2026-01-01T00:00:00Z',
      conditions: 'Must pass CI',
      artifactRef: validRef,
    };
    expect(humanApprovalSchema.safeParse(data).success).toBe(true);
  });
});

describe('escalationReasonSchema', () => {
  it.each([
    'iteration_limit_exceeded',
    'quality_gate_failed',
    'unresolvable_conflict',
    'human_requested',
    'token_budget_exceeded',
    'retry_limit_exceeded',
    'confidence_too_low',
  ])('accepts "%s"', (val) => {
    expect(escalationReasonSchema.safeParse(val).success).toBe(true);
  });

  it('rejects unknown reason', () => {
    expect(escalationReasonSchema.safeParse('unknown').success).toBe(false);
  });
});

describe('escalationTriggerSchema', () => {
  it('accepts escalation-specific triggers', () => {
    expect(escalationTriggerSchema.safeParse('provider_failure').success).toBe(true);
    expect(escalationTriggerSchema.safeParse('timeout').success).toBe(true);
    expect(escalationTriggerSchema.safeParse('unrecoverable_error').success).toBe(true);
  });

  it('also accepts escalation reasons', () => {
    expect(escalationTriggerSchema.safeParse('iteration_limit_exceeded').success).toBe(true);
  });
});

describe('findingSummarySchema', () => {
  it('validates a finding summary', () => {
    const data = { id: 'f-1', severity: 'high', status: 'open', description: 'Bug found' };
    expect(findingSummarySchema.safeParse(data).success).toBe(true);
  });
});

describe('iterationSummarySchema', () => {
  it('validates an iteration summary', () => {
    const data = {
      iteration: 1,
      producerArtifact: validRef,
      reviewerArtifact: validRef,
      findingsProduced: 3,
      findingsResolved: 2,
      findingsRemaining: 1,
    };
    expect(iterationSummarySchema.safeParse(data).success).toBe(true);
  });
});

describe('escalationContextSchema', () => {
  it('validates a full escalation context', () => {
    const data = {
      runId: 'run-123',
      stageId: 'CODE_REVIEW',
      reason: 'iteration_limit_exceeded',
      iterationHistory: [],
      unresolvedFindings: [],
      artifactRefs: [validRef],
      suggestedActions: ['Increase iteration limit'],
    };
    expect(escalationContextSchema.safeParse(data).success).toBe(true);
  });
});

describe('transitionDecisionSchema', () => {
  it('validates an allowed transition', () => {
    const data = { allowed: true, reason: 'All guards passed' };
    expect(transitionAllowedSchema.safeParse(data).success).toBe(true);
    expect(transitionDecisionSchema.safeParse(data).success).toBe(true);
  });

  it('validates a denied transition', () => {
    const data = { allowed: false, reason: 'Missing artifact', remediation: 'Run implementation' };
    expect(transitionDeniedSchema.safeParse(data).success).toBe(true);
    expect(transitionDecisionSchema.safeParse(data).success).toBe(true);
  });

  it('validates an escalated transition', () => {
    const data = {
      escalate: true,
      reason: 'Too many iterations',
      context: {
        runId: 'run-123',
        stageId: 'CODE_REVIEW',
        reason: 'iteration_limit_exceeded',
        iterationHistory: [],
        unresolvedFindings: [],
        artifactRefs: [],
        suggestedActions: [],
      },
    };
    expect(transitionEscalatedSchema.safeParse(data).success).toBe(true);
    expect(transitionDecisionSchema.safeParse(data).success).toBe(true);
  });
});

describe('transitionRequestSchema', () => {
  it('validates a minimal request', () => {
    const data = {
      runId: 'run-123',
      from: 'IMPL',
      to: 'CODE_REVIEW',
      artifacts: [validRef],
    };
    expect(transitionRequestSchema.safeParse(data).success).toBe(true);
  });

  it('validates with all optional fields', () => {
    const data = {
      runId: 'run-123',
      from: 'IMPL',
      to: 'CODE_REVIEW',
      artifacts: [validRef],
      iterationCount: 2,
      findings: [{ id: 'f-1', severity: 'high', status: 'open', description: 'Bug' }],
      humanApproval: { approvedBy: 'admin', timestamp: '2026-01-01T00:00:00Z' },
      tokenUsage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
    };
    expect(transitionRequestSchema.safeParse(data).success).toBe(true);
  });
});

describe('agreementStatusSchema', () => {
  it('validates an existing agreement', () => {
    const data = { exists: true, valid: true, artifact: validRef };
    expect(agreementStatusSchema.safeParse(data).success).toBe(true);
  });

  it('validates a missing agreement', () => {
    const data = { exists: false, valid: false, missingReason: 'Not yet produced' };
    expect(agreementStatusSchema.safeParse(data).success).toBe(true);
  });
});

describe('policyCheckOutcomeSchema', () => {
  it.each(['pass', 'fail', 'skip'])('accepts "%s"', (val) => {
    expect(policyCheckOutcomeSchema.safeParse(val).success).toBe(true);
  });
});

describe('policyEvaluationSchema', () => {
  it('validates a policy evaluation', () => {
    const data = { policy: 'iteration_limit', evaluated: true, result: 'pass', detail: 'OK' };
    expect(policyEvaluationSchema.safeParse(data).success).toBe(true);
  });
});

describe('governanceOutcomeSchema', () => {
  it.each(['allowed', 'denied', 'escalated'])('accepts "%s"', (val) => {
    expect(governanceOutcomeSchema.safeParse(val).success).toBe(true);
  });
});

describe('governanceDecisionSchema', () => {
  it('validates a governance decision', () => {
    const data = {
      timestamp: '2026-01-01T00:00:00Z',
      runId: 'run-123',
      transitionRequested: { from: 'IMPL', to: 'REVIEW' },
      policiesEvaluated: [
        { policy: 'iteration_limit', evaluated: true, result: 'pass', detail: 'OK' },
      ],
      outcome: 'allowed',
      reason: 'All policies passed',
      artifactsInspected: [validRef],
    };
    expect(governanceDecisionSchema.safeParse(data).success).toBe(true);
  });
});
