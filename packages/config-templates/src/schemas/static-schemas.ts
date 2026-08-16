import {
  ACTION_TYPES,
  DISPATCH_TYPES,
  GUARD_TYPES,
  STATE_TYPES,
  TRANSITION_TRIGGERS,
  permissionActionSchema,
  permissionDecisionActionSchema,
  roleTrustLevelSchema,
} from '@ai-orchestrator/schemas';
import { z } from 'zod';

// ── Config schema (config.yaml) ──

export const configSchema = z.object({
  log_level: z.enum(['debug', 'info', 'warn', 'error']),
  default_workflow: z.string().min(1),
  workflow_version: z.string().min(1),
  global_transition_limit: z.number().int().positive(),
  report_output_path: z.string().min(1).optional(),
});

// ── Runners schema (runners.yaml) ──

const runnerEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  models: z.array(z.string().min(1)).min(1),
});

export const runnersSchema = z.object({
  runners: z.array(runnerEntrySchema).min(1),
});

// ── Role schema (roles/*.yaml) ──

const agreementParticipationSchema = z.object({
  agreement_type: z.string().min(1),
  action: z.string().min(1),
});

export const roleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  owned_artifacts: z.array(z.string().min(1)),
  readable_artifacts: z.array(z.string().min(1)),
  forbidden_artifacts: z.array(z.string().min(1)),
  reviewed_by: z.array(z.string()),
  reviews: z.array(z.string()),
  agreement_participation: z.array(agreementParticipationSchema),
  required_capabilities: z.array(z.string().min(1)).min(1),
  model: z.string().min(1),
  max_tokens: z.number().int().positive().nullable(),
  dispatch_type: z.enum(DISPATCH_TYPES),
  runner: z.string().min(1),
  agent_config: z
    .object({
      model: z.string().optional(),
      timeoutMs: z.number().optional(),
      instructions: z.string().optional(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      handshakeTimeoutMs: z.number().optional(),
      liveRequestTimeoutMs: z.number().optional(),
      endpoint: z.string().optional(),
      authHeader: z.string().optional(),
      pollIntervalMs: z.number().optional(),
      maxTurns: z.number().optional(),
    })
    .loose()
    .optional(),
});

// ── Governance schema (governance.yaml) ──

const iterationLimitsSchema = z.object({
  max_review_iterations: z.number().int().positive(),
  max_judge_arbitrations: z.number().int().positive(),
  max_clarification_rounds: z.number().int().positive(),
});

const specificationReadinessSchema = z.object({
  min_completeness_score: z.number().min(0).max(1),
});

const implementationReviewSchema = z.object({
  max_high_severity_findings: z.number().int().min(0),
  max_medium_severity_findings: z.number().int().min(0),
});

const qualityGatesSchema = z.object({
  specification_readiness: specificationReadinessSchema,
  implementation_review: implementationReviewSchema,
});

const budgetSchema = z.object({
  max_tokens_per_run: z.number().int().positive().nullable(),
  alert_thresholds: z.array(z.number().min(0).max(1)).optional(),
});

const permissionPolicySchema = z.object({
  default_action: permissionDecisionActionSchema,
  role_trust: z.record(z.string(), roleTrustLevelSchema),
  safe_commands: z.array(z.string()).optional(),
  rules: z.array(
    z
      .object({
        action: permissionActionSchema.optional(),
        decision: z.enum(['grant', 'deny']),
        scope: z.string().optional(),
        pattern: z.string().optional(),
      })
      .loose(),
  ),
});

export const governanceSchema = z.object({
  iteration_limits: iterationLimitsSchema,
  quality_gates: qualityGatesSchema,
  budget: budgetSchema,
  permission_policy: permissionPolicySchema,
});

// ── Workflow schema (workflows/*.yaml, snake_case) ──

const guardSchema = z.object({
  type: z.enum(GUARD_TYPES),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

const actionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

const transitionSchema = z.object({
  target: z.string().min(1),
  trigger: z.enum(TRANSITION_TRIGGERS),
  guards: z.array(guardSchema).optional().default([]),
  governance_required: z.boolean().optional().default(false),
  priority: z.number().optional().default(0),
});

const stateSchema = z.object({
  type: z.enum(STATE_TYPES),
  label: z.string().optional(),
  description: z.string().optional().default(''),
  entry_actions: z.array(actionSchema).optional(),
  exit_actions: z.array(actionSchema).optional(),
  transitions: z.array(transitionSchema).optional().default([]),
});

const workflowBudgetYamlSchema = z.object({
  max_tokens_per_run: z.number().optional(),
});

/** Snake_case YAML authoring schema for static workflow templates (distinct from camelCase {@link workflowSchema} in schemas). */
export const workflowYamlSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  initial_state: z.string().min(1),
  terminal_states: z.array(z.string()).min(1),
  states: z.record(z.string(), stateSchema),
  budget: workflowBudgetYamlSchema.optional(),
});

// ── Validation helpers ──

export class StaticFileValidationError extends Error {
  constructor(
    public readonly file: string,
    public readonly issues: string[],
  ) {
    super(`Invalid ${file}:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'StaticFileValidationError';
  }
}

export function validateStatic<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join('.') : '<root>';
    return `${path}: ${i.message}`;
  });
  throw new StaticFileValidationError(file, issues);
}
