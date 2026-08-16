import { z } from 'zod/v4';

import { artifactTypeSchema } from '../artifacts/artifact-system';

export const ROLE_IDS = [
  'requirements_analyst',
  'context_analyst',
  'codebase_analyst',
  'planner',
  'plan_reviewer',
  'implementer',
  'test_engineer',
  'static_reviewer',
  'security_reviewer',
  'performance_reviewer',
  'adversarial_reviewer',
  'design_reviewer',
  'docs_reviewer',
  'ux_reviewer',
  'report_synthesizer',
  'remediation_triage',
  'judge',
  'verifier',
  'summary_writer',
  'review_findings_writer',
  'acceptance_validator',
  'breakdown_analyst',
  'decomposer',
  'decomposition_reviewer',
  'task_spec_writer',
] as const;

export const roleIdSchema = z.enum(ROLE_IDS);
export type RoleId = z.infer<typeof roleIdSchema>;

export const modelCapabilitySchema = z.enum([
  'code_generation',
  'code_review',
  'reasoning',
  'long_context',
  'structured_output',
  'vision',
  'external_data_fetch',
]);
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

export const agentConfigSchema = z.object({
  model: z.string().optional(),
  timeoutMs: z.number().optional(),
  instructions: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).readonly().optional(),
  handshakeTimeoutMs: z.number().optional(),
  liveRequestTimeoutMs: z.number().optional(),
  endpoint: z.string().optional(),
  authHeader: z.string().optional(),
  pollIntervalMs: z.number().optional(),
  maxTurns: z.number().positive().optional(),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const agreementParticipationSchema = z.object({
  agreementType: z.string(),
  action: z.enum(['produced', 'reviewed', 'approved']),
});
export type AgreementParticipation = z.infer<typeof agreementParticipationSchema>;

export const DISPATCH_TYPES = ['agent'] as const;
export const dispatchTypeSchema = z.enum(DISPATCH_TYPES);
export type DispatchType = z.infer<typeof dispatchTypeSchema>;

export const roleContractSchema = z.object({
  id: roleIdSchema,
  name: z.string(),
  description: z.string(),
  ownedArtifacts: z.array(artifactTypeSchema).readonly(),
  readableArtifacts: z.array(artifactTypeSchema).readonly(),
  forbiddenArtifacts: z.array(artifactTypeSchema).readonly(),
  reviewedBy: z.array(roleIdSchema).readonly(),
  reviews: z.array(roleIdSchema).readonly(),
  agreementParticipation: z.array(agreementParticipationSchema).readonly(),
  requiredCapabilities: z.array(modelCapabilitySchema).readonly(),
  dispatchType: dispatchTypeSchema,
  runner: z.string().optional(),
  agentConfig: agentConfigSchema.optional(),
});
export type RoleContract = z.infer<typeof roleContractSchema>;

export const modelAssignmentSchema = z.object({
  roleId: roleIdSchema,
  model: z.string(),
  maxTokens: z.number().optional(),
  systemPrompt: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
export type ModelAssignment = z.infer<typeof modelAssignmentSchema>;

export const roleValidationErrorSchema = z.object({
  roleId: roleIdSchema,
  field: z.string(),
  message: z.string(),
});
export type RoleValidationError = z.infer<typeof roleValidationErrorSchema>;

export const roleValidationWarningSchema = z.object({
  roleId: roleIdSchema,
  message: z.string(),
});
export type RoleValidationWarning = z.infer<typeof roleValidationWarningSchema>;

export const roleValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(roleValidationErrorSchema).readonly(),
  warnings: z.array(roleValidationWarningSchema).readonly(),
});
export type RoleValidationResult = z.infer<typeof roleValidationResultSchema>;
