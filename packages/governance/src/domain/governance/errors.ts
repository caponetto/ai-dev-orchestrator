import { NonRecoverableErrorBase } from '@ai-orchestrator/ports';

/** Thrown when governance evaluation fails unexpectedly. */
export class GovernanceError extends NonRecoverableErrorBase {
  readonly code = 'GOVERNANCE_ERROR';

  constructor(readonly cause: string) {
    super(`Governance evaluation failed: ${cause}`);
  }
}

/** Thrown when governance policy cannot be loaded. */
export class PolicyLoadError extends NonRecoverableErrorBase {
  readonly code = 'POLICY_LOAD_ERROR';

  constructor(readonly cause: string) {
    super(`Failed to load governance policy: ${cause}`);
  }
}

/** Thrown when escalation handling fails. */
export class EscalationError extends NonRecoverableErrorBase {
  readonly code = 'ESCALATION_ERROR';

  constructor(
    readonly stageId: string,
    readonly cause: string,
  ) {
    super(`Escalation failed at stage "${stageId}": ${cause}`);
  }
}
