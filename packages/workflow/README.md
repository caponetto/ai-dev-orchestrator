# @ai-dev-orchestrator/workflow

Workflow DSL parsing and the state-machine-based workflow engine that drives the orchestration lifecycle. Defines workflow definitions in a declarative DSL, evaluates guards and transitions, dispatches actions, and manages escalation and review interpretation.

## Architecture Layer

**Orchestration** -- controls the end-to-end lifecycle of an orchestration run through a state machine.

## Workspace Dependencies

- `@ai-dev-orchestrator/artifacts`
- `@ai-dev-orchestrator/core`
- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/run-manifest`
- `@ai-dev-orchestrator/schemas`
- `@ai-dev-orchestrator/utils`

## Structure

```
src/
  domain/
    workflow-dsl/
    workflow-engine/
  infrastructure/
    workflow-dsl/
    workflow-engine/
```

## Key Exports

### Workflow DSL

- `WorkflowParser` -- parses workflow definitions from the DSL format
- `WorkflowValidator` -- validates parsed workflow definitions
- **Errors:** `WorkflowParseError`, `WorkflowValidationFailedError`

### Workflow Engine

- `LifecycleController` -- top-level controller that drives the workflow state machine
- `ActionDispatcher` -- dispatches actions triggered by state transitions
- `GuardChecker` -- evaluates guard conditions on transitions
- `TransitionEvaluator` -- determines which transitions are valid
- `EscalationHandler` -- handles escalation when errors or timeouts occur
- `ReviewResultInterpreter` -- interprets review outcomes to determine next transitions
- `StateHistory` -- tracks the history of state transitions
- **Types:** `LifecycleControllerOptions`
- **Errors:** `ActionExecutionError`, `GuardEvaluationError`, `InvalidStateError`, `MaxTransitionsExceededError`, `TransitionError`, `WorkflowDefinitionError`, `WorkflowTimeoutError`
