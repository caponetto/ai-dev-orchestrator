/** Pass-through evaluator for custom policies. Always returns pass. */
import type { PolicyEvaluator } from '@ai-orchestrator/ports';
import type { PolicyContext, PolicyDefinition, PolicyResult } from '@ai-orchestrator/schemas';
export class CustomEvaluator implements PolicyEvaluator {
  /** @inheritdoc */
  evaluate(policy: PolicyDefinition, _context: PolicyContext): PolicyResult {
    return {
      policyId: policy.id,
      policyType: policy.type,
      outcome: 'pass',
      reason: 'Custom policy pass-through',
      source: { layer: 'builtin' },
    };
  }
}
