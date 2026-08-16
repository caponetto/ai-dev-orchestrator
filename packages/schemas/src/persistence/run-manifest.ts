import { z } from 'zod/v4';

import { artifactRefSchema } from '../artifacts/artifact-system';

export const manifestWorkflowInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
});
export type ManifestWorkflowInfo = z.infer<typeof manifestWorkflowInfoSchema>;

export const stateVisitSchema = z.object({
  stateId: z.string(),
  enteredAt: z.string(),
  exitedAt: z.string(),
  durationMs: z.number(),
});
export type StateVisit = z.infer<typeof stateVisitSchema>;

export const stateTimingSchema = z.object({
  stateId: z.string(),
  enteredAt: z.string(),
  exitedAt: z.string(),
  durationMs: z.number(),
  visits: z.number(),
});
export type StateTiming = z.infer<typeof stateTimingSchema>;

export const manifestTimingSchema = z.object({
  startedAt: z.string(),
  completedAt: z.string(),
  totalDurationMs: z.number(),
  stateTimings: z.array(stateTimingSchema).readonly(),
  stateTrace: z.array(stateVisitSchema).readonly().optional(),
});
export type ManifestTiming = z.infer<typeof manifestTimingSchema>;

export const roleUsageSchema = z.object({
  role: z.string(),
  dispatches: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalDurationMs: z.number(),
  artifactsProduced: z.number(),
});
export type RoleUsage = z.infer<typeof roleUsageSchema>;

export const manifestArtifactSummarySchema = z.object({
  ref: artifactRefSchema,
  producedBy: z.string(),
  createdAt: z.string(),
  sizeBytes: z.number(),
});
export type ManifestArtifactSummary = z.infer<typeof manifestArtifactSummarySchema>;

export const manifestIterationSummarySchema = z.object({
  contractId: z.string(),
  totalIterations: z.number(),
  judgeArbitrations: z.number(),
  finalStatus: z.string(),
  findingsTotal: z.number(),
  findingsResolved: z.number(),
});
export type ManifestIterationSummary = z.infer<typeof manifestIterationSummarySchema>;

export const manifestTokenUsageSchema = z.object({
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalTokens: z.number(),
  byRole: z.record(
    z.string(),
    z.object({
      input: z.number(),
      output: z.number(),
    }),
  ),
});
export type ManifestTokenUsage = z.infer<typeof manifestTokenUsageSchema>;

export const manifestBudgetSummarySchema = z.object({
  configuredMaxTokens: z.number().nullable(),
  budgetExceeded: z.boolean(),
});
export type ManifestBudgetSummary = z.infer<typeof manifestBudgetSummarySchema>;

export const runManifestSchema = z.object({
  runId: z.string(),
  version: z.string(),
  repository: z.string(),
  repoRoot: z.string().optional(),
  workflow: manifestWorkflowInfoSchema,
  timing: manifestTimingSchema,
  status: z.string(),
  finalState: z.string(),
  abortReason: z.string().optional(),
  activeRoles: z.array(roleUsageSchema).readonly(),
  artifactInventory: z.array(manifestArtifactSummarySchema).readonly(),
  totalArtifacts: z.number(),
  totalArtifactSizeBytes: z.number(),
  iterations: z.array(manifestIterationSummarySchema).readonly(),
  governanceDecisions: z.number(),
  escalations: z.number(),
  humanInterventions: z.number(),
  agreements: z.array(artifactRefSchema).readonly(),
  tokenUsage: manifestTokenUsageSchema,
  budgetSummary: manifestBudgetSummarySchema.optional(),
  reportPath: z.string().optional(),
});
export type RunManifest = z.infer<typeof runManifestSchema>;

export const manifestContextConfigSchema = z.object({
  startedAt: z.string(),
  completedAt: z.string(),
  governanceDecisions: z.number(),
  escalations: z.number(),
  iterations: z.array(manifestIterationSummarySchema).readonly(),
  stateTimestamps: z
    .array(
      z.object({
        stateId: z.string(),
        enteredAt: z.string(),
        exitedAt: z.string(),
      }),
    )
    .readonly(),
  repoRoot: z.string().optional(),
});
export type ManifestContextConfig = z.infer<typeof manifestContextConfigSchema>;

export const manifestContextSchema = z.object({
  runId: z.string(),
  config: manifestContextConfigSchema,
  stateHistory: z.array(z.string()).readonly(),
  artifactInventory: z.array(artifactRefSchema).readonly(),
  journalPath: z.string(),
  workerMetrics: z.record(
    z.string(),
    z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      dispatches: z.number(),
      durationMs: z.number(),
      artifactsProduced: z.number(),
    }),
  ),
  workflowName: z.string().optional(),
  workflowVersion: z.string().optional(),
  artifactSummaries: z.array(manifestArtifactSummarySchema).readonly().optional(),
  budgetSummary: manifestBudgetSummarySchema.optional(),
  reportPath: z.string().optional(),
});
export type ManifestContext = z.infer<typeof manifestContextSchema>;
