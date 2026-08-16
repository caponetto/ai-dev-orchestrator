import { describe, expect, it } from 'vitest';

import {
  healthCheckResultSchema,
  healthStatusSchema,
  metricEntrySchema,
  metricSeriesSchema,
  metricSummarySchema,
  metricTypeSchema,
  metricsSnapshotSchema,
  performanceSnapshotSchema,
  subsystemHealthSchema,
  timingMetricSchema,
} from '../metrics';

describe('metricTypeSchema', () => {
  it.each(['counter', 'gauge', 'histogram', 'timer'])('accepts "%s"', (val) => {
    expect(metricTypeSchema.safeParse(val).success).toBe(true);
  });

  it('rejects invalid type', () => {
    expect(metricTypeSchema.safeParse('summary').success).toBe(false);
  });
});

describe('healthStatusSchema', () => {
  it.each(['healthy', 'degraded', 'unhealthy', 'unknown'])('accepts "%s"', (val) => {
    expect(healthStatusSchema.safeParse(val).success).toBe(true);
  });
});

describe('metricEntrySchema', () => {
  it('validates a metric entry', () => {
    const data = {
      name: 'worker.duration',
      type: 'timer',
      value: 5000,
      timestamp: '2026-01-01T00:00:00Z',
      labels: { role: 'architect' },
    };
    expect(metricEntrySchema.safeParse(data).success).toBe(true);
  });

  it('validates with empty labels', () => {
    const data = {
      name: 'artifacts.count',
      type: 'counter',
      value: 10,
      timestamp: '2026-01-01T00:00:00Z',
      labels: {},
    };
    expect(metricEntrySchema.safeParse(data).success).toBe(true);
  });
});

describe('metricSeriesSchema', () => {
  it('validates a series', () => {
    const data = {
      name: 'worker.duration',
      type: 'timer',
      labels: { role: 'architect' },
      entries: [
        {
          name: 'worker.duration',
          type: 'timer',
          value: 5000,
          timestamp: '2026-01-01T00:00:00Z',
          labels: { role: 'architect' },
        },
      ],
    };
    expect(metricSeriesSchema.safeParse(data).success).toBe(true);
  });
});

describe('metricSummarySchema', () => {
  it('validates a summary', () => {
    const data = {
      name: 'worker.duration',
      type: 'timer',
      count: 10,
      total: 50000,
      min: 1000,
      max: 10000,
      mean: 5000,
      labels: {},
    };
    expect(metricSummarySchema.safeParse(data).success).toBe(true);
  });
});

describe('healthCheckResultSchema', () => {
  it('validates a health check result', () => {
    const data = {
      subsystem: 'artifact_system',
      status: 'healthy',
      message: 'OK',
      checkedAt: '2026-01-01T00:00:00Z',
      durationMs: 50,
      details: {},
    };
    expect(healthCheckResultSchema.safeParse(data).success).toBe(true);
  });

  it('validates with error details', () => {
    const data = {
      subsystem: 'persistence',
      status: 'unhealthy',
      message: 'Connection failed',
      checkedAt: '2026-01-01T00:00:00Z',
      durationMs: 5000,
      details: { error: 'ECONNREFUSED', version: '1.0.0' },
    };
    expect(healthCheckResultSchema.safeParse(data).success).toBe(true);
  });
});

describe('subsystemHealthSchema', () => {
  it('validates subsystem health', () => {
    const data = {
      subsystem: 'artifact_system',
      status: 'healthy',
      lastCheckedAt: '2026-01-01T00:00:00Z',
      consecutiveFailures: 0,
      checks: [],
    };
    expect(subsystemHealthSchema.safeParse(data).success).toBe(true);
  });
});

describe('metricsSnapshotSchema', () => {
  it('validates a snapshot', () => {
    const data = {
      timestamp: '2026-01-01T00:00:00Z',
      metrics: [],
      subsystemHealth: [],
    };
    expect(metricsSnapshotSchema.safeParse(data).success).toBe(true);
  });
});

describe('timingMetricSchema', () => {
  it('validates a timing metric', () => {
    const data = {
      operation: 'dispatch_worker',
      subsystem: 'runner_system',
      durationMs: 5000,
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:00:05Z',
      labels: { role: 'implementer' },
    };
    expect(timingMetricSchema.safeParse(data).success).toBe(true);
  });
});

describe('performanceSnapshotSchema', () => {
  it('validates a performance snapshot', () => {
    const data = {
      timestamp: '2026-01-01T00:00:00Z',
      timings: [],
      workflowLatencyMs: 30000,
      stageLatencies: { IMPLEMENTATION: 15000, CODE_REVIEW: 10000 },
      eventThroughput: 42.5,
      memoryUsageBytes: 104857600,
    };
    expect(performanceSnapshotSchema.safeParse(data).success).toBe(true);
  });

  it('validates with null latency and memory', () => {
    const data = {
      timestamp: '2026-01-01T00:00:00Z',
      timings: [],
      workflowLatencyMs: null,
      stageLatencies: {},
      eventThroughput: 0,
      memoryUsageBytes: null,
    };
    expect(performanceSnapshotSchema.safeParse(data).success).toBe(true);
  });
});
