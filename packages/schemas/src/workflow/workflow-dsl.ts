import { z } from 'zod/v4';

export const VALIDATION_RULES = [
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
] as const;

export const validationRuleSchema = z.enum(VALIDATION_RULES);
export type ValidationRule = z.infer<typeof validationRuleSchema>;

export const workflowValidationErrorSchema = z.object({
  rule: validationRuleSchema,
  message: z.string(),
  location: z
    .object({
      state: z.string().optional(),
      transition: z.number().optional(),
    })
    .optional(),
});
export type WorkflowValidationError = z.infer<typeof workflowValidationErrorSchema>;

export const workflowValidationWarningSchema = z.object({
  rule: z.string(),
  message: z.string(),
  suggestion: z.string(),
});
export type WorkflowValidationWarning = z.infer<typeof workflowValidationWarningSchema>;

export const workflowValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(workflowValidationErrorSchema).readonly(),
  warnings: z.array(workflowValidationWarningSchema).readonly(),
});
export type WorkflowValidationResult = z.infer<typeof workflowValidationResultSchema>;
