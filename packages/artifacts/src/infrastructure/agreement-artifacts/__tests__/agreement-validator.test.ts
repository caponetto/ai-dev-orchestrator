import type { AgreementArtifact } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { DefaultAgreementValidator } from '../agreement-validator';

const validator = new DefaultAgreementValidator();

function makeAgreement(overrides: Partial<AgreementArtifact> = {}): AgreementArtifact {
  return {
    type: 'planning_agreement',
    runId: 'run-001',
    stageId: 'PLAN_REVIEW',
    timestamp: new Date().toISOString(),
    participants: [
      { role: 'planner', action: 'produced' },
      { role: 'plan_reviewer', action: 'approved' },
    ],
    reviewedArtifacts: [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
    findings: [],
    unresolvedFindings: [],
    approvalStatus: 'approved',
    approvalType: 'automated',
    ...overrides,
  };
}

describe('DefaultAgreementValidator', () => {
  it('validates a correct agreement', () => {
    const result = validator.validate(makeAgreement());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects agreement with no participants', () => {
    const result = validator.validate(makeAgreement({ participants: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Agreement must have at least one participant');
  });

  it('rejects agreement without an approved participant', () => {
    const result = validator.validate(
      makeAgreement({
        participants: [{ role: 'planner', action: 'produced' }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('approved action'))).toBe(true);
  });

  it('rejects agreement with no reviewed artifacts', () => {
    const result = validator.validate(makeAgreement({ reviewedArtifacts: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('reviewed artifact'))).toBe(true);
  });

  it('rejects approved agreement with critical unresolved findings', () => {
    const result = validator.validate(
      makeAgreement({
        approvalStatus: 'approved',
        unresolvedFindings: [{ id: 'f1', severity: 'high', status: 'open', title: 'Critical bug' }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('critical/high'))).toBe(true);
  });

  it('rejects conditionally_approved without conditions', () => {
    const result = validator.validate(
      makeAgreement({
        approvalStatus: 'conditionally_approved',
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('conditions'))).toBe(true);
  });

  it('accepts conditionally_approved with conditions', () => {
    const result = validator.validate(
      makeAgreement({
        approvalStatus: 'conditionally_approved',
        conditions: 'Must fix before deployment',
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('warns when approved with low-severity unresolved findings', () => {
    const result = validator.validate(
      makeAgreement({
        unresolvedFindings: [{ id: 'f1', severity: 'low', status: 'open', title: 'Nit' }],
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects agreement without runId', () => {
    const result = validator.validate(makeAgreement({ runId: '' }));
    expect(result.valid).toBe(false);
  });

  it('rejects agreement without stageId', () => {
    const result = validator.validate(makeAgreement({ stageId: '' }));
    expect(result.valid).toBe(false);
  });
});
