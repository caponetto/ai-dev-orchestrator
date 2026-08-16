import type { AgreementArtifact, AgreementValidationResult } from '@ai-orchestrator/schemas';

/** Port for validating agreement artifact integrity. */
export interface AgreementValidator {
  /** Validate an agreement artifact for structural and semantic correctness. */
  validate(agreement: AgreementArtifact): AgreementValidationResult;
}
