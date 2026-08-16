import { z } from 'zod/v4';

import { artifactRefSchema } from '../artifacts/artifact-system';

export const findingBlockingSchema = z.enum(['must_fix', 'should_fix', 'nit']);
export type FindingBlocking = z.infer<typeof findingBlockingSchema>;

export const findingCategorySchema = z.enum([
  'correctness',
  'completeness',
  'consistency',
  'security',
  'performance',
  'maintainability',
  'style',
  'documentation',
  'test_coverage',
  'architecture',
  'other',
]);
export type FindingCategory = z.infer<typeof findingCategorySchema>;

export const findingStatusSchema = z.enum([
  'open',
  'addressed',
  'accepted',
  'rejected',
  'escalated',
]);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

export const findingLocationSchema = z.object({
  artifactRef: artifactRefSchema,
  section: z.string().optional(),
  line: z.number().optional(),
  snippet: z.string().optional(),
});
export type FindingLocation = z.infer<typeof findingLocationSchema>;

export const findingResolutionSchema = z.object({
  status: findingStatusSchema,
  resolvedInArtifact: artifactRefSchema.optional(),
  resolvedBy: z.string(),
  rationale: z.string(),
  timestamp: z.string(),
});
export type FindingResolution = z.infer<typeof findingResolutionSchema>;

export const findingSchema = z.object({
  id: z.string(),
  severity: z.string(),
  blocking: findingBlockingSchema,
  category: findingCategorySchema,
  title: z.string(),
  description: z.string(),
  location: findingLocationSchema.optional(),
  suggestedFix: z.string().optional(),
  status: findingStatusSchema,
  resolution: findingResolutionSchema.optional(),
  supersedes: z.string().optional(),
});
export type Finding = z.infer<typeof findingSchema>;

export const aggregatedFindingsSchema = z.object({
  total: z.number(),
  bySeverity: z.record(z.string(), z.number()),
  byStatus: z.record(z.string(), z.number()),
  byCategory: z.record(z.string(), z.number()),
  blocking: z.array(findingSchema).readonly(),
  nonBlocking: z.array(findingSchema).readonly(),
});
export type AggregatedFindings = z.infer<typeof aggregatedFindingsSchema>;

export const correlatedFindingSchema = z.object({
  finding: findingSchema,
  producedIn: artifactRefSchema,
  addressedIn: artifactRefSchema.optional(),
  verifiedIn: artifactRefSchema.optional(),
});
export type CorrelatedFinding = z.infer<typeof correlatedFindingSchema>;

export const correlatedFindingsSchema = z.object({
  findings: z.array(correlatedFindingSchema).readonly(),
  resolutionRate: z.number(),
});
export type CorrelatedFindings = z.infer<typeof correlatedFindingsSchema>;
