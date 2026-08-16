// Domain — Workflow DSL
export { WorkflowParseError, WorkflowValidationFailedError } from './domain/workflow-dsl/index';

// Domain — Workflow Engine
export {
  ActionExecutionError,
  GuardEvaluationError,
  InvalidStateError,
  MaxTransitionsExceededError,
  TransitionError,
  WorkflowDefinitionError,
  WorkflowTimeoutError,
} from './domain/workflow-engine/index';

// Infrastructure — Workflow DSL
export { WorkflowParser, WorkflowValidator } from './infrastructure/workflow-dsl/index';

// Infrastructure — Workflow Engine
export {
  ActionDispatcher,
  EscalationHandler,
  GuardChecker,
  LifecycleController,
  ReviewResultInterpreter,
  StateHistory,
  TransitionEvaluator,
} from './infrastructure/workflow-engine/index';
export type { LifecycleControllerOptions } from './infrastructure/workflow-engine/index';
