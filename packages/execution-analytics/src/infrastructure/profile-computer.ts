import type {
  DistributionSummary,
  ExecutionProfile,
  WorkerOutcomeRecord,
} from '@ai-dev-orchestrator/schemas';

const EMA_ALPHA = 0.3;

const RETRYABLE_ERROR_TYPES = new Set(['agent_error', 'timeout']);

export class ProfileComputer {
  update(
    existing: ExecutionProfile | null,
    outcomes: readonly WorkerOutcomeRecord[],
  ): ExecutionProfile {
    if (outcomes.length === 0 && existing) {
      return existing;
    }

    const first = outcomes[0];
    const newSampleSize = (existing?.sampleSize ?? 0) + outcomes.length;

    const inputTokenValues = outcomes.map((o) => o.inputTokens);
    const outputTokenValues = outcomes.map((o) => o.outputTokens);
    const durationValues = outcomes.map((o) => o.durationMs);

    const successes = outcomes.filter((o) => o.status === 'success').length;
    const failures = outcomes.filter((o) => o.status === 'failure').length;
    const retryableFailures = outcomes.filter(
      (o) =>
        o.status === 'failure' && o.errorType !== null && RETRYABLE_ERROR_TYPES.has(o.errorType),
    ).length;
    const totalRetries = outcomes.reduce((sum, o) => sum + o.retryCount, 0);

    const errorCounts = new Map<string, number>();
    for (const o of outcomes) {
      if (o.errorType) {
        errorCounts.set(o.errorType, (errorCounts.get(o.errorType) ?? 0) + 1);
      }
    }

    const existingErrorMap = new Map<string, number>();
    if (existing) {
      for (const e of existing.reliability.commonErrorTypes) {
        existingErrorMap.set(e.type, e.frequency * existing.sampleSize);
      }
    }
    for (const [type, count] of errorCounts) {
      existingErrorMap.set(type, (existingErrorMap.get(type) ?? 0) + count);
    }
    const commonErrorTypes = [...existingErrorMap.entries()]
      .map(([type, count]) => ({
        type: type as WorkerOutcomeRecord['errorType'] & string,
        frequency: count / newSampleSize,
      }))
      .sort((a, b) => b.frequency - a.frequency);

    const confidenceValues = outcomes
      .map((o) => o.confidenceScore)
      .filter((c): c is number => c !== null);

    const existingConfidenceWeight = existing
      ? existing.confidence.avgConfidence * existing.sampleSize
      : 0;
    const newConfidenceSum = confidenceValues.reduce((a, b) => a + b, 0);
    const totalConfidenceSamples = (existing?.sampleSize ?? 0) + confidenceValues.length;
    const avgConfidence =
      totalConfidenceSamples > 0
        ? (existingConfidenceWeight + newConfidenceSum) / totalConfidenceSamples
        : 0;

    const existingSuccesses = existing ? existing.reliability.successRate * existing.sampleSize : 0;
    const existingFailures = existing ? existing.reliability.failureRate * existing.sampleSize : 0;
    const existingRetries = existing ? existing.reliability.avgRetries * existing.sampleSize : 0;
    const existingRetryableFailures = existing
      ? existing.reliability.retryableFailureRate *
        (existing.reliability.failureRate * existing.sampleSize)
      : 0;

    const totalSuccesses = existingSuccesses + successes;
    const totalFailures = existingFailures + failures;
    const totalAllRetries = existingRetries + totalRetries;
    const totalRetryableFailures = existingRetryableFailures + retryableFailures;

    return {
      roleId: first.roleId,
      model: first.model,
      sampleSize: newSampleSize,
      lastUpdated: new Date().toISOString(),
      tokenUsage: {
        inputTokens: this.computeDistribution(
          inputTokenValues,
          existing?.tokenUsage.inputTokens ?? null,
        ),
        outputTokens: this.computeDistribution(
          outputTokenValues,
          existing?.tokenUsage.outputTokens ?? null,
        ),
      },
      reliability: {
        successRate: totalSuccesses / newSampleSize,
        failureRate: totalFailures / newSampleSize,
        avgRetries: totalAllRetries / newSampleSize,
        retryableFailureRate: totalFailures > 0 ? totalRetryableFailures / totalFailures : 0,
        commonErrorTypes,
      },
      timing: {
        durationMs: this.computeDistribution(durationValues, existing?.timing.durationMs ?? null),
      },
      confidence: {
        avgConfidence,
        escalationRate: existing?.confidence.escalationRate ?? 0,
      },
    };
  }

  private computeDistribution(
    newValues: readonly number[],
    existingDist: DistributionSummary | null,
  ): DistributionSummary {
    const sorted = [...newValues].sort((a, b) => a - b);

    let ema: number;
    if (existingDist === null) {
      ema = newValues.length > 0 ? newValues[newValues.length - 1] : 0;
    } else {
      ema = existingDist.ema;
      for (const v of newValues) {
        ema = EMA_ALPHA * v + (1 - EMA_ALPHA) * ema;
      }
    }

    const p50 = sorted.length > 0 ? this.percentile(sorted, 0.5) : (existingDist?.p50 ?? 0);
    const p75 = sorted.length > 0 ? this.percentile(sorted, 0.75) : (existingDist?.p75 ?? 0);
    const p90 = sorted.length > 0 ? this.percentile(sorted, 0.9) : (existingDist?.p90 ?? 0);
    const max =
      sorted.length > 0
        ? Math.max(sorted[sorted.length - 1], existingDist?.max ?? 0)
        : (existingDist?.max ?? 0);

    return { p50, p75, p90, max, ema };
  }

  private percentile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) {
      return 0;
    }
    if (sorted.length === 1) {
      return sorted[0];
    }

    const index = p * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const fraction = index - lower;

    return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
  }
}
