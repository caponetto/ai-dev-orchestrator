import { z } from 'zod/v4';

export const diagnosticSeveritySchema = z.enum(['error', 'warning', 'info', 'hint']);
export type DiagnosticSeverity = z.infer<typeof diagnosticSeveritySchema>;

export const diagnosticEntrySchema = z.object({
  severity: diagnosticSeveritySchema,
  code: z.string(),
  message: z.string(),
  subsystem: z.string(),
  context: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
  suggestion: z.string().optional(),
});
export type DiagnosticEntry = z.infer<typeof diagnosticEntrySchema>;

export const diagnosticReportSummarySchema = z.object({
  totalEntries: z.number(),
  errorCount: z.number(),
  warningCount: z.number(),
  infoCount: z.number(),
  hintCount: z.number(),
  subsystemsAffected: z.array(z.string()).readonly(),
});
export type DiagnosticReportSummary = z.infer<typeof diagnosticReportSummarySchema>;

export const errorChainEntrySchema = z.object({
  source: z.string(),
  code: z.string(),
  message: z.string(),
  timestamp: z.string(),
});
export type ErrorChainEntry = z.infer<typeof errorChainEntrySchema>;

export const failureAnalysisSchema = z.object({
  runId: z.string(),
  failedAt: z.string(),
  failedState: z.string(),
  rootCause: z.string(),
  contributingFactors: z.array(z.string()).readonly(),
  errorChain: z.array(errorChainEntrySchema).readonly(),
  recommendation: z.string(),
});
export type FailureAnalysis = z.infer<typeof failureAnalysisSchema>;

export const configurationIssueSchema = z.object({
  severity: diagnosticSeveritySchema,
  path: z.string(),
  message: z.string(),
  currentValue: z.unknown(),
  expectedValue: z.unknown().optional(),
  suggestion: z.string().optional(),
});
export type ConfigurationIssue = z.infer<typeof configurationIssueSchema>;

export const configurationInspectionSchema = z.object({
  valid: z.boolean(),
  entries: z.array(configurationIssueSchema).readonly(),
  checkedAt: z.string(),
});
export type ConfigurationInspection = z.infer<typeof configurationInspectionSchema>;

export const subsystemDiagnosticSchema = z.object({
  subsystem: z.string(),
  status: z.string(),
  entries: z.array(diagnosticEntrySchema).readonly(),
  metrics: z.record(z.string(), z.number()),
  checkedAt: z.string(),
});
export type SubsystemDiagnostic = z.infer<typeof subsystemDiagnosticSchema>;

export const diagnosticReportSchema = z.object({
  generatedAt: z.string(),
  runId: z.string().nullable(),
  entries: z.array(diagnosticEntrySchema).readonly(),
  summary: diagnosticReportSummarySchema,
  failureAnalysis: failureAnalysisSchema.nullable(),
  configurationInspection: configurationInspectionSchema.nullable(),
  subsystemDiagnostics: z.array(subsystemDiagnosticSchema).readonly(),
});
export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;
