import { z } from 'zod/v4';

import { artifactRefSchema } from '../artifacts/artifact-system';

import { escalationTriggerSchema, humanApprovalSchema, policyTokenUsageSchema } from './governance';

export type { EscalationTrigger, HumanApproval, PolicyTokenUsage } from './governance';

export const policyLayerSchema = z.enum([
  'builtin',
  'organization',
  'project',
  'workflow_variant',
  'stage',
  'role',
]);
export type PolicyLayer = z.infer<typeof policyLayerSchema>;

export const policySourceSchema = z.object({
  layer: policyLayerSchema,
  filePath: z.string().optional(),
  fieldPath: z.string().optional(),
});
export type PolicySource = z.infer<typeof policySourceSchema>;

export const policyTypeSchema = z.enum([
  'iteration_limit',
  'quality_gate',
  'specification_readiness',
  'stage_skip',
  'retry_limit',
  'token_budget',
  'model_constraint',
  'ownership',
  'confidence_gate',
  'custom',
]);
export type PolicyType = z.infer<typeof policyTypeSchema>;

export const policyCompositionSchema = z.enum(['conjunctive', 'disjunctive']);
export type PolicyComposition = z.infer<typeof policyCompositionSchema>;

export const policyScopeSchema = z.object({
  organization: z.string().optional(),
  project: z.string().optional(),
  workflowVariant: z.string().optional(),
  stages: z.array(z.string()).readonly().optional(),
  roles: z.array(z.string()).readonly().optional(),
});
export type PolicyScope = z.infer<typeof policyScopeSchema>;

export const policyIterationLimitConfigSchema = z.object({
  maxReviewIterations: z.number(),
  maxJudgeArbitrations: z.number(),
  maxClarificationRounds: z.number(),
  maxAcceptanceIterations: z.number(),
});
export type PolicyIterationLimitConfig = z.infer<typeof policyIterationLimitConfigSchema>;

export const policyQualityGateConfigSchema = z.object({
  maxHighSeverityFindings: z.number(),
  maxMediumSeverityFindings: z.number(),
  requireDesignReview: z.boolean().optional(),
  requireAdversarialReview: z.boolean().optional(),
});
export type PolicyQualityGateConfig = z.infer<typeof policyQualityGateConfigSchema>;

export const policySpecReadinessConfigSchema = z.object({
  minCompletenessScore: z.number(),
});
export type PolicySpecReadinessConfig = z.infer<typeof policySpecReadinessConfigSchema>;

export const policyStageSkipConditionSchema = z.object({
  field: z.string(),
  key: z.string().optional(),
  equals: z.unknown().optional(),
  reason: z.string().optional(),
});

export const policyStageSkipConfigSchema = z.object({
  skipWhen: z.array(policyStageSkipConditionSchema).readonly(),
});
export type PolicyStageSkipConfig = z.infer<typeof policyStageSkipConfigSchema>;

export const policyRetryLimitConfigSchema = z.object({
  maxRetries: z.number(),
});
export type PolicyRetryLimitConfig = z.infer<typeof policyRetryLimitConfigSchema>;

export const policyTokenBudgetConfigSchema = z.object({
  maxTokens: z.number(),
});
export type PolicyTokenBudgetConfig = z.infer<typeof policyTokenBudgetConfigSchema>;

export const policyModelConstraintConfigSchema = z.object({
  allowedModels: z.array(z.string()).readonly(),
});
export type PolicyModelConstraintConfig = z.infer<typeof policyModelConstraintConfigSchema>;

export const policyOwnershipConfigSchema = z.object({
  ownershipMap: z.record(z.string(), z.array(z.string()).readonly()),
  strict: z.boolean(),
});
export type PolicyOwnershipConfig = z.infer<typeof policyOwnershipConfigSchema>;

export const policyConfidenceGateConfigSchema = z.object({
  modelEscalationThreshold: z.number().min(0).max(1),
  humanEscalationThreshold: z.number().min(0).max(1),
  heuristicWeight: z.number().min(0).max(1),
  heuristicSignals: z.object({
    penalizeHedgingLanguage: z.boolean(),
    penalizeHighRetryCount: z.boolean(),
    penalizeUnresolvedFindings: z.boolean(),
  }),
});
export type PolicyConfidenceGateConfig = z.infer<typeof policyConfidenceGateConfigSchema>;

export const policyCustomConfigSchema = z.record(z.string(), z.unknown());
export type PolicyCustomConfig = z.infer<typeof policyCustomConfigSchema>;

const policyDefinitionCommon = {
  id: z.string(),
  scope: policyScopeSchema,
  composition: policyCompositionSchema.optional(),
  enabled: z.boolean(),
  locked: z.boolean().optional(),
};

