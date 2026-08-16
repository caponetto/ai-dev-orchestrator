import { z } from 'zod/v4';

import { workerErrorTypeSchema } from '../runner/runner-system';

export const distributionSummarySchema = z.object({
  p50: z.number(),
  p75: z.number(),
  p90: z.number(),
  max: z.number(),
  ema: z.number(),
});
export type DistributionSummary = z.infer<typeof distributionSummarySchema>;

export const errorFrequencySchema = z.object({
  type: workerErrorTypeSchema,
  frequency: z.number().min(0).max(1),
});
export type ErrorFrequency = z.infer<typeof errorFrequencySchema>;

export const executionProfileSchema = z.object({
  roleId: z.string(),
  model: z.string(),
  sampleSize: z.number().int().nonnegative(),
  lastUpdated: z.string(),
  tokenUsage: z.object({
    inputTokens: distributionSummarySchema,
    outputTokens: distributionSummarySchema,
  }),
  reliability: z.object({
    successRate: z.number().min(0).max(1),
    failureRate: z.number().min(0).max(1),
    avgRetries: z.number().nonnegative(),
    retryableFailureRate: z.number().min(0).max(1),
    commonErrorTypes: z.array(errorFrequencySchema),
  }),
  timing: z.object({
    durationMs: distributionSummarySchema,
  }),
  confidence: z.object({
    avgConfidence: z.number().min(0).max(1),
    escalationRate: z.number().min(0).max(1),
  }),
});
export type ExecutionProfile = z.infer<typeof executionProfileSchema>;

export const workerOutcomeRecordSchema = z.object({
  roleId: z.string(),
  model: z.string(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  status: z.enum(['success', 'failure']),
  errorType: workerErrorTypeSchema.nullable(),
  confidenceScore: z.number().min(0).max(1).nullable(),
});
export type WorkerOutcomeRecord = z.infer<typeof workerOutcomeRecordSchema>;

export const executionProfileStoreSchema = z.object({
  profiles: z.array(executionProfileSchema),
  lastUpdated: z.string(),
});
export type ExecutionProfileStore = z.infer<typeof executionProfileStoreSchema>;

export const staticConfigBaselineSchema = z.object({
  maxOutputTokens: z.number(),
  maxRetries: z.number(),
  timeoutMs: z.number(),
  modelMaxTokens: z.number(),
});
export type StaticConfigBaseline = z.infer<typeof staticConfigBaselineSchema>;

export const adaptiveConfigSchema = z.object({
  recommendedMaxOutputTokens: z.number().nullable(),
  recommendedMaxRetries: z.number().nullable(),
  recommendedTimeoutMs: z.number().nullable(),
  modelEscalation: z.object({
    recommended: z.boolean(),
    reason: z.string().nullable(),
  }),
  basis: z.object({
    sampleSize: z.number(),
    profileAge: z.string(),
  }),
});
export type AdaptiveConfig = z.infer<typeof adaptiveConfigSchema>;
