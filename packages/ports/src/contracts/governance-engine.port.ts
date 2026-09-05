import type {
  AgreementStatus,
  GovernanceDecision,
  TransitionDecision,
  TransitionRequest,
} from '@ai-dev-orchestrator/schemas';

/** Port for governance evaluation of workflow transitions. */
export interface GovernanceEngine {
  /** Evaluate whether a transition is allowed, denied, or requires escalation. */
  evaluateTransition(request: TransitionRequest): TransitionDecision;

  /** Check whether a required agreement exists for a stage. */
  checkAgreement(stageId: string): AgreementStatus;

  /** Record a governance decision for audit trail. */
  recordDecision(decision: GovernanceDecision): void;
}
