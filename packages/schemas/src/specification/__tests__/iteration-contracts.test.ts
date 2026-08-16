import { describe, expect, it } from 'vitest';

import {
  aggregationStrategySchema,
  escalationActionSchema,
  escalationPolicySchema,
  failureConditionSchema,
  failureConditionTypeSchema,
  iterationContractSchema,
  iterationStateSchema,
  iterationStatusSchema,
  reviewerSpecSchema,
  successConditionSchema,
  successConditionTypeSchema,
} from '../iteration-contracts';

// ---- Helpers ----

const validEscalationPolicy = {
  action: 'escalate_to_human',
  produceEscalationArtifact: true,
  includeFullHistory: false,
};

const validIterationContract = {
  id: 'ic-1',
  name: 'Implementation Review',
  description: 'Review implementation artifacts',
  producer: 'implementer',
  reviewers: [{ role: 'reviewer', output: 'static_review', inputs: ['implementation'] }],
  aggregation: 'all_must_pass',
  producerInputs: ['plan'],
  producerOutput: 'implementation',
  successCondition: { type: 'no_blocking_findings' },
  failureCondition: { type: 'max_iterations_exceeded' },
  maxIterations: 3,
  maxJudgeArbitrations: 1,
  escalationPolicy: validEscalationPolicy,
};

// ---- aggregationStrategySchema ----

