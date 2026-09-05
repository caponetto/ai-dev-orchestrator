import type {
  PolicyContext,
  PolicyDefinition,
  PolicyResult,
  PolicyScope,
  PolicySource,
  PolicyType,
  PolicyTypeInfo,
  ResolvedPolicySet,
} from '@ai-dev-orchestrator/schemas';

export interface PolicyEvaluator {
  evaluate(policy: PolicyDefinition, context: PolicyContext): PolicyResult;
}

export interface PolicyResolver {
  resolve(scope: PolicyScope): ResolvedPolicySet;
  traceSource(policyId: string, field: string): PolicySource | null;
}

export interface PolicyRegistry {
  registerType(type: PolicyType, evaluator: PolicyEvaluator): void;
  getEvaluator(type: PolicyType): PolicyEvaluator;
  listTypes(): readonly PolicyTypeInfo[];
}
