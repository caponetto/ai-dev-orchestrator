import { z } from 'zod/v4';

import { artifactRefSchema, artifactTypeSchema } from './artifact-system';

export const dependencyGraphValidationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).readonly(),
  warnings: z.array(z.string()).readonly(),
});
export type DependencyGraphValidation = z.infer<typeof dependencyGraphValidationSchema>;

export const provenanceRecordSchema = z.object({
  output: artifactRefSchema,
  inputs: z.array(artifactRefSchema).readonly(),
  recordedAt: z.string(),
  workerId: z.string(),
});
export type ProvenanceRecord = z.infer<typeof provenanceRecordSchema>;

export const provenanceNodeSchema: z.ZodType<ProvenanceNode> = z.lazy(() =>
  z.object({
    artifact: artifactRefSchema,
    inputs: z.array(provenanceNodeSchema).readonly(),
  }),
);
export interface ProvenanceNode {
  artifact: z.infer<typeof artifactRefSchema>;
  inputs: readonly ProvenanceNode[];
}

export const staleInputSchema = z.object({
  currentInput: artifactRefSchema,
  latestAvailable: artifactRefSchema,
});
export type StaleInput = z.infer<typeof staleInputSchema>;

export const staleArtifactSchema = z.object({
  artifact: artifactRefSchema,
  staleInputs: z.array(staleInputSchema).readonly(),
  depth: z.number(),
});
export type StaleArtifact = z.infer<typeof staleArtifactSchema>;

export const staleSetSchema = z.object({
  trigger: artifactRefSchema,
  staleArtifacts: z.array(staleArtifactSchema).readonly(),
  rebuildOrder: z.array(artifactTypeSchema).readonly(),
});
export type StaleSet = z.infer<typeof staleSetSchema>;

export const stalenessResultSchema = z.object({
  stale: z.boolean(),
  staleInputs: z.array(staleInputSchema).readonly(),
  clearedManually: z.boolean(),
  clearReason: z.string().optional(),
});
export type StalenessResult = z.infer<typeof stalenessResultSchema>;

export const rebuildPlanSchema = z.object({
  statesToReenter: z.array(z.string()).readonly(),
  artifactsToRebuild: z.array(artifactTypeSchema).readonly(),
  artifactsPreserved: z.array(artifactTypeSchema).readonly(),
  requiresGovernanceApproval: z.boolean(),
});
export type RebuildPlan = z.infer<typeof rebuildPlanSchema>;

export const rebuildEstimateSchema = z.object({
  stateCount: z.number(),
  estimatedWorkerInvocations: z.number(),
  estimatedTokens: z.object({
    input: z.number(),
    output: z.number(),
  }),
  estimatedDurationMs: z.number(),
});
export type RebuildEstimate = z.infer<typeof rebuildEstimateSchema>;

export const dependencyEdgeSchema = z.object({
  type: artifactTypeSchema,
  dependsOn: z.array(artifactTypeSchema).readonly(),
  producedInState: z.string(),
});
export type DependencyEdge = z.infer<typeof dependencyEdgeSchema>;
