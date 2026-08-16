import { describe, expect, it } from 'vitest';

import type { ReviewerVote } from '../agreement-generator';
import { AgreementGenerator } from '../agreement-generator';

describe('AgreementGenerator — Verdict Computation', () => {
  const generator = new AgreementGenerator();

  describe('hasApprovalParticipant()', () => {
    it('returns approved when all participants approved', () => {
      const result = generator.hasApprovalParticipant([
        { role: 'reviewer', action: 'approved' },
        { role: 'architect', action: 'approved' },
      ]);
      expect(result).toBe('approved');
    });

    it('returns rejected when no approver exists', () => {
      const result = generator.hasApprovalParticipant([
        { role: 'implementer', action: 'produced' },
      ]);
      expect(result).toBe('rejected');
    });
  });

  describe('computeMajorityVerdict()', () => {
    it('returns approved when majority approves', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'approve' },
        { reviewerRole: 'r2', vote: 'approve' },
        { reviewerRole: 'r3', vote: 'reject' },
      ];
      expect(generator.computeMajorityVerdict(votes)).toBe('approved');
    });

    it('returns rejected when majority rejects', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'reject' },
        { reviewerRole: 'r2', vote: 'reject' },
        { reviewerRole: 'r3', vote: 'approve' },
      ];
      expect(generator.computeMajorityVerdict(votes)).toBe('rejected');
    });

    it('returns conditionally_approved on a tie', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'approve' },
        { reviewerRole: 'r2', vote: 'reject' },
      ];
      expect(generator.computeMajorityVerdict(votes)).toBe('conditionally_approved');
    });

    it('ignores abstaining voters', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'approve' },
        { reviewerRole: 'r2', vote: 'abstain' },
        { reviewerRole: 'r3', vote: 'abstain' },
      ];
      expect(generator.computeMajorityVerdict(votes)).toBe('approved');
    });

    it('returns rejected when all abstain', () => {
      const votes: ReviewerVote[] = [{ reviewerRole: 'r1', vote: 'abstain' }];
      expect(generator.computeMajorityVerdict(votes)).toBe('rejected');
    });
  });

  describe('computeQuorumVerdict()', () => {
    it('returns approved when quorum met and no rejections', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'approve' },
        { reviewerRole: 'r2', vote: 'approve' },
        { reviewerRole: 'r3', vote: 'abstain' },
      ];
      expect(generator.computeQuorumVerdict(votes, { minimumApprovals: 2 })).toBe('approved');
    });

    it('returns conditionally_approved when quorum met with rejections', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'approve' },
        { reviewerRole: 'r2', vote: 'approve' },
        { reviewerRole: 'r3', vote: 'reject' },
      ];
      expect(generator.computeQuorumVerdict(votes, { minimumApprovals: 2 })).toBe(
        'conditionally_approved',
      );
    });

    it('returns rejected when quorum not met', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'approve' },
        { reviewerRole: 'r2', vote: 'reject' },
      ];
      expect(generator.computeQuorumVerdict(votes, { minimumApprovals: 2 })).toBe('rejected');
    });
  });

  describe('computeVerdict()', () => {
    it('dispatches to unanimous algorithm', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'approve' },
        { reviewerRole: 'r2', vote: 'approve' },
      ];
      expect(generator.computeVerdict('unanimous', votes)).toBe('approved');
    });

    it('unanimous rejects if any non-abstainer rejects', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'approve' },
        { reviewerRole: 'r2', vote: 'reject' },
      ];
      expect(generator.computeVerdict('unanimous', votes)).toBe('rejected');
    });

    it('dispatches to majority algorithm', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'approve' },
        { reviewerRole: 'r2', vote: 'approve' },
        { reviewerRole: 'r3', vote: 'reject' },
      ];
      expect(generator.computeVerdict('majority', votes)).toBe('approved');
    });

    it('dispatches to quorum algorithm with config', () => {
      const votes: ReviewerVote[] = [
        { reviewerRole: 'r1', vote: 'approve' },
        { reviewerRole: 'r2', vote: 'approve' },
      ];
      expect(generator.computeVerdict('quorum', votes, { minimumApprovals: 2 })).toBe('approved');
    });

    it('uses default quorum config when none provided', () => {
      const votes: ReviewerVote[] = [{ reviewerRole: 'r1', vote: 'approve' }];
      expect(generator.computeVerdict('quorum', votes)).toBe('approved');
    });
  });
});
