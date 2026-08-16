/** Evaluates iteration count against configured limits. */
import type { PolicyEvaluator } from '@ai-orchestrator/ports';
import type { PolicyContext, PolicyDefinition, PolicyResult } from '@ai-orchestrator/schemas';
export class IterationLimitEvaluator implements PolicyEvaluator {
  /** @inheritdoc */
  evaluate(policy: PolicyDefinition, context: PolicyContext): PolicyResult {
    if (policy.type !== 'iteration_limit') {
      throw new Error(`Expected iteration_limit policy, got ${policy.type}`);
    }
    const { config } = policy;

    const iterationCount = context.iterationCount ?? 0;
    const currentState = context.currentState;

    let limit: number;
    if (currentState === 'WAITING_FOR_HUMAN' || currentState === 'REFINEMENT') {
      limit = config.maxClarificationRounds;
    } else {
      limit = config.maxReviewIterations;
    }

    if (iterationCount < limit) {
      return {
        policyId: policy.id,
        policyType: policy.type,
        outcome: 'pass',
        reason: `Iteration ${String(iterationCount)} is within limit of ${String(limit)}`,
        source: { layer: 'builtin' },
      };
    }

    return {
      policyId: policy.id,
      policyType: policy.type,
      outcome: 'fail',
      reason: `Iteration limit exceeded: ${String(iterationCount)} >= ${String(limit)}`,
      source: { layer: 'builtin' },
      escalationTrigger: 'iteration_limit_exceeded',
    };
  }
}
