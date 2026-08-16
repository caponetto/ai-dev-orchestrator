import { z } from 'zod/v4';

export const ARTIFACT_TYPES = [
  'intake_requirements',
  'canonical_specification',
  'clarification_questions',
  'clarification_answers',
  'plan',
  'plan_review',
  'test_plan',
  'implementation',
  'static_review',
  'security_review',
  'performance_review',
  'adversarial_review',
  'design_review',
  'docs_review',
  'ux_review',
  'review_report',
  'remediation_plan',
  'verification',
  'judge_decision',
  'planning_agreement',
  'implementation_agreement',
  'verification_agreement',
  'release_summary',
  'release_agreement',
  'escalation_context',
  'run_manifest',
  'codebase_context',
  'test_suite',
  'acceptance_validation',
  'review_findings',
  'task_breakdown',
  'decomposition_review',
  'task_specifications',
  'pr_diff_context',
] as const;

export const artifactTypeSchema = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const artifactRefSchema = z.object({
  type: artifactTypeSchema,
  name: z.string(),
  version: z.number(),
  checksum: z.string(),
});
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const artifactInputSchema = z.object({
  type: artifactTypeSchema,
  name: z.string(),
  runId: z.string().optional(),
  content: z.string(),
  producedBy: z.string(),
  predecessorRef: artifactRefSchema.optional(),
  metadata: z
    .object({
      validationFailed: z.boolean().optional(),
    })
    .catchall(z.unknown())
    .optional(),
  preValidated: z.boolean().optional(),
});
export type ArtifactInput = z.infer<typeof artifactInputSchema>;

export const artifactSchema = z.object({
  ref: artifactRefSchema,
  type: artifactTypeSchema,
  name: z.string(),
  version: z.number(),
  content: z.string(),
  checksum: z.string(),
  producedBy: z.string(),
  predecessorRef: artifactRefSchema.optional(),
  createdAt: z.string(),
  sizeBytes: z.number(),
  metadata: z
    .object({
      validationFailed: z.boolean().optional(),
    })
    .catchall(z.unknown())
    .optional(),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const artifactQuerySchema = z.object({
  type: artifactTypeSchema.optional(),
  name: z.string().optional(),
  producedBy: z.string().optional(),
  minVersion: z.number().optional(),
  maxVersion: z.number().optional(),
  createdAfter: z.string().optional(),
  createdBefore: z.string().optional(),
});
export type ArtifactQuery = z.infer<typeof artifactQuerySchema>;

export const artifactSummarySchema = z.object({
  ref: artifactRefSchema,
  type: artifactTypeSchema,
  name: z.string(),
  version: z.number(),
  producedBy: z.string(),
  createdAt: z.string(),
  sizeBytes: z.number(),
});
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;

export const artifactInventorySchema = z.object({
  runId: z.string(),
  artifacts: z.array(artifactSummarySchema).readonly(),
  totalCount: z.number(),
  totalSizeBytes: z.number(),
});
export type ArtifactInventory = z.infer<typeof artifactInventorySchema>;

export const integrityResultSchema = z.object({
  valid: z.boolean(),
  expectedChecksum: z.string(),
  actualChecksum: z.string(),
  ref: artifactRefSchema,
});
export type IntegrityResult = z.infer<typeof integrityResultSchema>;

export const artifactMetadataSchema = z.object({
  type: artifactTypeSchema,
  name: z.string(),
  runId: z.string().optional(),
  version: z.number(),
  checksum: z.string(),
  producedBy: z.string(),
  predecessorRef: artifactRefSchema.nullable(),
  createdAt: z.string(),
  sizeBytes: z.number(),
  metadata: z
    .object({
      validationFailed: z.boolean().optional(),
    })
    .catchall(z.unknown())
    .optional(),
});
export type ArtifactMetadata = z.infer<typeof artifactMetadataSchema>;
