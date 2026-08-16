import { describe, expect, it } from 'vitest';

import {
  agreementArtifactSchema,
  agreementFindingSchema,
  agreementGateResultSchema,
  agreementParticipantSchema,
  agreementTypeSchema,
  agreementValidationResultSchema,
  approvalStatusSchema,
  approvalTypeSchema,
  participantActionSchema,
} from '../agreement-artifacts';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('agreementTypeSchema', () => {
  it('accepts valid types', () => {
    expect(agreementTypeSchema.safeParse('planning_agreement').success).toBe(true);
    expect(agreementTypeSchema.safeParse('release_agreement').success).toBe(true);
  });

  it('rejects invalid type', () => {
    expect(agreementTypeSchema.safeParse('unknown').success).toBe(false);
  });
});

describe('approvalStatusSchema', () => {
  it.each(['approved', 'conditionally_approved', 'rejected'])('accepts "%s"', (val) => {
    expect(approvalStatusSchema.safeParse(val).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(approvalStatusSchema.safeParse('pending').success).toBe(false);
  });
});

describe('approvalTypeSchema', () => {
  it.each(['human', 'automated', 'judge'])('accepts "%s"', (val) => {
    expect(approvalTypeSchema.safeParse(val).success).toBe(true);
  });
});

describe('participantActionSchema', () => {
  it.each(['produced', 'reviewed', 'judged', 'approved'])('accepts "%s"', (val) => {
    expect(participantActionSchema.safeParse(val).success).toBe(true);
  });
});

describe('agreementParticipantSchema', () => {
  it('validates a participant', () => {
    const data = { role: 'architect', action: 'produced' };
    expect(agreementParticipantSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid action', () => {
    expect(agreementParticipantSchema.safeParse({ role: 'x', action: 'did_nothing' }).success).toBe(
      false,
    );
  });
});

describe('agreementFindingSchema', () => {
  it('validates a finding without optional fields', () => {
    const data = { id: 'f-1', severity: 'high', status: 'open', title: 'Missing tests' };
    expect(agreementFindingSchema.safeParse(data).success).toBe(true);
  });

  it('validates a finding with resolutionRef', () => {
    const data = {
      id: 'f-1',
      severity: 'high',
      status: 'resolved',
      title: 'Missing tests',
      resolutionRef: validRef,
    };
    expect(agreementFindingSchema.safeParse(data).success).toBe(true);
  });
});

describe('agreementArtifactSchema', () => {
  it('validates a full agreement artifact', () => {
    const data = {
      type: 'planning_agreement',
      runId: 'r-1',
      stageId: 'SPECIFICATION',
      timestamp: '2026-01-01T00:00:00Z',
      participants: [{ role: 'architect', action: 'produced' }],
      reviewedArtifacts: [validRef],
      findings: [],
      unresolvedFindings: [],
      approvalStatus: 'approved',
      approvalType: 'human',
    };
    expect(agreementArtifactSchema.safeParse(data).success).toBe(true);
  });

  it('validates with optional conditions and notes', () => {
    const data = {
      type: 'verification_agreement',
      runId: 'r-2',
      stageId: 'VERIFY',
      timestamp: '2026-01-01T00:00:00Z',
      participants: [],
      reviewedArtifacts: [],
      findings: [],
      unresolvedFindings: [],
      approvalStatus: 'conditionally_approved',
      approvalType: 'automated',
      conditions: 'Must pass CI',
      notes: 'Approved with condition',
    };
    expect(agreementArtifactSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(agreementArtifactSchema.safeParse({ type: 'planning_agreement' }).success).toBe(false);
  });
});

describe('agreementValidationResultSchema', () => {
  it('validates a passing result', () => {
    const data = { valid: true, errors: [], warnings: [] };
    expect(agreementValidationResultSchema.safeParse(data).success).toBe(true);
  });

  it('validates a failing result with messages', () => {
    const data = { valid: false, errors: ['Missing participant'], warnings: ['Low coverage'] };
    expect(agreementValidationResultSchema.safeParse(data).success).toBe(true);
  });
});

describe('agreementGateResultSchema', () => {
  it('validates a gate result with all optional fields', () => {
    const data = {
      exists: true,
      valid: true,
      approvalStatus: 'approved',
      artifactRef: validRef,
      reason: 'All checks passed',
    };
    expect(agreementGateResultSchema.safeParse(data).success).toBe(true);
  });

  it('validates a minimal gate result', () => {
    const data = { exists: false, valid: false };
    expect(agreementGateResultSchema.safeParse(data).success).toBe(true);
  });
});
