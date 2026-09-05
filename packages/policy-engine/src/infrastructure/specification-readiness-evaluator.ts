/** Evaluates whether the canonical specification meets readiness criteria before proceeding. */
import type { PolicyEvaluator } from '@ai-dev-orchestrator/ports';
import type { PolicyContext, PolicyDefinition, PolicyResult } from '@ai-dev-orchestrator/schemas';
export class SpecificationReadinessEvaluator implements PolicyEvaluator {
  /** @inheritdoc */
  evaluate(policy: PolicyDefinition, context: PolicyContext): PolicyResult {
    if (policy.type !== 'specification_readiness') {
      throw new Error(`Expected specification_readiness policy, got ${policy.type}`);
    }
    const { config } = policy;

    const failures: string[] = [];

    const hasSpec = context.artifacts.some((a) => a.type === 'canonical_specification');
    if (!hasSpec) {
      failures.push('Canonical specification artifact is required but not found');
    }

    const completeness = context.metadata?.completenessScore;
    if (completeness !== undefined && completeness < config.minCompletenessScore) {
      failures.push(
        `Completeness score ${String(completeness)} is below minimum ${String(config.minCompletenessScore)}`,
      );
    }

    const ambiguities = context.metadata?.ambiguityCount ?? 0;
    if (ambiguities > 0) {
      failures.push(`${String(ambiguities)} ambiguities found; none are allowed`);
    }

    if (failures.length > 0) {
      return {
        policyId: policy.id,
        policyType: policy.type,
        outcome: 'fail',
        reason: failures.join('; '),
        source: { layer: 'builtin' },
      };
    }

    return {
      policyId: policy.id,
      policyType: policy.type,
      outcome: 'pass',
      reason: 'Specification meets readiness criteria',
      source: { layer: 'builtin' },
    };
  }
}
