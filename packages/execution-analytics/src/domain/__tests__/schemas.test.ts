import {
  adaptiveConfigSchema,
  distributionSummarySchema,
  executionProfileSchema,
  staticConfigBaselineSchema,
  workerOutcomeRecordSchema,
} from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { NO_RECOMMENDATION } from '../adaptive-config';

describe('DistributionSummary', () => {
  it('should validate a correct distribution summary', () => {
    const summary = { p50: 100, p75: 200, p90: 300, max: 500, ema: 150 };
    expect(distributionSummarySchema.safeParse(summary).success).toBe(true);
  });
});

describe('WorkerOutcomeRecord', () => {
  it('should validate a successful outcome', () => {
    const record = {
      roleId: 'implementer',
      model: 'claude-sonnet-5',
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 5000,
      retryCount: 0,
      status: 'success' as const,
      errorType: null,
      confidenceScore: 0.9,
    };
    expect(workerOutcomeRecordSchema.safeParse(record).success).toBe(true);
  });

  it('should validate a failed outcome with error type', () => {
    const record = {
      roleId: 'implementer',
      model: 'claude-sonnet-5',
      inputTokens: 1000,
      outputTokens: 0,
      durationMs: 60000,
      retryCount: 2,
      status: 'failure' as const,
      errorType: 'timeout' as const,
      confidenceScore: null,
    };
    expect(workerOutcomeRecordSchema.safeParse(record).success).toBe(true);
  });

  it('should reject invalid status', () => {
    const record = {
      roleId: 'implementer',
      model: 'claude-sonnet-5',
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 5000,
      retryCount: 0,
      status: 'pending',
      errorType: null,
      confidenceScore: 0.9,
    };
    expect(workerOutcomeRecordSchema.safeParse(record).success).toBe(false);
  });
});

describe('ExecutionProfile', () => {
  it('should validate a complete profile', () => {
    const dist = { p50: 100, p75: 200, p90: 300, max: 500, ema: 150 };
    const profile = {
      roleId: 'implementer',
      model: 'claude-sonnet-5',
      sampleSize: 10,
      lastUpdated: '2026-01-01T00:00:00Z',
      tokenUsage: { inputTokens: dist, outputTokens: dist },
      reliability: {
        successRate: 0.8,
        failureRate: 0.2,
        avgRetries: 0.5,
        retryableFailureRate: 0.1,
        commonErrorTypes: [{ type: 'timeout' as const, frequency: 0.1 }],
      },
      timing: { durationMs: dist },
      confidence: { avgConfidence: 0.85, escalationRate: 0.1 },
    };
    expect(executionProfileSchema.safeParse(profile).success).toBe(true);
  });
});

describe('AdaptiveConfig', () => {
  it('should validate NO_RECOMMENDATION constant', () => {
    expect(adaptiveConfigSchema.safeParse(NO_RECOMMENDATION).success).toBe(true);
  });
});

describe('StaticConfigBaseline', () => {
  it('should validate a baseline', () => {
    const baseline = {
      maxOutputTokens: 4096,
      maxRetries: 3,
      timeoutMs: 600000,
      modelMaxTokens: 200000,
    };
    expect(staticConfigBaselineSchema.safeParse(baseline).success).toBe(true);
  });
});
