import type {
  AgreementArtifact,
  AgreementFinding,
  AgreementParticipant,
  AgreementType,
  ApprovalStatus,
  ApprovalType,
  ArtifactRef,
} from '@ai-dev-orchestrator/schemas';

/** Algorithm for computing approval from votes. */
type VerdictAlgorithm = 'unanimous' | 'majority' | 'quorum';

/** Quorum configuration for verdict computation. */
interface QuorumConfig {
  readonly minimumApprovals: number;
}

/** Single reviewer's vote for verdict computation. */
export interface ReviewerVote {
  readonly reviewerRole: string;
  readonly vote: 'approve' | 'reject' | 'abstain';
}

/** Agreement artifact generator with verdict algorithms. */
export class AgreementGenerator {
  /** Generate agreement artifact from review results. */
  generate(
    type: AgreementType,
    runId: string,
    stageId: string,
    participants: readonly AgreementParticipant[],
    reviewedArtifacts: readonly ArtifactRef[],
    findings: readonly AgreementFinding[],
    approvalStatus: ApprovalStatus,
    approvalType: ApprovalType,
  ): AgreementArtifact {
    const unresolvedFindings = findings.filter(
      (f) => f.status === 'open' || f.status === 'escalated',
    );

    return {
      type,
      runId,
      stageId,
      timestamp: new Date().toISOString(),
      participants,
      reviewedArtifacts,
      findings,
      unresolvedFindings,
      approvalStatus,
      approvalType,
    };
  }

  /** Check whether any participant has reviewed or approved. */
  hasApprovalParticipant(participants: readonly AgreementParticipant[]): ApprovalStatus {
    const hasReviewerOrApprover = participants.some(
      (p) => p.action === 'reviewed' || p.action === 'approved',
    );
    return hasReviewerOrApprover ? 'approved' : 'rejected';
  }

  /** Compute verdict using majority vote. */
  computeMajorityVerdict(votes: readonly ReviewerVote[]): ApprovalStatus {
    const nonAbstaining = votes.filter((v) => v.vote !== 'abstain');
    if (nonAbstaining.length === 0) {
      return 'rejected';
    }

    const approvals = nonAbstaining.filter((v) => v.vote === 'approve').length;
    const rejections = nonAbstaining.filter((v) => v.vote === 'reject').length;

    if (approvals > rejections) {
      return 'approved';
    }
    if (approvals === rejections) {
      return 'conditionally_approved';
    }
    return 'rejected';
  }

  /** Compute verdict using quorum threshold. */
  computeQuorumVerdict(votes: readonly ReviewerVote[], config: QuorumConfig): ApprovalStatus {
    const approvals = votes.filter((v) => v.vote === 'approve').length;
    const rejections = votes.filter((v) => v.vote === 'reject').length;

    if (approvals >= config.minimumApprovals && rejections === 0) {
      return 'approved';
    }
    if (approvals >= config.minimumApprovals && rejections > 0) {
      return 'conditionally_approved';
    }
    return 'rejected';
  }

  /** Compute verdict using specified algorithm. */
  computeVerdict(
    algorithm: VerdictAlgorithm,
    votes: readonly ReviewerVote[],
    quorumConfig?: QuorumConfig,
  ): ApprovalStatus {
    switch (algorithm) {
      case 'unanimous': {
        const nonAbstaining = votes.filter((v) => v.vote !== 'abstain');
        if (nonAbstaining.length === 0) {
          return 'rejected';
        }
        const allApproved = nonAbstaining.every((v) => v.vote === 'approve');
        return allApproved ? 'approved' : 'rejected';
      }
      case 'majority':
        return this.computeMajorityVerdict(votes);
      case 'quorum':
        return this.computeQuorumVerdict(votes, quorumConfig ?? { minimumApprovals: 1 });
      default: {
        const _exhaustive: never = algorithm;
        return _exhaustive;
      }
    }
  }

  /** Serialize agreement to JSON matching the validation schema. */
  serialize(agreement: AgreementArtifact): string {
    return JSON.stringify(
      {
        version: 1,
        agreementType: agreement.type,
        runId: agreement.runId,
        stageId: agreement.stageId,
        createdAt: agreement.timestamp,
        participants: agreement.participants,
        reviewedArtifacts: agreement.reviewedArtifacts,
        findings: agreement.findings,
        unresolvedFindings: agreement.unresolvedFindings,
        approvalStatus: agreement.approvalStatus,
        approvalType: agreement.approvalType,
      },
      null,
      2,
    );
  }
}
