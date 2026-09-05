import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';
import type { AgreementType } from '@ai-dev-orchestrator/schemas';

/** Thrown when an agreement artifact fails validation. */
export class InvalidAgreementError extends NonRecoverableErrorBase {
  readonly code = 'INVALID_AGREEMENT';

  constructor(
    readonly agreementType: AgreementType,
    readonly cause: string,
  ) {
    super(`Invalid agreement artifact "${agreementType}": ${cause}`);
  }
}

/** Thrown when an agreement gate check fails. */
export class AgreementGateError extends NonRecoverableErrorBase {
  readonly code = 'AGREEMENT_GATE_ERROR';

  constructor(
    readonly agreementType: AgreementType,
    readonly cause: string,
  ) {
    super(`Agreement gate failed for "${agreementType}": ${cause}`);
  }
}
