import type { IterationContractRegistry } from '@ai-dev-orchestrator/ports';
import type { PolicyEvaluation } from '@ai-dev-orchestrator/schemas';

/** Checks iteration counts against contract limits. */
export class IterationLimiter {
  private readonly contractRegistry: IterationContractRegistry;

  constructor(contractRegistry: IterationContractRegistry) {
    this.contractRegistry = contractRegistry;
  }

  /** Evaluate whether the iteration limit has been reached for the given state. */
  evaluate(stateId: string, iterationCount: number): PolicyEvaluation {
    const contract = this.contractRegistry.getContractForState(stateId);

    if (!contract) {
      return {
        policy: 'iteration_limit',
        evaluated: false,
        result: 'skip',
        detail: `No iteration contract for state "${stateId}"`,
      };
    }

    if (iterationCount < contract.maxIterations) {
      return {
        policy: 'iteration_limit',
        evaluated: true,
        result: 'pass',
        detail: `Iteration ${String(iterationCount)} within limit of ${String(contract.maxIterations)}`,
      };
    }

    return {
      policy: 'iteration_limit',
      evaluated: true,
      result: 'fail',
      detail: `Iteration limit exceeded: ${String(iterationCount)} >= ${String(contract.maxIterations)}`,
    };
  }
}
