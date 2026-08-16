import type { AgreementValidator as AgreementValidatorPort } from '@ai-orchestrator/ports';
import type { AgreementArtifact, AgreementValidationResult } from '@ai-orchestrator/schemas';

/** Validates agreement artifacts for structural and semantic correctness. */
export class DefaultAgreementValidator implements AgreementValidatorPort {
  /** @inheritdoc */
  validate(agreement: AgreementArtifact): AgreementValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (agreement.participants.length === 0) {
      errors.push('Agreement must have at least one participant');
    }

    const hasApprover = agreement.participants.some((p) => p.action === 'approved');
    if (!hasApprover) {
      errors.push('Agreement must have at least one participant with approved action');
    }

    if (agreement.reviewedArtifacts.length === 0) {
      errors.push('Agreement must reference at least one reviewed artifact');
    }

    if (
      agreement.approvalStatus === 'approved' ||
      agreement.approvalStatus === 'conditionally_approved'
    ) {
      const criticalUnresolved = agreement.unresolvedFindings.filter(
        (f) => f.severity === 'critical' || f.severity === 'high',
      );
      if (criticalUnresolved.length > 0) {
        errors.push(
          `Cannot approve with ${String(criticalUnresolved.length)} critical/high unresolved findings`,
        );
      }
    }

    if (agreement.approvalStatus === 'conditionally_approved' && !agreement.conditions) {
      errors.push('Conditionally approved agreements must specify conditions');
    }

    if (!agreement.runId) {
      errors.push('Agreement must have a runId');
    }

    if (!agreement.stageId) {
      errors.push('Agreement must have a stageId');
    }

    if (agreement.unresolvedFindings.length > 0 && agreement.approvalStatus === 'approved') {
      warnings.push(
        `Agreement approved with ${String(agreement.unresolvedFindings.length)} unresolved findings`,
      );
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}
