import type {
  PolicyContext,
  PolicyDecision,
  PolicyDefinition,
  PolicyScope,
  PolicyTypeInfo,
  PolicyValidationResult,
  ResolvedPolicySet,
} from '@ai-orchestrator/schemas';

/**
 * Facade port combining policy evaluation, resolution, and validation.
 *
 * Use this when a consumer needs the full policy lifecycle. For
 * fine-grained composition, use the decomposed ports instead:
 * {@link PolicyEvaluator}, {@link PolicyResolver}, {@link PolicyRegistry}.
 */
export interface PolicyEngine {
  /** Evaluate all applicable policies against the given context. */
  evaluate(context: PolicyContext): PolicyDecision;

  /** Resolve all policies that apply to the given scope. */
  resolve(scope: PolicyScope): ResolvedPolicySet;

  /** Validate a policy definition for correctness. */
  validate(definition: PolicyDefinition): PolicyValidationResult;

  /** List all registered policy types. */
  listPolicyTypes(): readonly PolicyTypeInfo[];
}
