import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';
import type { ValidationError } from '@ai-dev-orchestrator/schemas';

/** Thrown when a template contains invalid syntax. */
export class TemplateSyntaxError extends NonRecoverableErrorBase {
  readonly code = 'TEMPLATE_SYNTAX_ERROR';

  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    const location =
      line !== undefined
        ? ` at line ${String(line)}${column !== undefined ? `:${String(column)}` : ''}`
        : '';
    super(`Template syntax error${location}: ${message}`);
  }
}

/** Thrown when a template references an undefined variable. */
export class UndefinedVariableError extends NonRecoverableErrorBase {
  readonly code = 'UNDEFINED_VARIABLE';

  constructor(
    readonly variableName: string,
    readonly templateRole: string,
  ) {
    super(`Undefined variable "${variableName}" in template for role "${templateRole}"`);
  }
}

/** Thrown when a template includes a partial that does not exist. */
export class MissingPartialError extends NonRecoverableErrorBase {
  readonly code = 'MISSING_PARTIAL';

  constructor(readonly partialName: string) {
    super(`Missing partial template: "${partialName}"`);
  }
}

/** Thrown when a required template variable has no value at render time. */
export class RequiredVariableMissingError extends NonRecoverableErrorBase {
  readonly code = 'REQUIRED_VARIABLE_MISSING';

  constructor(
    readonly variableName: string,
    readonly templateRole: string,
  ) {
    super(
      `Required variable "${variableName}" has no value in template for role "${templateRole}". ` +
        `The upstream artifact or input was not provided.`,
    );
  }
}

/** Thrown when the prompt exceeds the available token budget. */
export class TokenBudgetExceededError extends NonRecoverableErrorBase {
  readonly code = 'TOKEN_BUDGET_EXCEEDED';

  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(
      `Token budget exceeded: prompt requires ${String(required)} tokens but only ${String(available)} available`,
    );
  }
}

/** Thrown when an output schema referenced by a contract cannot be found. */
export class OutputSchemaNotFoundError extends NonRecoverableErrorBase {
  readonly code = 'OUTPUT_SCHEMA_NOT_FOUND';

  constructor(readonly schemaName: string) {
    super(`Output schema not found: "${schemaName}"`);
  }
}

/** Thrown when the repair loop exhausts all attempts without valid output. */
export class RepairExhaustedError extends NonRecoverableErrorBase {
  readonly code = 'REPAIR_EXHAUSTED';

  constructor(
    readonly attempts: number,
    readonly lastErrors: readonly ValidationError[],
  ) {
    const details = lastErrors.map((e) => `${e.path}: ${e.message}`).join('; ');
    super(`Repair exhausted after ${String(attempts)} attempts; remaining errors: ${details}`);
  }
}
