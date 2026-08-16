import { describe, expect, it } from 'vitest';

import { AgreementGenerator } from '../agreement-generator';

describe('AgreementGenerator', () => {
  it('generates a planning agreement', () => {
    const generator = new AgreementGenerator();
    const agreement = generator.generate(
      'planning_agreement',
      'run-001',
      'PLAN_REVIEW',
      [
        { role: 'planner', action: 'produced' },
        { role: 'plan_reviewer', action: 'approved' },
      ],
      [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
      [],
      'approved',
      'automated',
    );

    expect(agreement.type).toBe('planning_agreement');
    expect(agreement.runId).toBe('run-001');
    expect(agreement.stageId).toBe('PLAN_REVIEW');
    expect(agreement.approvalStatus).toBe('approved');
    expect(agreement.approvalType).toBe('automated');
    expect(agreement.participants).toHaveLength(2);
    expect(agreement.unresolvedFindings).toHaveLength(0);
  });

  it('separates unresolved findings from total findings', () => {
    const generator = new AgreementGenerator();
    const findings = [
      { id: 'f1', severity: 'high', status: 'open', title: 'Bug' },
      { id: 'f2', severity: 'medium', status: 'accepted', title: 'Fixed' },
      { id: 'f3', severity: 'low', status: 'escalated', title: 'Escalated issue' },
    ];

    const agreement = generator.generate(
      'implementation_agreement',
      'run-001',
      'CODE_REVIEW',
      [{ role: 'implementer', action: 'produced' }],
      [{ type: 'implementation', name: 'impl', version: 1, checksum: 'x' }],
      findings,
      'rejected',
      'automated',
    );

    expect(agreement.findings).toHaveLength(3);
    expect(agreement.unresolvedFindings).toHaveLength(2);
    expect(agreement.unresolvedFindings.map((f) => f.id)).toEqual(['f1', 'f3']);
  });

  it('includes a timestamp', () => {
    const generator = new AgreementGenerator();
    const agreement = generator.generate(
      'verification_agreement',
      'run-001',
      'VERIFICATION',
      [{ role: 'verifier', action: 'approved' }],
      [{ type: 'verification', name: 'tests', version: 1, checksum: 'y' }],
      [],
      'approved',
      'automated',
    );

    expect(agreement.timestamp).toBeDefined();
    expect(typeof agreement.timestamp).toBe('string');
  });

  it('hasApprovalParticipant returns approved when reviewers present', () => {
    const generator = new AgreementGenerator();
    const verdict = generator.hasApprovalParticipant([
      { role: 'planner', action: 'produced' },
      { role: 'plan_reviewer', action: 'reviewed' },
    ]);
    expect(verdict).toBe('approved');
  });

  it('hasApprovalParticipant returns approved when approvers present', () => {
    const generator = new AgreementGenerator();
    const verdict = generator.hasApprovalParticipant([{ role: 'verifier', action: 'approved' }]);
    expect(verdict).toBe('approved');
  });

  it('hasApprovalParticipant returns rejected when no reviewers or approvers', () => {
    const generator = new AgreementGenerator();
    const verdict = generator.hasApprovalParticipant([{ role: 'planner', action: 'produced' }]);
    expect(verdict).toBe('rejected');
  });

  it('hasApprovalParticipant returns rejected for empty participants', () => {
    const generator = new AgreementGenerator();
    const verdict = generator.hasApprovalParticipant([]);
    expect(verdict).toBe('rejected');
  });

  it('serializes agreement to JSON', () => {
    const generator = new AgreementGenerator();
    const agreement = generator.generate(
      'planning_agreement',
      'run-001',
      'PLAN_REVIEW',
      [{ role: 'planner', action: 'approved' }],
      [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
      [],
      'approved',
      'automated',
    );

    const json = generator.serialize(agreement);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['version']).toBe(1);
    expect(parsed['agreementType']).toBe('planning_agreement');
    expect(parsed['runId']).toBe('run-001');
  });
});
