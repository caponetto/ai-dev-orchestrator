/** Validates that the model being used matches the configured allowed models list. */
import type { PolicyEvaluator } from '@ai-orchestrator/ports';
import type { PolicyContext, PolicyDefinition, PolicyResult } from '@ai-orchestrator/schemas';
export class ModelConstraintEvaluator implements PolicyEvaluator {
  /** @inheritdoc */
  evaluate(policy: PolicyDefinition, context: PolicyContext): PolicyResult {
    if (policy.type !== 'model_constraint') {
      throw new Error(`Expected model_constraint policy, got ${policy.type}`);
    }
    const { config } = policy;

    const allowedModels = config.allowedModels;
    const model = context.metadata?.model;

    if (allowedModels.length === 0) {
      return {
        policyId: policy.id,
        policyType: policy.type,
        outcome: 'pass',
        reason: 'No model constraints configured',
        source: { layer: 'builtin' },
      };
    }

    if (model === undefined) {
      return {
        policyId: policy.id,
        policyType: policy.type,
        outcome: 'warn',
        reason: 'No model specified in context; cannot validate constraint',
        source: { layer: 'builtin' },
      };
    }

    if (allowedModels.includes(model)) {
      return {
        policyId: policy.id,
        policyType: policy.type,
        outcome: 'pass',
        reason: `Model "${model}" is in the allowed models list`,
        source: { layer: 'builtin' },
      };
    }

    return {
      policyId: policy.id,
      policyType: policy.type,
      outcome: 'fail',
      reason: `Model "${model}" is not in the allowed models list: ${allowedModels.join(', ')}`,
      source: { layer: 'builtin' },
    };
  }
}
