import type { PolicyEngine } from '@ai-orchestrator/ports';
import type {
  EscalationTrigger,
  PolicyContext,
  PolicyDecision,
  PolicyDefinition,
  PolicyResult,
  PolicyScope,
  PolicyTypeInfo,
  PolicyValidationResult,
  ResolvedPolicySet,
} from '@ai-orchestrator/schemas';

import type { DefaultPolicyRegistry } from './policy-registry';
import type { PolicyResolver } from './policy-resolver';

/** Default stateless policy engine that resolves, evaluates, and synthesizes policy decisions. */
export class DefaultPolicyEngine implements PolicyEngine {
  private readonly registry: DefaultPolicyRegistry;
  private readonly resolver: PolicyResolver;

  constructor(registry: DefaultPolicyRegistry, resolver: PolicyResolver) {
    this.registry = registry;
    this.resolver = resolver;
  }

  /**
   * Evaluate all resolved policies against a runtime context.
   * @param context - Current run state, iteration count, and artifacts
   * @returns Aggregated decision: allow, deny, or escalate
   */
  evaluate(context: PolicyContext): PolicyDecision {
    const resolved = this.resolver.resolve({});
    const results: PolicyResult[] = [];
    let escalationTrigger: EscalationTrigger | undefined;

    for (const policy of resolved.policies) {
      const evaluator = this.registry.getEvaluator(policy.type);
      const result = evaluator.evaluate(policy, context);
      results.push(result);

      if (result.escalationTrigger) {
        escalationTrigger = result.escalationTrigger;
      }
    }

    if (escalationTrigger) {
      return {
        outcome: 'escalate',
        results,
        reason: `Escalation triggered: ${escalationTrigger}`,
        escalationTrigger,
      };
    }

    const failures = results.filter((r) => r.outcome === 'fail');
    if (failures.length > 0) {
      const reasons = failures.map((f) => f.reason);
      return {
        outcome: 'deny',
        results,
        reason: reasons.join('; '),
        remediations: failures.map((f) => `Fix: ${f.reason}`),
      };
    }

    return {
      outcome: 'allow',
      results,
      reason: 'All policies passed',
    };
  }

  /**
   * Resolve the effective policy set for a given scope.
   * @param scope - Scope filter for policy resolution
   * @returns Merged policy set with full audit trail
   */
  resolve(scope: PolicyScope): ResolvedPolicySet {
    return this.resolver.resolve(scope);
  }

  /**
   * Validate a policy definition against the registry.
   * @param definition - Policy definition to validate
   * @returns Validation result with errors and warnings
   */
  validate(definition: PolicyDefinition): PolicyValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      this.registry.getEvaluator(definition.type);
    } catch {
      warnings.push(`No evaluator registered for type "${definition.type}"`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /** @inheritdoc */
  listPolicyTypes(): readonly PolicyTypeInfo[] {
    return this.registry.listTypes();
  }
}
