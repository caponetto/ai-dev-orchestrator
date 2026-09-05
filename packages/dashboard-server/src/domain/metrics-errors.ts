import { RecoverableErrorBase } from '@ai-dev-orchestrator/ports';

export class MetricsCollectionError extends RecoverableErrorBase {
  readonly code = 'METRICS_COLLECTION_ERROR';

  constructor(
    readonly metricName: string,
    readonly cause: string,
  ) {
    super(`Failed to collect metric '${metricName}': ${cause}`);
  }
}

export class HealthCheckFailedError extends RecoverableErrorBase {
  readonly code = 'HEALTH_CHECK_FAILED';

  constructor(
    readonly subsystem: string,
    readonly cause: string,
  ) {
    super(`Health check failed for '${subsystem}': ${cause}`);
  }
}
