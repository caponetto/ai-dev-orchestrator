import { describe, expect, it } from 'vitest';

import {
  validationRuleSchema,
  workflowValidationErrorSchema,
  workflowValidationResultSchema,
  workflowValidationWarningSchema,
} from '../workflow-dsl';

describe('validationRuleSchema', () => {
  it.each([
    'reachability',
    'completeness',
    'terminal_convergence',
    'determinism',
    'no_orphans',
    'valid_targets',
    'valid_triggers',
    'valid_guards',
    'valid_actions',
    'initial_state_exists',
    'terminal_states_exist',
    'terminal_no_transitions',
    'parallel_well_formed',
    'no_infinite_loops',
  ])('accepts "%s"', (val) => {
    expect(validationRuleSchema.safeParse(val).success).toBe(true);
  });

  it('rejects unknown rule', () => {
    expect(validationRuleSchema.safeParse('custom_rule').success).toBe(false);
  });
});

describe('workflowValidationErrorSchema', () => {
  it('validates an error without location', () => {
    const data = { rule: 'reachability', message: 'State X is unreachable' };
    expect(workflowValidationErrorSchema.safeParse(data).success).toBe(true);
  });

  it('validates an error with location', () => {
    const data = {
      rule: 'valid_targets',
      message: 'Target state MISSING not found',
      location: { state: 'IMPL', transition: 0 },
    };
    expect(workflowValidationErrorSchema.safeParse(data).success).toBe(true);
  });
});

describe('workflowValidationWarningSchema', () => {
  it('validates a warning', () => {
    const data = {
      rule: 'no_infinite_loops',
      message: 'Potential infinite loop detected',
      suggestion: 'Add iteration limit guard',
    };
    expect(workflowValidationWarningSchema.safeParse(data).success).toBe(true);
  });
});

describe('workflowValidationResultSchema', () => {
  it('validates a passing result', () => {
    expect(
      workflowValidationResultSchema.safeParse({ valid: true, errors: [], warnings: [] }).success,
    ).toBe(true);
  });

  it('validates a failing result', () => {
    const data = {
      valid: false,
      errors: [{ rule: 'reachability', message: 'Unreachable state' }],
      warnings: [{ rule: 'complexity', message: 'Many states', suggestion: 'Simplify' }],
    };
    expect(workflowValidationResultSchema.safeParse(data).success).toBe(true);
  });
});
