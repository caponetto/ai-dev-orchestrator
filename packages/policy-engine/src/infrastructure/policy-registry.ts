import type {
  PolicyEvaluator,
  PolicyRegistry as PolicyRegistryPort,
} from '@ai-dev-orchestrator/ports';
import type { PolicyType, PolicyTypeInfo } from '@ai-dev-orchestrator/schemas';

import { UnknownPolicyTypeError } from '../domain/errors';

import { ConfidenceEvaluator } from './confidence-evaluator';
import { CustomEvaluator } from './custom-evaluator';
import { IterationLimitEvaluator } from './iteration-limit-evaluator';
import { ModelConstraintEvaluator } from './model-constraint-evaluator';
import { OwnershipEvaluator } from './ownership-evaluator';
import { QualityGateEvaluator } from './quality-gate-evaluator';
import { RetryLimitEvaluator } from './retry-limit-evaluator';
import { SpecificationReadinessEvaluator } from './specification-readiness-evaluator';
import { StageSkipEvaluator } from './stage-skip-evaluator';
import { TokenBudgetEvaluator } from './token-budget-evaluator';

const BUILT_IN_EVALUATORS: readonly {
  type: PolicyType;
  evaluator: PolicyEvaluator;
  description: string;
}[] = [
  {
    type: 'iteration_limit',
    evaluator: new IterationLimitEvaluator(),
    description: 'Limits the number of iterations in produce-review loops',
  },
  {
    type: 'quality_gate',
    evaluator: new QualityGateEvaluator(),
    description: 'Evaluates artifacts against quality thresholds',
  },
  {
    type: 'specification_readiness',
    evaluator: new SpecificationReadinessEvaluator(),
    description: 'Evaluates whether canonical specification meets readiness criteria',
  },
  {
    type: 'stage_skip',
    evaluator: new StageSkipEvaluator(),
    description: 'Checks if a stage should be skipped based on configured criteria',
  },
  {
    type: 'retry_limit',
    evaluator: new RetryLimitEvaluator(),
    description: 'Checks if retry count exceeds configured maximum',
  },
  {
    type: 'token_budget',
    evaluator: new TokenBudgetEvaluator(),
    description: 'Checks if token usage exceeds configured budget',
  },
  {
    type: 'model_constraint',
    evaluator: new ModelConstraintEvaluator(),
    description: 'Validates that the model matches configured allowed models list',
  },
  {
    type: 'ownership',
    evaluator: new OwnershipEvaluator(),
    description: 'Checks if the role has ownership permission for artifact types',
  },
  {
    type: 'confidence_gate',
    evaluator: new ConfidenceEvaluator(),
    description: 'Evaluates agent confidence and triggers model or human escalation',
  },
  {
    type: 'custom',
    evaluator: new CustomEvaluator(),
    description: 'Pass-through evaluator for custom extensibility',
  },
];

/** Registry of policy type evaluators with built-in types pre-registered. */
export class DefaultPolicyRegistry implements PolicyRegistryPort {
  private readonly evaluators = new Map<PolicyType, PolicyEvaluator>();
  private readonly typeInfos = new Map<PolicyType, PolicyTypeInfo>();

  constructor() {
    for (const entry of BUILT_IN_EVALUATORS) {
      this.evaluators.set(entry.type, entry.evaluator);
      this.typeInfos.set(entry.type, {
        type: entry.type,
        description: entry.description,
        configSchema: {},
        builtIn: true,
      });
    }
  }

  /**
   * Register a policy evaluator for a given type.
   * @param type - Policy type identifier
   * @param evaluator - Evaluator that handles this policy type
   */
  registerType(type: PolicyType, evaluator: PolicyEvaluator): void {
    this.evaluators.set(type, evaluator);
    if (!this.typeInfos.has(type)) {
      this.typeInfos.set(type, {
        type,
        description: `Custom policy type: ${type}`,
        configSchema: {},
        builtIn: false,
      });
    }
  }

  /**
   * Get the evaluator for a policy type.
   * @param type - Policy type to look up
   * @returns The registered evaluator
   * @throws UnknownPolicyTypeError if no evaluator is registered for the type
   */
  getEvaluator(type: PolicyType): PolicyEvaluator {
    const evaluator = this.evaluators.get(type);
    if (!evaluator) {
      throw new UnknownPolicyTypeError(type);
    }
    return evaluator;
  }

  /** @inheritdoc */
  listTypes(): readonly PolicyTypeInfo[] {
    return [...this.typeInfos.values()];
  }
}