describe('aggregationStrategySchema', () => {
  it.each(['all_must_pass', 'majority', 'any'])('accepts "%s"', (value) => {
    expect(aggregationStrategySchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown strategy', () => {
    expect(aggregationStrategySchema.safeParse('consensus').success).toBe(false);
  });
});

// ---- successConditionTypeSchema ----

describe('successConditionTypeSchema', () => {
  it.each(['no_blocking_findings', 'all_findings_addressed', 'custom'])('accepts "%s"', (value) => {
    expect(successConditionTypeSchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(successConditionTypeSchema.safeParse('partial_pass').success).toBe(false);
  });
});

// ---- successConditionSchema ----

describe('successConditionSchema', () => {
  it('accepts a minimal condition', () => {
    const data = { type: 'no_blocking_findings' };
    expect(successConditionSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with optional params', () => {
    const data = { type: 'custom', params: { threshold: 0.9, strictMode: true } };
    expect(successConditionSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid type', () => {
    expect(successConditionSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });

  it('rejects missing type', () => {
    expect(successConditionSchema.safeParse({}).success).toBe(false);
  });
});

// ---- failureConditionTypeSchema ----

describe('failureConditionTypeSchema', () => {
  it.each(['max_iterations_exceeded', 'judge_arbitration_failed', 'custom'])(
    'accepts "%s"',
    (value) => {
      expect(failureConditionTypeSchema.safeParse(value).success).toBe(true);
    },
  );

  it('rejects unknown type', () => {
    expect(failureConditionTypeSchema.safeParse('timeout').success).toBe(false);
  });
});

// ---- failureConditionSchema ----

describe('failureConditionSchema', () => {
  it('accepts a minimal condition', () => {
    const data = { type: 'max_iterations_exceeded' };
    expect(failureConditionSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with optional params', () => {
    const data = { type: 'custom', params: { maxWait: 300 } };
    expect(failureConditionSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid type', () => {
    expect(failureConditionSchema.safeParse({ type: 'crash' }).success).toBe(false);
  });

  it('rejects missing type', () => {
    expect(failureConditionSchema.safeParse({}).success).toBe(false);
  });
});

// ---- escalationActionSchema ----

describe('escalationActionSchema', () => {
  it.each(['escalate_to_human', 'force_approve', 'abort'])('accepts "%s"', (value) => {
    expect(escalationActionSchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown action', () => {
    expect(escalationActionSchema.safeParse('retry').success).toBe(false);
  });
});

// ---- escalationPolicySchema ----

describe('escalationPolicySchema', () => {
  it('accepts a valid policy', () => {
    expect(escalationPolicySchema.safeParse(validEscalationPolicy).success).toBe(true);
  });

  it('rejects missing action', () => {
    expect(
      escalationPolicySchema.safeParse({
        produceEscalationArtifact: true,
        includeFullHistory: false,
      }).success,
    ).toBe(false);
  });

  it('rejects missing produceEscalationArtifact', () => {
    expect(
      escalationPolicySchema.safeParse({
        action: 'abort',
        includeFullHistory: false,
      }).success,
    ).toBe(false);
  });

  it('rejects missing includeFullHistory', () => {
    expect(
      escalationPolicySchema.safeParse({
        action: 'abort',
        produceEscalationArtifact: true,
      }).success,
    ).toBe(false);
  });

  it('rejects invalid action', () => {
    expect(
      escalationPolicySchema.safeParse({
        action: 'ignore',
        produceEscalationArtifact: false,
        includeFullHistory: false,
      }).success,
    ).toBe(false);
  });
});

// ---- reviewerSpecSchema ----

describe('reviewerSpecSchema', () => {
  it('accepts a valid spec', () => {
    const data = {
      role: 'security_reviewer',
      output: 'security_review',
      inputs: ['implementation'],
    };
    expect(reviewerSpecSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with multiple inputs', () => {
    const data = {
      role: 'reviewer',
      output: 'static_review',
      inputs: ['implementation', 'plan'],
    };
    expect(reviewerSpecSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with empty inputs', () => {
    const data = { role: 'reviewer', output: 'static_review', inputs: [] };
    expect(reviewerSpecSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing role', () => {
    expect(reviewerSpecSchema.safeParse({ output: 'static_review', inputs: [] }).success).toBe(
      false,
    );
  });

  it('rejects missing output', () => {
    expect(reviewerSpecSchema.safeParse({ role: 'reviewer', inputs: [] }).success).toBe(false);
  });

  it('rejects missing inputs', () => {
    expect(
      reviewerSpecSchema.safeParse({ role: 'reviewer', output: 'static_review' }).success,
    ).toBe(false);
  });

  it('rejects invalid artifact type in output', () => {
    const data = { role: 'reviewer', output: 'invalid_type', inputs: [] };
    expect(reviewerSpecSchema.safeParse(data).success).toBe(false);
  });

  it('rejects invalid artifact type in inputs', () => {
    const data = { role: 'reviewer', output: 'static_review', inputs: ['bogus'] };
    expect(reviewerSpecSchema.safeParse(data).success).toBe(false);
  });
});

// ---- iterationContractSchema ----

describe('iterationContractSchema', () => {
  it('accepts a valid contract', () => {
    expect(iterationContractSchema.safeParse(validIterationContract).success).toBe(true);
  });

  it('accepts with all optional fields', () => {
    const data = {
      ...validIterationContract,
      judge: 'judge-agent',
      completionAgreement: 'Both parties agree on done criteria',
    };
    expect(iterationContractSchema.safeParse(data).success).toBe(true);
  });

  it.each([
    'id',
    'name',
    'description',
    'producer',
    'reviewers',
    'aggregation',
    'producerInputs',
    'producerOutput',
    'successCondition',
    'failureCondition',
    'maxIterations',
    'maxJudgeArbitrations',
    'escalationPolicy',
  ])('rejects when required field "%s" is missing', (field) => {
    const { [field]: _, ...data } = validIterationContract as Record<string, unknown>;
    expect(iterationContractSchema.safeParse(data).success).toBe(false);
  });

  it('rejects empty object', () => {
    expect(iterationContractSchema.safeParse({}).success).toBe(false);
  });

  it('rejects non-number maxIterations', () => {
    expect(
      iterationContractSchema.safeParse({ ...validIterationContract, maxIterations: '3' }).success,
    ).toBe(false);
  });

  it('rejects invalid aggregation', () => {
    expect(
      iterationContractSchema.safeParse({
        ...validIterationContract,
        aggregation: 'vote',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid producerOutput', () => {
    expect(
      iterationContractSchema.safeParse({
        ...validIterationContract,
        producerOutput: 'not_a_type',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid reviewer spec inside reviewers array', () => {
    expect(
      iterationContractSchema.safeParse({
        ...validIterationContract,
        reviewers: [{ role: 'r', output: 'bad_type', inputs: [] }],
      }).success,
    ).toBe(false);
  });
});

// ---- iterationStatusSchema ----

describe('iterationStatusSchema', () => {
  it.each(['in_progress', 'succeeded', 'failed', 'escalated'])('accepts "%s"', (value) => {
    expect(iterationStatusSchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown status', () => {
    expect(iterationStatusSchema.safeParse('paused').success).toBe(false);
  });
});

// ---- iterationStateSchema ----

describe('iterationStateSchema', () => {
  it('accepts a valid state', () => {
    const data = {
      contractId: 'ic-1',
      currentIteration: 2,
      judgeArbitrations: 0,
      producerArtifactVersions: [
        { type: 'implementation', name: 'impl', version: 1, checksum: 'sha256-abc' },
      ],
      reviewerArtifactVersions: [
        { type: 'static_review', name: 'review', version: 1, checksum: 'sha256-def' },
      ],
      findingsTotal: 5,
      findingsResolved: 3,
      findingsOpen: 2,
      status: 'in_progress',
    };
    expect(iterationStateSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with empty artifact arrays', () => {
    const data = {
      contractId: 'ic-1',
      currentIteration: 1,
      judgeArbitrations: 0,
      producerArtifactVersions: [],
      reviewerArtifactVersions: [],
      findingsTotal: 0,
      findingsResolved: 0,
      findingsOpen: 0,
      status: 'succeeded',
    };
    expect(iterationStateSchema.safeParse(data).success).toBe(true);
  });

  it.each([
    'contractId',
    'currentIteration',
    'judgeArbitrations',
    'producerArtifactVersions',
    'reviewerArtifactVersions',
    'findingsTotal',
    'findingsResolved',
    'findingsOpen',
    'status',
  ])('rejects when required field "%s" is missing', (field) => {
    const fullData: Record<string, unknown> = {
      contractId: 'ic-1',
      currentIteration: 1,
      judgeArbitrations: 0,
      producerArtifactVersions: [],
      reviewerArtifactVersions: [],
      findingsTotal: 0,
      findingsResolved: 0,
      findingsOpen: 0,
      status: 'in_progress',
    };
    const { [field]: _, ...data } = fullData;
    expect(iterationStateSchema.safeParse(data).success).toBe(false);
  });

  it('rejects invalid status', () => {
    const data = {
      contractId: 'ic-1',
      currentIteration: 1,
      judgeArbitrations: 0,
      producerArtifactVersions: [],
      reviewerArtifactVersions: [],
      findingsTotal: 0,
      findingsResolved: 0,
      findingsOpen: 0,
      status: 'running',
    };
    expect(iterationStateSchema.safeParse(data).success).toBe(false);
  });

  it('rejects invalid artifact ref in producerArtifactVersions', () => {
    const data = {
      contractId: 'ic-1',
      currentIteration: 1,
      judgeArbitrations: 0,
      producerArtifactVersions: [{ type: 'bad', name: 'x', version: 1, checksum: 'c' }],
      reviewerArtifactVersions: [],
      findingsTotal: 0,
      findingsResolved: 0,
      findingsOpen: 0,
      status: 'in_progress',
    };
    expect(iterationStateSchema.safeParse(data).success).toBe(false);
  });

  it('rejects non-number currentIteration', () => {
    const data = {
      contractId: 'ic-1',
      currentIteration: '1',
      judgeArbitrations: 0,
      producerArtifactVersions: [],
      reviewerArtifactVersions: [],
      findingsTotal: 0,
      findingsResolved: 0,
      findingsOpen: 0,
      status: 'in_progress',
    };
    expect(iterationStateSchema.safeParse(data).success).toBe(false);
  });
});
