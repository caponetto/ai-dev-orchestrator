import { z } from 'zod/v4';

export const metricTypeSchema = z.enum(['counter', 'gauge', 'histogram', 'timer']);
export type MetricType = z.infer<typeof metricTypeSchema>;

export const healthStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const metricEntrySchema = z.object({
  name: z.string(),
  type: metricTypeSchema,
  value: z.number(),
  timestamp: z.string(),
  labels: z.record(z.string(), z.string()),
});
export type MetricEntry = z.infer<typeof metricEntrySchema>;

export const metricSeriesSchema = z.object({
  name: z.string(),
  type: metricTypeSchema,
  labels: z.record(z.string(), z.string()),
  entries: z.array(metricEntrySchema).readonly(),
});
export type MetricSeries = z.infer<typeof metricSeriesSchema>;

export const metricSummarySchema = z.object({
  name: z.string(),
  type: metricTypeSchema,
  count: z.number(),
  total: z.number(),
  min: z.number(),
  max: z.number(),
  mean: z.number(),
  labels: z.record(z.string(), z.string()),
});
export type MetricSummary = z.infer<typeof metricSummarySchema>;

export const healthCheckResultSchema = z.object({
  subsystem: z.string(),
  status: healthStatusSchema,
  message: z.string(),
  checkedAt: z.string(),
  durationMs: z.number(),
  details: z
    .object({
      error: z.string().optional(),
      version: z.union([z.string(), z.number()]).optional(),
    })
    .catchall(z.unknown()),
});
export type HealthCheckResult = z.infer<typeof healthCheckResultSchema>;

export const subsystemHealthSchema = z.object({
  subsystem: z.string(),
  status: healthStatusSchema,
  lastCheckedAt: z.string(),
  consecutiveFailures: z.number(),
  checks: z.array(healthCheckResultSchema).readonly(),
});
export type SubsystemHealth = z.infer<typeof subsystemHealthSchema>;

export const metricsSnapshotSchema = z.object({
  timestamp: z.string(),
  metrics: z.array(metricSummarySchema).readonly(),
  subsystemHealth: z.array(subsystemHealthSchema).readonly(),
});
export type MetricsSnapshot = z.infer<typeof metricsSnapshotSchema>;

export const timingMetricSchema = z.object({
  operation: z.string(),
  subsystem: z.string(),
  durationMs: z.number(),
  startedAt: z.string(),
  completedAt: z.string(),
  labels: z.record(z.string(), z.string()),
});
export type TimingMetric = z.infer<typeof timingMetricSchema>;

export const performanceSnapshotSchema = z.object({
  timestamp: z.string(),
  timings: z.array(timingMetricSchema).readonly(),
  workflowLatencyMs: z.number().nullable(),
  stageLatencies: z.record(z.string(), z.number()),
  eventThroughput: z.number(),
  memoryUsageBytes: z.number().nullable(),
});
export type PerformanceSnapshot = z.infer<typeof performanceSnapshotSchema>;

export interface HealthProbeConfig {
  subsystem: string;
  check: () => Promise<HealthCheckResult>;
}
