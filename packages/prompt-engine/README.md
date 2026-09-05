# @ai-dev-orchestrator/prompt-engine

Template engine for assembling agent prompts with variable substitution, partial includes, token budget management, and output validation. Builds the context window that agents receive at each workflow step.

## Architecture Layer

**Domain** -- handles template loading, rendering, token estimation, and context assembly.

## Workspace Dependencies

- `@ai-dev-orchestrator/artifacts`
- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/schemas`
- `@ai-dev-orchestrator/utils`

## Structure

```
src/
  domain/
    __tests__/
  infrastructure/
    __tests__/
```

## Key Exports

### Domain

- `TemplateSyntaxError` -- thrown for malformed template syntax
- `RequiredVariableMissingError` -- thrown when a required template variable is not provided
- `UndefinedVariableError` -- thrown when a template references an undefined variable
- `MissingPartialError` -- thrown when a referenced partial template is not found
- `TokenBudgetExceededError` -- thrown when rendered output exceeds the token budget
- `OutputSchemaNotFoundError` -- thrown when the expected output schema is missing
- `RepairExhaustedError` -- thrown when output repair attempts are exhausted

### Infrastructure

- `DefaultPromptEngine` -- main engine coordinating template rendering and validation
- `DefaultTemplateRegistry` -- stores and retrieves prompt templates
- `DefaultTokenEstimator` -- estimates token counts for rendered prompts
- `TokenBudgetManager` -- allocates and tracks token budgets across prompt sections
- `ContextAssembler` -- assembles the full context from templates, artifacts, and state
- `renderTemplate` -- renders a single template with variable bindings
- `loadTemplatesFromDirectory`, `loadPartialsFromDirectory` -- bulk-load templates from disk
- `loadTemplateFromMarkdown` -- parses a template from a Markdown file
- `validateOutput` -- validates agent output against an expected schema
- `RenderContext` -- type describing the variables available during rendering
