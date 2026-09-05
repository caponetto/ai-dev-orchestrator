/** Evaluates whether the retry count exceeds the configured maximum. */
import type { PolicyEvaluator } from '@ai-dev-orchestrator/ports';
import type { PolicyContext, PolicyDefinition, PolicyResult } from '@ai-dev-orchestrator/schemas';
export class RetryLimitEvaluator implements PolicyEvaluator {
  /** @inheritdoc */
  evaluate(policy: PolicyDefinition, context: PolicyContext): PolicyResult {
    if (policy.type !== 'retry_limit') {
      throw new Error(`Expected retry_limit policy, got ${policy.type}`);
    }
    const { config } = policy;

    const retryCount = context.metadata?.retryCount ?? 0;
    const maxRetries = config.maxRetries;

    if (retryCount < maxRetries) {
      return {
        policyId: policy.id,
        policyType: policy.type,
        outcome: 'pass',
        reason: `Retry ${String(retryCount)} is within limit of ${String(maxRetries)}`,
        source: { layer: 'builtin' },
      };
    }

    return {
      policyId: policy.id,
      policyType: policy.type,
      outcome: 'fail',
      reason: `Retry limit exceeded: ${String(retryCount)} >= ${String(maxRetries)}`,
      source: { layer: 'builtin' },
      escalationTrigger: 'retry_limit_exceeded',
    };
  }
}
