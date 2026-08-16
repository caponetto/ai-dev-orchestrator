import { z } from 'zod/v4';

import { artifactRefSchema, artifactTypeSchema } from '../artifacts/artifact-system';
import { outputFormatSchema } from '../shared/string-enums';

import { roleContractSchema } from './role-system';
import { resolvedArtifactSchema, workerConstraintsSchema } from './runner-system';

export const variableTypeSchema = z.enum(['artifact', 'system', 'computed', 'literal']);
export type VariableType = z.infer<typeof variableTypeSchema>;

export const variableDeclarationSchema = z.object({
  name: z.string(),
  type: variableTypeSchema,
  required: z.boolean(),
  description: z.string().optional(),
  default: z.string().optional(),
  artifactType: artifactTypeSchema.optional(),
  computedFrom: z.string().optional(),
});
export type VariableDeclaration = z.infer<typeof variableDeclarationSchema>;

export const outputContractSchema = z.object({
  role: z.string(),
  artifactType: artifactTypeSchema,
  schema: z.record(z.string(), z.unknown()),
  format: outputFormatSchema,
  required: z.boolean(),
  repairEnabled: z.boolean(),
  maxRepairAttempts: z.number(),
});
export type OutputContract = z.infer<typeof outputContractSchema>;

export const promptTemplateFrontmatterSchema = z.object({
  role: z.string(),
  version: z.string(),
  description: z.string(),
  variables: z.array(variableDeclarationSchema).readonly(),
  outputContract: outputContractSchema,
  partials: z.array(z.string()).readonly().optional(),
  tags: z.array(z.string()).readonly().optional(),
  compatibleModels: z.array(z.string()).readonly().optional(),
});
export type PromptTemplateFrontmatter = z.infer<typeof promptTemplateFrontmatterSchema>;

export const promptTemplateSchema = z.object({
  frontmatter: promptTemplateFrontmatterSchema,
  body: z.string(),
  source: z.string(),
});
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

/** A name→content map of resolved template partials. */
export type PartialMap = Readonly<Record<string, string>>;

export const promptTemplateRefSchema = z.object({
  role: z.string(),
  version: z.string(),
  source: z.literal('built-in'),
});
export type PromptTemplateRef = z.infer<typeof promptTemplateRefSchema>;

export const validationErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  expected: z.string(),
  actual: z.string(),
});
export type ValidationError = z.infer<typeof validationErrorSchema>;

export const outputValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(validationErrorSchema).readonly(),
  parsedContent: z.record(z.string(), z.unknown()).optional(),
});
export type OutputValidationResult = z.infer<typeof outputValidationResultSchema>;

export const repairContextSchema = z.object({
  originalPrompt: z.string(),
  invalidOutput: z.string(),
  validationErrors: z.array(validationErrorSchema).readonly(),
  outputContract: outputContractSchema,
  attemptNumber: z.number(),
  maxAttempts: z.number(),
});
export type RepairContext = z.infer<typeof repairContextSchema>;

export const roleContextBlockSchema = z.object({
  name: z.string(),
  description: z.string(),
  ownedArtifacts: z.array(z.string()).readonly(),
  readableArtifacts: z.array(z.string()).readonly(),
  forbiddenArtifacts: z.array(z.string()).readonly(),
});
export type RoleContextBlock = z.infer<typeof roleContextBlockSchema>;

export const artifactContextBlockSchema = z.object({
  ref: artifactRefSchema,
  content: z.string(),
  tokenEstimate: z.number(),
});
export type ArtifactContextBlock = z.infer<typeof artifactContextBlockSchema>;

export const taskContextBlockSchema = z.object({
  requiredOutputType: z.string(),
  constraints: z.string(),
});
export type TaskContextBlock = z.infer<typeof taskContextBlockSchema>;

export const rulesContextBlockSchema = z.object({
  rules: z.array(z.string()).readonly(),
});
export type RulesContextBlock = z.infer<typeof rulesContextBlockSchema>;

export const outputFormatBlockSchema = z.object({
  format: z.string(),
  schema: z.record(z.string(), z.unknown()).optional(),
});
export type OutputFormatBlock = z.infer<typeof outputFormatBlockSchema>;

export const systemInfoBlockSchema = z.object({
  runId: z.string(),
  currentState: z.string(),
  iterationCount: z.number(),
  timestamp: z.string(),
});
export type SystemInfoBlock = z.infer<typeof systemInfoBlockSchema>;

