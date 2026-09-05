import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';
import type { PolicyType } from '@ai-dev-orchestrator/schemas';

/** Thrown when a policy evaluation fails unexpectedly. */
export class PolicyEvaluationError extends NonRecoverableErrorBase {
  readonly code = 'POLICY_EVALUATION_ERROR';

  constructor(
    readonly policyId: string,
    readonly cause: string,
  ) {
    super(`Policy evaluation failed for "${policyId}": ${cause}`);
  }
}

/** Thrown when a policy definition is invalid or misconfigured. */
export class PolicyConfigurationError extends NonRecoverableErrorBase {
  readonly code = 'POLICY_CONFIGURATION_ERROR';

  constructor(
    readonly policyId: string,
    readonly cause: string,
  ) {
    super(`Invalid policy configuration for "${policyId}": ${cause}`);
  }
}

/** Thrown when an unregistered policy type is referenced. */
export class UnknownPolicyTypeError extends NonRecoverableErrorBase {
  readonly code = 'UNKNOWN_POLICY_TYPE';

  constructor(readonly policyType: PolicyType) {
    super(`Unknown policy type: "${policyType}"`);
  }
}

/** Thrown when policy resolution fails. */
export class PolicyResolverError extends NonRecoverableErrorBase {
  readonly code = 'POLICY_RESOLVER_ERROR';

  constructor(readonly cause: string) {
    super(`Policy resolution failed: ${cause}`);
  }
}