export const policyDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    ...policyDefinitionCommon,
    type: z.literal('iteration_limit'),
    config: policyIterationLimitConfigSchema,
  }),
  z.object({
    ...policyDefinitionCommon,
    type: z.literal('quality_gate'),
    config: policyQualityGateConfigSchema,
  }),
  z.object({
    ...policyDefinitionCommon,
    type: z.literal('specification_readiness'),
    config: policySpecReadinessConfigSchema,
  }),
  z.object({
    ...policyDefinitionCommon,
    type: z.literal('stage_skip'),
    config: policyStageSkipConfigSchema,
  }),
  z.object({
    ...policyDefinitionCommon,
    type: z.literal('retry_limit'),
    config: policyRetryLimitConfigSchema,
  }),
  z.object({
    ...policyDefinitionCommon,
    type: z.literal('token_budget'),
    config: policyTokenBudgetConfigSchema,
  }),
  z.object({
    ...policyDefinitionCommon,
    type: z.literal('model_constraint'),
    config: policyModelConstraintConfigSchema,
  }),
  z.object({
    ...policyDefinitionCommon,
    type: z.literal('ownership'),
    config: policyOwnershipConfigSchema,
  }),
  z.object({
    ...policyDefinitionCommon,
    type: z.literal('confidence_gate'),
    config: policyConfidenceGateConfigSchema,
  }),
  z.object({
    ...policyDefinitionCommon,
    type: z.literal('custom'),
    config: policyCustomConfigSchema,
  }),
]);
export type PolicyDefinition = z.infer<typeof policyDefinitionSchema>;

export const policyOutcomeSchema = z.enum(['allow', 'deny', 'escalate']);
export type PolicyOutcome = z.infer<typeof policyOutcomeSchema>;

export const policyResultOutcomeSchema = z.enum(['pass', 'fail', 'skip', 'warn']);
export type PolicyResultOutcome = z.infer<typeof policyResultOutcomeSchema>;

export const policyResultSchema = z.object({
  policyId: z.string(),
  policyType: policyTypeSchema,
  outcome: policyResultOutcomeSchema,
  reason: z.string(),
  source: policySourceSchema,
  detail: z.string().optional(),
  escalationTrigger: escalationTriggerSchema.optional(),
});
export type PolicyResult = z.infer<typeof policyResultSchema>;

export const policyFindingRefSchema = z.object({
  id: z.string(),
  severity: z.string(),
  blocking: z.string(),
  status: z.string(),
});
export type PolicyFindingRef = z.infer<typeof policyFindingRefSchema>;

export const policyContextSchema = z.object({
  runId: z.string(),
  currentState: z.string(),
  requestedTransition: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .optional(),
  artifacts: z.array(artifactRefSchema).readonly(),
  findings: z.array(policyFindingRefSchema).readonly().optional(),
  iterationCount: z.number().optional(),
  role: z.string().optional(),
  workflowVariant: z.string().optional(),
  humanApproval: humanApprovalSchema.optional(),
  tokenUsage: policyTokenUsageSchema.optional(),
  metadata: z
    .object({
      completenessScore: z.number().optional(),
      ambiguityCount: z.number().optional(),
      model: z.string().optional(),
      retryCount: z.number().optional(),
      skipStage: z.boolean().optional(),
    })
    .catchall(z.unknown())
    .optional(),
});
export type PolicyContext = z.infer<typeof policyContextSchema>;

export const policyDecisionSchema = z.object({
  outcome: policyOutcomeSchema,
  results: z.array(policyResultSchema).readonly(),
  reason: z.string(),
  remediations: z.array(z.string()).readonly().optional(),
  escalationTrigger: escalationTriggerSchema.optional(),
});
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export const mergeLogEntrySchema = z.object({
  policyId: z.string(),
  field: z.string(),
  fromLayer: policyLayerSchema,
  toLayer: policyLayerSchema,
  action: z.enum(['override', 'merge', 'append', 'blocked_by_lock']),
  fromValue: z.unknown(),
  toValue: z.unknown(),
});
export type MergeLogEntry = z.infer<typeof mergeLogEntrySchema>;

export const policyTypeInfoSchema = z.object({
  type: policyTypeSchema,
  description: z.string(),
  configSchema: z.record(z.string(), z.unknown()),
  builtIn: z.boolean(),
});
export type PolicyTypeInfo = z.infer<typeof policyTypeInfoSchema>;

export const policyValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).readonly(),
  warnings: z.array(z.string()).readonly(),
});
export type PolicyValidationResult = z.infer<typeof policyValidationResultSchema>;

export interface ResolvedPolicySet {
  readonly policies: readonly PolicyDefinition[];
  readonly sources: ReadonlyMap<string, PolicySource>;
  readonly mergeLog: readonly MergeLogEntry[];
}
