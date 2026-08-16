import type { ExecutionProfile, StaticConfigBaseline } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { AdaptiveConfigResolver } from '../adaptive-config-resolver';

function makeDist(value: number) {
  return {
    p50: value * 0.5,
    p75: value * 0.75,
    p90: value * 0.9,
    max: value,
    ema: value * 0.6,
  };
}

function makeProfile(overrides: Partial<ExecutionProfile> = {}): ExecutionProfile {
  return {
    roleId: 'implementer',
    model: 'claude-sonnet-5',
    sampleSize: 10,
    lastUpdated: '2026-01-01T00:00:00Z',
    tokenUsage: {
      inputTokens: makeDist(2000),
      outputTokens: makeDist(2000),
    },
    reliability: {
      successRate: 0.8,
      failureRate: 0.2,
      avgRetries: 0.5,
      retryableFailureRate: 0.3,
      commonErrorTypes: [],
    },
    timing: { durationMs: makeDist(30000) },
    confidence: { avgConfidence: 0.85, escalationRate: 0.1 },
    ...overrides,
  };
}

const DEFAULT_BASELINE: StaticConfigBaseline = {
  maxOutputTokens: 4096,
  maxRetries: 3,
  timeoutMs: 600000,
  modelMaxTokens: 200000,
};

describe('AdaptiveConfigResolver', () => {
  const resolver = new AdaptiveConfigResolver();

  describe('insufficient data', () => {
    it('should return all nulls when sampleSize < 3', () => {
      const profile = makeProfile({ sampleSize: 2 });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.recommendedMaxOutputTokens).toBeNull();
      expect(config.recommendedMaxRetries).toBeNull();
      expect(config.recommendedTimeoutMs).toBeNull();
      expect(config.modelEscalation.recommended).toBe(false);
    });
  });

  describe('token budget adaptation', () => {
    it('should recommend p75 * 1.3 when EMA is not trending up', () => {
      const profile = makeProfile({
        tokenUsage: {
          inputTokens: makeDist(2000),
          outputTokens: { p50: 500, p75: 1000, p90: 1500, max: 2000, ema: 800 },
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.recommendedMaxOutputTokens).toBe(1300);
    });

    it('should use EMA when trending up (EMA > p75)', () => {
      const profile = makeProfile({
        tokenUsage: {
          inputTokens: makeDist(2000),
          outputTokens: { p50: 500, p75: 1000, p90: 1500, max: 2000, ema: 1200 },
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.recommendedMaxOutputTokens).toBe(Math.round(1200 * 1.3));
    });

    it('should clamp to MIN_TOKEN_BUDGET floor', () => {
      const profile = makeProfile({
        tokenUsage: {
          inputTokens: makeDist(100),
          outputTokens: { p50: 10, p75: 50, p90: 80, max: 100, ema: 30 },
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.recommendedMaxOutputTokens).toBe(1024);
    });

    it('should not exceed 2x static config', () => {
      const profile = makeProfile({
        tokenUsage: {
          inputTokens: makeDist(100000),
          outputTokens: { p50: 5000, p75: 8000, p90: 9000, max: 10000, ema: 7000 },
        },
      });
      const baseline = { ...DEFAULT_BASELINE, maxOutputTokens: 4096 };
      const config = resolver.resolve(profile, baseline);

      expect(config.recommendedMaxOutputTokens).toBeLessThanOrEqual(4096 * 2);
    });
  });

  describe('retry limit adaptation', () => {
    it('should increase retries when retryable failure rate is high and retries near limit', () => {
      const profile = makeProfile({
        reliability: {
          successRate: 0.4,
          failureRate: 0.6,
          avgRetries: 2.5,
          retryableFailureRate: 0.9,
          commonErrorTypes: [],
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.recommendedMaxRetries).toBe(4);
    });

    it('should decrease retries when retryable failure rate is very low', () => {
      const profile = makeProfile({
        reliability: {
          successRate: 0.95,
          failureRate: 0.05,
          avgRetries: 0.1,
          retryableFailureRate: 0.05,
          commonErrorTypes: [],
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.recommendedMaxRetries).toBe(2);
    });

    it('should return null when no change is warranted', () => {
      const profile = makeProfile({
        reliability: {
          successRate: 0.7,
          failureRate: 0.3,
          avgRetries: 1.0,
          retryableFailureRate: 0.5,
          commonErrorTypes: [],
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.recommendedMaxRetries).toBeNull();
    });

    it('should cap retries at MAX_RETRY_CAP', () => {
      const profile = makeProfile({
        reliability: {
          successRate: 0.2,
          failureRate: 0.8,
          avgRetries: 4.5,
          retryableFailureRate: 0.95,
          commonErrorTypes: [],
        },
      });
      const baseline = { ...DEFAULT_BASELINE, maxRetries: 5 };
      const config = resolver.resolve(profile, baseline);

      expect(config.recommendedMaxRetries).toBe(5);
    });
  });

  describe('timeout adaptation', () => {
    it('should recommend p90 * 1.5', () => {
      const profile = makeProfile({
        timing: {
          durationMs: { p50: 5000, p75: 10000, p90: 20000, max: 30000, ema: 8000 },
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.recommendedTimeoutMs).toBe(30000);
    });

    it('should clamp to MIN_TIMEOUT_MS', () => {
      const profile = makeProfile({
        timing: {
          durationMs: { p50: 100, p75: 200, p90: 300, max: 500, ema: 150 },
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.recommendedTimeoutMs).toBe(10000);
    });

    it('should clamp to MAX_TIMEOUT_MS', () => {
      const profile = makeProfile({
        timing: {
          durationMs: { p50: 300000, p75: 400000, p90: 500000, max: 550000, ema: 350000 },
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.recommendedTimeoutMs).toBe(600000);
    });
  });

  describe('model escalation', () => {
    it('should recommend escalation when success rate is below 0.6', () => {
      const profile = makeProfile({
        reliability: {
          successRate: 0.5,
          failureRate: 0.5,
          avgRetries: 1.0,
          retryableFailureRate: 0.5,
          commonErrorTypes: [],
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.modelEscalation.recommended).toBe(true);
      expect(config.modelEscalation.reason).toContain('success rate');
    });

    it('should recommend escalation when confidence is low', () => {
      const profile = makeProfile({
        confidence: { avgConfidence: 0.4, escalationRate: 0.3 },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.modelEscalation.recommended).toBe(true);
      expect(config.modelEscalation.reason).toContain('confidence');
    });

    it('should recommend escalation when avg retries are high', () => {
      const profile = makeProfile({
        reliability: {
          successRate: 0.7,
          failureRate: 0.3,
          avgRetries: 2.5,
          retryableFailureRate: 0.5,
          commonErrorTypes: [],
        },
      });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.modelEscalation.recommended).toBe(true);
      expect(config.modelEscalation.reason).toContain('retry');
    });

    it('should not recommend escalation when metrics are healthy', () => {
      const profile = makeProfile();
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.modelEscalation.recommended).toBe(false);
    });
  });

  describe('basis', () => {
    it('should include sample size and profile age', () => {
      const profile = makeProfile({ sampleSize: 42, lastUpdated: '2026-07-01T00:00:00Z' });
      const config = resolver.resolve(profile, DEFAULT_BASELINE);

      expect(config.basis.sampleSize).toBe(42);
      expect(config.basis.profileAge).toBe('2026-07-01T00:00:00Z');
    });
  });
});
