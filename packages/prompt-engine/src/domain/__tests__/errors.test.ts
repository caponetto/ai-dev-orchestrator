import { OrchestratorError, NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import {
  MissingPartialError,
  OutputSchemaNotFoundError,
  RepairExhaustedError,
  TemplateSyntaxError,
  TokenBudgetExceededError,
  UndefinedVariableError,
} from '../errors';

describe('Prompt engine errors', () => {
  it('TemplateSyntaxError includes location when provided', () => {
    const error = new TemplateSyntaxError('unclosed tag', 10, 5);
    expect(error.code).toBe('TEMPLATE_SYNTAX_ERROR');
    expect(error.line).toBe(10);
    expect(error.column).toBe(5);
    expect(error.message).toContain('line 10:5');
    expect(error.recoverable).toBe(false);
    expect(error).toBeInstanceOf(NonRecoverableErrorBase);
    expect(error).toBeInstanceOf(OrchestratorError);
  });

  it('TemplateSyntaxError works without location', () => {
    const error = new TemplateSyntaxError('invalid syntax');
    expect(error.line).toBeUndefined();
    expect(error.column).toBeUndefined();
    expect(error.message).not.toContain('line');
  });

  it('UndefinedVariableError has correct properties', () => {
    const error = new UndefinedVariableError('spec.content', 'planner');
    expect(error.code).toBe('UNDEFINED_VARIABLE');
    expect(error.variableName).toBe('spec.content');
    expect(error.templateRole).toBe('planner');
  });

  it('MissingPartialError has correct properties', () => {
    const error = new MissingPartialError('output_format');
    expect(error.code).toBe('MISSING_PARTIAL');
    expect(error.partialName).toBe('output_format');
  });

  it('TokenBudgetExceededError has correct properties', () => {
    const error = new TokenBudgetExceededError(250000, 200000);
    expect(error.code).toBe('TOKEN_BUDGET_EXCEEDED');
    expect(error.required).toBe(250000);
    expect(error.available).toBe(200000);
  });

  it('OutputSchemaNotFoundError has correct properties', () => {
    const error = new OutputSchemaNotFoundError('plan.schema.json');
    expect(error.code).toBe('OUTPUT_SCHEMA_NOT_FOUND');
    expect(error.schemaName).toBe('plan.schema.json');
  });

  it('RepairExhaustedError has correct properties', () => {
    const errors = [
      { path: '/findings', message: 'required', expected: 'array', actual: 'undefined' },
    ];
    const error = new RepairExhaustedError(2, errors);
    expect(error.code).toBe('REPAIR_EXHAUSTED');
    expect(error.attempts).toBe(2);
    expect(error.lastErrors).toEqual(errors);
    expect(error.message).toContain('/findings');
  });
});
