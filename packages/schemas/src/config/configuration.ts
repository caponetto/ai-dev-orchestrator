import { z } from 'zod/v4';

import { agentConfigSchema, dispatchTypeSchema } from '../runner/role-system';
import { permissionDecisionActionSchema } from '../shared/string-enums';

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const runtimeConfigSchema = z.object({
  logLevel: logLevelSchema,
  reportOutputPath: z.string().optional(),
});
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export const specificationReadinessGateSchema = z.object({
  minCompletenessScore: z.number(),
});
export type SpecificationReadinessGate = z.infer<typeof specificationReadinessGateSchema>;

export const implementationReviewGateSchema = z.object({
  maxHighSeverityFindings: z.number(),
  maxMediumSeverityFindings: z.number(),
});
export type ImplementationReviewGate = z.infer<typeof implementationReviewGateSchema>;

export const qualityGateConfigSchema = z.object({
  specificationReadiness: specificationReadinessGateSchema,
  implementationReview: implementationReviewGateSchema,
});
export type QualityGateConfig = z.infer<typeof qualityGateConfigSchema>;

export const iterationLimitDefaultsSchema = z.object({
  maxReviewIterations: z.number(),
  maxJudgeArbitrations: z.number(),
  maxClarificationRounds: z.number(),
  maxAcceptanceIterations: z.number(),
});
export type IterationLimitDefaults = z.infer<typeof iterationLimitDefaultsSchema>;

export const iterationLimitConfigSchema = z.object({
  defaults: iterationLimitDefaultsSchema,
});
export type IterationLimitConfig = z.infer<typeof iterationLimitConfigSchema>;

export const budgetConfigSchema = z.object({
  maxTokensPerRun: z.number().optional(),
  alertThresholds: z.array(z.number()).readonly().optional(),
});
export type BudgetConfig = z.infer<typeof budgetConfigSchema>;

export const confidenceGateConfigSchema = z.object({
  modelEscalationThreshold: z.number().min(0).max(1),
  humanEscalationThreshold: z.number().min(0).max(1),
  heuristicWeight: z.number().min(0).max(1),
  heuristicSignals: z.object({
    penalizeHedgingLanguage: z.boolean(),
    penalizeHighRetryCount: z.boolean(),
    penalizeUnresolvedFindings: z.boolean(),
  }),
});
export type ConfidenceGateConfig = z.infer<typeof confidenceGateConfigSchema>;

export const governanceConfigSchema = z.object({
  iterationLimits: iterationLimitConfigSchema,
  qualityGates: qualityGateConfigSchema,
  budget: budgetConfigSchema.optional(),
  confidenceGate: confidenceGateConfigSchema.optional(),
});
export type GovernanceConfig = z.infer<typeof governanceConfigSchema>;

export const roleAssignmentSchema = z.object({
  model: z.string().min(1),
  maxTokens: z.number().optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
  dispatchType: dispatchTypeSchema.optional(),
  runner: z.string().min(1).optional(),
  agentConfig: agentConfigSchema.optional(),
});
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;

export const customRoleDefinitionSchema = z.object({
  description: z.string(),
  ownedArtifacts: z.array(z.string()).readonly(),
  readableArtifacts: z.array(z.string()).readonly(),
  forbiddenArtifacts: z.array(z.string()).readonly(),
  requiredCapabilities: z.array(z.string()).readonly(),
  reviewedBy: z.string().optional(),
  reviews: z.string().optional(),
});
export type CustomRoleDefinition = z.infer<typeof customRoleDefinitionSchema>;

export const permissionRuleSchema = z.object({
  action: z.string(),
  decision: z.enum(['grant', 'deny']),
  scope: z.string().optional(),
  pattern: z.string().optional(),
});
export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export const permissionPolicySchema = z.object({
  defaultAction: permissionDecisionActionSchema.optional(),
  rules: z.array(permissionRuleSchema).readonly().optional(),
  roleTrust: z.record(z.string(), z.string()).optional(),
  safeCommands: z.array(z.string()).readonly().optional(),
});
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

export const rolesConfigSchema = z.object({
  assignments: z.record(z.string(), roleAssignmentSchema),
  customRoles: z.record(z.string(), customRoleDefinitionSchema).optional(),
  permissionPolicy: permissionPolicySchema.optional(),
});
export type RolesConfig = z.infer<typeof rolesConfigSchema>;

export const workflowConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  globalTransitionLimit: z.number().min(1).optional(),
});
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

export const mergedConfigurationSchema = z.object({
  workflow: workflowConfigSchema,
  roles: rolesConfigSchema,
  governance: governanceConfigSchema,
  runtime: runtimeConfigSchema,
});
export type MergedConfiguration = z.infer<typeof mergedConfigurationSchema>;
