import { OrchestratorError } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { HealthCheckFailedError, MetricsCollectionError } from '../metrics-errors';

describe('MetricsCollectionError', () => {
  it('has the correct code', () => {
    const error = new MetricsCollectionError('request_count', 'overflow');
    expect(error.code).toBe('METRICS_COLLECTION_ERROR');
  });

  it('is recoverable', () => {
    const error = new MetricsCollectionError('request_count', 'overflow');
    expect(error.recoverable).toBe(true);
  });

  it('is an OrchestratorError', () => {
    const error = new MetricsCollectionError('request_count', 'overflow');
    expect(error).toBeInstanceOf(OrchestratorError);
  });

  it('includes metric name and cause in message', () => {
    const error = new MetricsCollectionError('request_count', 'overflow');
    expect(error.message).toContain('request_count');
    expect(error.message).toContain('overflow');
  });

  it('exposes constructor params', () => {
    const error = new MetricsCollectionError('request_count', 'overflow');
    expect(error.metricName).toBe('request_count');
    expect(error.cause).toBe('overflow');
  });
});

describe('HealthCheckFailedError', () => {
  it('has the correct code', () => {
    const error = new HealthCheckFailedError('event-system', 'timeout');
    expect(error.code).toBe('HEALTH_CHECK_FAILED');
  });

  it('is recoverable', () => {
    const error = new HealthCheckFailedError('event-system', 'timeout');
    expect(error.recoverable).toBe(true);
  });

  it('is an OrchestratorError', () => {
    const error = new HealthCheckFailedError('event-system', 'timeout');
    expect(error).toBeInstanceOf(OrchestratorError);
  });

  it('includes subsystem and cause in message', () => {
    const error = new HealthCheckFailedError('event-system', 'timeout');
    expect(error.message).toContain('event-system');
    expect(error.message).toContain('timeout');
  });
});
