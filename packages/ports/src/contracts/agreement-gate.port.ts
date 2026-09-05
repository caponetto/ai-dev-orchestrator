import type { AgreementGateResult, AgreementType } from '@ai-dev-orchestrator/schemas';

/** Port for checking whether a required agreement exists and is valid. */
export interface AgreementGate {
  /** Check whether an agreement of the given type exists for a run. */
  check(agreementType: AgreementType, runId: string): AgreementGateResult;
  /** Register an agreement result so subsequent check() calls reflect it. */
  register(agreementType: AgreementType, result: AgreementGateResult): void;
}
