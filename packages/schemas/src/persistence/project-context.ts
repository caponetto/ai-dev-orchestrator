import { z } from 'zod/v4';

export const contextCategorySchema = z.enum([
  'codebase',
  'run_history',
  'preferences',
  'analytics',
]);
export type ContextCategory = z.infer<typeof contextCategorySchema>;

export const moduleInfoSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  keyAbstractions: z.array(z.string()),
});
export type ModuleInfo = z.infer<typeof moduleInfoSchema>;

export const patternInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  discoveredInRun: z.string(),
});
export type PatternInfo = z.infer<typeof patternInfoSchema>;

export const conventionInfoSchema = z.object({
  rule: z.string(),
  evidence: z.string(),
  discoveredInRun: z.string(),
});
export type ConventionInfo = z.infer<typeof conventionInfoSchema>;

export const codebaseContextSchema = z.object({
  projectName: z.string(),
  lastUpdated: z.string(),
  lastRunId: z.string(),
  architecture: z.object({
    summary: z.string(),
    modules: z.array(moduleInfoSchema),
    patterns: z.array(patternInfoSchema),
  }),
  conventions: z.array(conventionInfoSchema),
});
export type CodebaseContext = z.infer<typeof codebaseContextSchema>;

export const runHistoryEntrySchema = z.object({
  runId: z.string(),
  timestamp: z.string(),
  workflowVariant: z.string(),
  taskSummary: z.string(),
  outcome: z.enum(['completed', 'failed', 'aborted', 'escalated']),
  compressed: z.boolean(),
  keyFindings: z.array(z.string()).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  modelUsed: z.string().optional(),
});
export type RunHistoryEntry = z.infer<typeof runHistoryEntrySchema>;

export const runHistorySchema = z.object({
  lastUpdated: z.string(),
  runs: z.array(runHistoryEntrySchema),
});
export type RunHistory = z.infer<typeof runHistorySchema>;

export const modelCalibrationEntrySchema = z.object({
  roleId: z.string(),
  model: z.string(),
  successRate: z.number().min(0).max(1),
  avgConfidence: z.number().min(0).max(1),
  escalationRate: z.number().min(0).max(1),
  sampleSize: z.number().int().nonnegative(),
});
export type ModelCalibrationEntry = z.infer<typeof modelCalibrationEntrySchema>;

export const failurePatternSchema = z.object({
  pattern: z.string(),
  frequency: z.number().int().nonnegative(),
  lastSeen: z.string(),
});
export type FailurePattern = z.infer<typeof failurePatternSchema>;

export const projectPreferenceSchema = z.object({
  key: z.string(),
  value: z.string(),
  discoveredInRun: z.string(),
});
export type ProjectPreference = z.infer<typeof projectPreferenceSchema>;

export const learnedPreferencesSchema = z.object({
  lastUpdated: z.string(),
  modelCalibration: z.array(modelCalibrationEntrySchema),
  failurePatterns: z.array(failurePatternSchema),
  projectPreferences: z.array(projectPreferenceSchema),
});
export type LearnedPreferences = z.infer<typeof learnedPreferencesSchema>;

export const contextDocumentSchema = z.object({
  category: contextCategorySchema,
  content: z.unknown(),
  lastUpdated: z.string(),
  lastRunId: z.string().optional(),
});
export type ContextDocument = z.infer<typeof contextDocumentSchema>;

export const contextQuerySchema = z.object({
  categories: z.array(contextCategorySchema).optional(),
  role: z.string().optional(),
  maxTokens: z.number().optional(),
});
export type ContextQuery = z.infer<typeof contextQuerySchema>;

export const contextFragmentSchema = z.object({
  category: contextCategorySchema,
  content: z.string(),
  relevanceScore: z.number().min(0).max(1),
});
export type ContextFragment = z.infer<typeof contextFragmentSchema>;
