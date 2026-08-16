import { NonRecoverableErrorBase } from '@ai-orchestrator/ports';

/** Thrown when a workflow definition is structurally invalid. */
export class WorkflowDefinitionError extends NonRecoverableErrorBase {
  readonly code = 'WORKFLOW_DEFINITION_ERROR';

  constructor(readonly cause: string) {
    super(`Invalid workflow definition: ${cause}`);
  }
}

/** Thrown when a referenced state does not exist in the workflow. */
export class InvalidStateError extends NonRecoverableErrorBase {
  readonly code = 'INVALID_STATE';

  constructor(readonly stateId: string) {
    super(`State "${stateId}" does not exist in the workflow definition`);
  }
}

/** Thrown when a transition cannot be completed. */
export class TransitionError extends NonRecoverableErrorBase {
  readonly code = 'TRANSITION_ERROR';

  constructor(
    readonly from: string,
    readonly to: string,
    readonly cause: string,
  ) {
    super(`Transition from "${from}" to "${to}" failed: ${cause}`);
  }
}

/** Thrown when a guard evaluation fails unexpectedly. */
export class GuardEvaluationError extends NonRecoverableErrorBase {
  readonly code = 'GUARD_EVALUATION_ERROR';

  constructor(
    readonly guardType: string,
    readonly cause: string,
  ) {
    super(`Guard evaluation failed for type "${guardType}": ${cause}`);
  }
}

/** Thrown when an action execution fails. */
export class ActionExecutionError extends NonRecoverableErrorBase {
  readonly code = 'ACTION_EXECUTION_ERROR';

  constructor(
    readonly actionType: string,
    readonly cause: string,
  ) {
    super(`Action execution failed for type "${actionType}": ${cause}`);
  }
}

/** Thrown when a state exceeds its timeout. */
export class WorkflowTimeoutError extends NonRecoverableErrorBase {
  readonly code = 'WORKFLOW_TIMEOUT';

  constructor(
    readonly stateId: string,
    readonly timeoutMs: number,
  ) {
    super(`State "${stateId}" timed out after ${String(timeoutMs)}ms`);
  }
}

/** Thrown when the global transition limit is exceeded. */
export class MaxTransitionsExceededError extends NonRecoverableErrorBase {
  readonly code = 'MAX_TRANSITIONS_EXCEEDED';

  constructor(
    readonly count: number,
    readonly limit: number,
  ) {
    super(
      `Maximum transitions exceeded: ${String(count)} transitions reached (limit: ${String(limit)})`,
    );
  }
}
