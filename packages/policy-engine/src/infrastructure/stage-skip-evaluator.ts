/** Evaluates whether a stage should be skipped based on configured criteria. */
import type { PolicyEvaluator } from '@ai-dev-orchestrator/ports';
import type { PolicyContext, PolicyDefinition, PolicyResult } from '@ai-dev-orchestrator/schemas';
export class StageSkipEvaluator implements PolicyEvaluator {
  /** @inheritdoc */
  evaluate(policy: PolicyDefinition, context: PolicyContext): PolicyResult {
    if (policy.type !== 'stage_skip') {
      throw new Error(`Expected stage_skip policy, got ${policy.type}`);
    }
    const { config } = policy;

    const conditions = config.skipWhen;

    for (const condition of conditions) {
      if (this.matchesCondition(condition, context)) {
        return {
          policyId: policy.id,
          policyType: policy.type,
          outcome: 'skip',
          reason: `Stage "${context.currentState}" skipped: ${condition.reason ?? 'condition matched'}`,
          source: { layer: 'builtin' },
          detail: `skip_condition:${condition.field}`,
        };
      }
    }

    return {
      policyId: policy.id,
      policyType: policy.type,
      outcome: 'pass',
      reason: `No skip conditions matched for stage "${context.currentState}"`,
      source: { layer: 'builtin' },
    };
  }

  private matchesCondition(condition: SkipCondition, context: PolicyContext): boolean {
    if (condition.field === 'state' && condition.equals !== undefined) {
      return context.currentState === condition.equals;
    }
    if (condition.field === 'role' && condition.equals !== undefined) {
      return context.role === condition.equals;
    }
    if (condition.field === 'workflowVariant' && condition.equals !== undefined) {
      return context.workflowVariant === condition.equals;
    }
    if (condition.field === 'metadata' && condition.key !== undefined) {
      const value = context.metadata?.[condition.key];
      return value === condition.equals;
    }
    return false;
  }
}

interface SkipCondition {
  readonly field: string;
  readonly key?: string;
  readonly equals?: unknown;
  readonly reason?: string;
}