export const promptContextSchema = z.object({
  role: roleContextBlockSchema,
  artifacts: z.array(artifactContextBlockSchema).readonly(),
  task: taskContextBlockSchema,
  rules: rulesContextBlockSchema,
  outputFormat: outputFormatBlockSchema,
  systemInfo: systemInfoBlockSchema,
  totalTokenEstimate: z.number(),
});
export type PromptContext = z.infer<typeof promptContextSchema>;

export const truncationStrategySchema = z.enum(['tail', 'summary', 'omit']);
export type TruncationStrategy = z.infer<typeof truncationStrategySchema>;

export const artifactPrioritySchema = z.object({
  artifactType: artifactTypeSchema,
  priority: z.number(),
  truncationStrategy: truncationStrategySchema,
});
export type ArtifactPriority = z.infer<typeof artifactPrioritySchema>;

export const tokenBudgetSchema = z.object({
  maxInputTokens: z.number(),
  reservedOutputTokens: z.number(),
  artifactPriority: z.array(artifactPrioritySchema).readonly(),
});
export type TokenBudget = z.infer<typeof tokenBudgetSchema>;

export const truncationRecordSchema = z.object({
  artifactType: artifactTypeSchema,
  originalTokens: z.number(),
  truncatedTokens: z.number(),
  strategy: truncationStrategySchema,
});
export type TruncationRecord = z.infer<typeof truncationRecordSchema>;

export const findingTemplateVarSchema = z.object({
  id: z.string(),
  severity: z.string(),
  category: z.string(),
  title: z.string(),
  status: z.string(),
});
export type FindingTemplateVar = z.infer<typeof findingTemplateVarSchema>;

export const systemContextSchema = z.object({
  runId: z.string(),
  currentState: z.string(),
  iterationCount: z.number(),
  previousFindings: z.array(findingTemplateVarSchema).readonly().optional(),
  previousReviewContent: z.string().optional(),
  humanFeedback: z.string().optional(),
  workflowVariant: z.string().optional(),
});
export type SystemContext = z.infer<typeof systemContextSchema>;

export const promptOverridesSchema = z.object({
  variableOverrides: z.record(z.string(), z.string()).optional(),
});
export type PromptOverrides = z.infer<typeof promptOverridesSchema>;

export const renderRequestSchema = z.object({
  role: z.string(),
  inputArtifacts: z.array(resolvedArtifactSchema).readonly(),
  constraints: workerConstraintsSchema,
  systemContext: systemContextSchema,
  overrides: promptOverridesSchema.optional(),
});
export type RenderRequest = z.infer<typeof renderRequestSchema>;

export const promptMetadataSchema = z.object({
  templateVersion: z.string(),
  resolvedFrom: z.string(),
  renderedAt: z.string(),
  inputArtifactRefs: z.array(artifactRefSchema).readonly(),
  variablesUsed: z.array(z.string()).readonly(),
  partialsIncluded: z.array(z.string()).readonly(),
});
export type PromptMetadata = z.infer<typeof promptMetadataSchema>;

export const renderedPromptSchema = z.object({
  text: z.string(),
  templateRef: promptTemplateRefSchema,
  tokenEstimate: z.number(),
  truncations: z.array(truncationRecordSchema).readonly(),
  outputContract: outputContractSchema,
  metadata: promptMetadataSchema,
});
export type RenderedPrompt = z.infer<typeof renderedPromptSchema>;

export const assemblyRequestSchema = z.object({
  role: roleContractSchema,
  inputArtifacts: z.array(resolvedArtifactSchema).readonly(),
  constraints: workerConstraintsSchema,
  systemContext: systemContextSchema,
  tokenBudget: tokenBudgetSchema,
});
export type AssemblyRequest = z.infer<typeof assemblyRequestSchema>;

export const systemVariablesSchema = z.object({
  role: z.object({
    name: z.string(),
    description: z.string(),
    ownedArtifacts: z.array(z.string()).readonly(),
    readableArtifacts: z.array(z.string()).readonly(),
    forbiddenArtifacts: z.array(z.string()).readonly(),
  }),
  run: z.object({
    id: z.string(),
    currentState: z.string(),
    iterationCount: z.number(),
    transitionCount: z.number(),
    workflowVariant: z.string(),
  }),
  constraints: z.object({
    requiredOutputType: z.string(),
    maxOutputTokens: z.number(),
    timeout: z.number(),
  }),
  timestamp: z.string(),
});
export type SystemVariables = z.infer<typeof systemVariablesSchema>;

export const templateValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(validationErrorSchema).readonly(),
});
export type TemplateValidationResult = z.infer<typeof templateValidationResultSchema>;
