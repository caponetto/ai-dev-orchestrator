import type {
  AdaptiveConfig,
  ExecutionProfile,
  StaticConfigBaseline,
} from '@ai-orchestrator/schemas';

import { NO_RECOMMENDATION } from '../domain';

const MIN_CALIBRATION_SAMPLES = 3;
const HEADROOM_MULTIPLIER = 1.3;
const MIN_TOKEN_BUDGET = 1024;
const TIMEOUT_HEADROOM = 1.5;
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 600_000;
const LOW_SUCCESS_THRESHOLD = 0.6;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const HIGH_RETRY_THRESHOLD = 2;
const HIGH_RETRYABLE_FAILURE_RATE = 0.8;
const LOW_RETRYABLE_FAILURE_RATE = 0.1;
const RETRY_NEAR_LIMIT_FACTOR = 0.8;
const MAX_RETRY_CAP = 5;
const MAX_COST_MULTIPLIER = 2;

export class AdaptiveConfigResolver {
  resolve(profile: ExecutionProfile, baseline: StaticConfigBaseline): AdaptiveConfig {
    if (profile.sampleSize < MIN_CALIBRATION_SAMPLES) {
      return {
        ...NO_RECOMMENDATION,
        basis: { sampleSize: profile.sampleSize, profileAge: profile.lastUpdated },
      };
    }

    return {
      recommendedMaxOutputTokens: this.resolveTokenBudget(profile, baseline),
      recommendedMaxRetries: this.resolveRetryLimit(profile, baseline),
      recommendedTimeoutMs: this.resolveTimeout(profile),
      modelEscalation: this.resolveModelEscalation(profile),
      basis: { sampleSize: profile.sampleSize, profileAge: profile.lastUpdated },
    };
  }

  private resolveTokenBudget(profile: ExecutionProfile, baseline: StaticConfigBaseline): number {
    const dist = profile.tokenUsage.outputTokens;
    const base = dist.ema > dist.p75 ? dist.ema : dist.p75;
    const recommended = Math.round(base * HEADROOM_MULTIPLIER);

    const ceiling = Math.min(
      baseline.modelMaxTokens,
      baseline.maxOutputTokens * MAX_COST_MULTIPLIER,
    );
    return Math.max(MIN_TOKEN_BUDGET, Math.min(recommended, ceiling));
  }

  private resolveRetryLimit(
    profile: ExecutionProfile,
    baseline: StaticConfigBaseline,
  ): number | null {
    const { retryableFailureRate, avgRetries } = profile.reliability;
    const currentLimit = baseline.maxRetries;

    if (
      retryableFailureRate > HIGH_RETRYABLE_FAILURE_RATE &&
      avgRetries >= currentLimit * RETRY_NEAR_LIMIT_FACTOR
    ) {
      return Math.min(currentLimit + 1, MAX_RETRY_CAP);
    }

    if (retryableFailureRate < LOW_RETRYABLE_FAILURE_RATE) {
      return Math.max(1, currentLimit - 1);
    }

    return null;
  }

  private resolveTimeout(profile: ExecutionProfile): number {
    const recommended = Math.round(profile.timing.durationMs.p90 * TIMEOUT_HEADROOM);
    return Math.max(MIN_TIMEOUT_MS, Math.min(recommended, MAX_TIMEOUT_MS));
  }

  private resolveModelEscalation(profile: ExecutionProfile): AdaptiveConfig['modelEscalation'] {
    if (profile.reliability.successRate < LOW_SUCCESS_THRESHOLD) {
      return {
        recommended: true,
        reason: `Low success rate (${(profile.reliability.successRate * 100).toFixed(0)}% < ${(LOW_SUCCESS_THRESHOLD * 100).toFixed(0)}%)`,
      };
    }

    if (profile.confidence.avgConfidence < LOW_CONFIDENCE_THRESHOLD) {
      return {
        recommended: true,
        reason: `Low confidence (${(profile.confidence.avgConfidence * 100).toFixed(0)}% avg)`,
      };
    }

    if (profile.reliability.avgRetries > HIGH_RETRY_THRESHOLD) {
      return {
        recommended: true,
        reason: `High retry rate (${profile.reliability.avgRetries.toFixed(1)} avg retries > ${String(HIGH_RETRY_THRESHOLD)})`,
      };
    }

    return { recommended: false, reason: null };
  }
}
