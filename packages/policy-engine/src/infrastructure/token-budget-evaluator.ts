/** Evaluates whether token usage exceeds the configured budget. */
import type { PolicyEvaluator } from '@ai-orchestrator/ports';
import type { PolicyContext, PolicyDefinition, PolicyResult } from '@ai-orchestrator/schemas';
export class TokenBudgetEvaluator implements PolicyEvaluator {
  /** @inheritdoc */
  evaluate(policy: PolicyDefinition, context: PolicyContext): PolicyResult {
    if (policy.type !== 'token_budget') {
      throw new Error(`Expected token_budget policy, got ${policy.type}`);
    }
    const { config } = policy;

    const tokensUsed = context.tokenUsage?.totalTokens ?? 0;
    const maxTokens = config.maxTokens;

    if (tokensUsed <= maxTokens) {
      return {
        policyId: policy.id,
        policyType: policy.type,
        outcome: 'pass',
        reason: `Token usage ${String(tokensUsed)} is within budget of ${String(maxTokens)}`,
        source: { layer: 'builtin' },
      };
    }

    return {
      policyId: policy.id,
      policyType: policy.type,
      outcome: 'fail',
      reason: `Token budget exceeded: ${String(tokensUsed)} > ${String(maxTokens)}`,
      source: { layer: 'builtin' },
      escalationTrigger: 'token_budget_exceeded',
    };
  }
}
