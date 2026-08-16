/** Checks whether the role has ownership permission for the artifact type in context. */
import type { PolicyEvaluator } from '@ai-orchestrator/ports';
import type { PolicyContext, PolicyDefinition, PolicyResult } from '@ai-orchestrator/schemas';
export class OwnershipEvaluator implements PolicyEvaluator {
  /** @inheritdoc */
  evaluate(policy: PolicyDefinition, context: PolicyContext): PolicyResult {
    if (policy.type !== 'ownership') {
      throw new Error(`Expected ownership policy, got ${policy.type}`);
    }
    const { config } = policy;

    const role = context.role;
    const strict = config.strict;

    if (!role) {
      if (strict) {
        return {
          policyId: policy.id,
          policyType: policy.type,
          outcome: 'fail',
          reason: 'No role specified in context; strict ownership requires a role',
          source: { layer: 'builtin' },
        };
      }
      return {
        policyId: policy.id,
        policyType: policy.type,
        outcome: 'pass',
        reason: 'No role specified; ownership check skipped (non-strict mode)',
        source: { layer: 'builtin' },
      };
    }

    const ownershipMap = config.ownershipMap;
    const ownedTypes = ownershipMap[role] ?? [];
    const artifactTypes = context.artifacts.map((a) => a.type);
    const violations = artifactTypes.filter((t) => !ownedTypes.includes(t));

    if (violations.length === 0) {
      return {
        policyId: policy.id,
        policyType: policy.type,
        outcome: 'pass',
        reason: `Role "${role}" has ownership of all artifact types`,
        source: { layer: 'builtin' },
      };
    }

    return {
      policyId: policy.id,
      policyType: policy.type,
      outcome: 'fail',
      reason: `Role "${role}" lacks ownership of artifact types: ${violations.join(', ')}`,
      source: { layer: 'builtin' },
    };
  }
}
