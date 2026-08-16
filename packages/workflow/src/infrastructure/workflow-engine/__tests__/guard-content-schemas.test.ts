import { describe, expect, it } from 'vitest';

import {
  approvedGuardContentSchema,
  judgeGuardContentSchema,
  passedGuardContentSchema,
  planGuardContentSchema,
  reviewGuardContentSchema,
  specClarificationGuardContentSchema,
  specFeasibilityGuardContentSchema,
  verificationFailuresGuardContentSchema,
  verificationPassedGuardContentSchema,
} from '../guard-content-schemas';

describe('judgeGuardContentSchema', () => {
  it('validates with planLevelIssue', () => {
    expect(judgeGuardContentSchema.safeParse({ planLevelIssue: true }).success).toBe(true);
  });

  it('validates without planLevelIssue (loose)', () => {
    expect(judgeGuardContentSchema.safeParse({}).success).toBe(true);
  });

  it('allows extra fields (loose schema)', () => {
    expect(judgeGuardContentSchema.safeParse({ planLevelIssue: false, extra: 'ok' }).success).toBe(
      true,
    );
  });
});

describe('reviewGuardContentSchema', () => {
  it('validates with findings', () => {
    const data = {
      findings: [{ category: 'security', severity: 'high' }],
    };
    expect(reviewGuardContentSchema.safeParse(data).success).toBe(true);
  });

  it('validates with empty findings', () => {
    expect(reviewGuardContentSchema.safeParse({ findings: [] }).success).toBe(true);
  });

  it('validates findings with extra fields', () => {
    const data = { findings: [{ category: 'style', extra: true }] };
    expect(reviewGuardContentSchema.safeParse(data).success).toBe(true);
  });
});

describe('verificationPassedGuardContentSchema', () => {
  it('validates passed', () => {
    expect(verificationPassedGuardContentSchema.safeParse({ passed: true }).success).toBe(true);
  });

  it('validates not passed', () => {
    expect(verificationPassedGuardContentSchema.safeParse({ passed: false }).success).toBe(true);
  });
});

describe('verificationFailuresGuardContentSchema', () => {
  it('validates with failures', () => {
    const data = {
      failures: [{ fixable: true, relatedness: 'related' }],
    };
    expect(verificationFailuresGuardContentSchema.safeParse(data).success).toBe(true);
  });

  it('validates with minimal failure data', () => {
    const data = { failures: [{ fixable: false }] };
    expect(verificationFailuresGuardContentSchema.safeParse(data).success).toBe(true);
  });
});

describe('planGuardContentSchema', () => {
  it('validates a plan with tasks', () => {
    const data = {
      tasks: [
        {
          taskId: 'task-1',
          description: 'Implement auth',
          files: ['src/auth.ts'],
          dependencies: [],
        },
      ],
    };
    expect(planGuardContentSchema.safeParse(data).success).toBe(true);
  });

  it('rejects empty tasks array', () => {
    expect(planGuardContentSchema.safeParse({ tasks: [] }).success).toBe(false);
  });

  it('rejects task with empty taskId', () => {
    const data = {
      tasks: [{ taskId: '', description: 'X', files: [], dependencies: [] }],
    };
    expect(planGuardContentSchema.safeParse(data).success).toBe(false);
  });
});

describe('specFeasibilityGuardContentSchema', () => {
  it('validates feasible spec', () => {
    const data = { feasibility: { feasible: true } };
    expect(specFeasibilityGuardContentSchema.safeParse(data).success).toBe(true);
  });

  it('validates infeasible with reason', () => {
    const data = { feasibility: { feasible: false, reason: 'Too complex' } };
    expect(specFeasibilityGuardContentSchema.safeParse(data).success).toBe(true);
  });

  it('validates without feasibility (optional)', () => {
    expect(specFeasibilityGuardContentSchema.safeParse({}).success).toBe(true);
  });
});

describe('specClarificationGuardContentSchema', () => {
  it('validates with clarification needs', () => {
    const data = { clarificationNeeds: ['What is the target audience?'] };
    expect(specClarificationGuardContentSchema.safeParse(data).success).toBe(true);
  });

  it('validates without clarification needs', () => {
    expect(specClarificationGuardContentSchema.safeParse({}).success).toBe(true);
  });
});

describe('approvedGuardContentSchema', () => {
  it('validates approved', () => {
    expect(approvedGuardContentSchema.safeParse({ approved: true }).success).toBe(true);
  });

  it('validates not approved', () => {
    expect(approvedGuardContentSchema.safeParse({ approved: false }).success).toBe(true);
  });
});

describe('passedGuardContentSchema', () => {
  it('validates passed', () => {
    expect(passedGuardContentSchema.safeParse({ passed: true }).success).toBe(true);
  });

  it('validates not passed', () => {
    expect(passedGuardContentSchema.safeParse({ passed: false }).success).toBe(true);
  });
});
