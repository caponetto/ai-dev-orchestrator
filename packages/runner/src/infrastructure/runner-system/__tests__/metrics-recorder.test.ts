import type { EventBus } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { ArtifactRef } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { MetricsRecorder } from '../metrics-recorder';
import type { MetricsInput } from '../metrics-recorder';

function makeEventBus(): EventBus {
  return {
    publish: vi.fn().mockReturnValue({
      id: 'evt-1',
      runId: createRunId('run-1'),
      sequence: 1,
      timestamp: '',
      type: 'worker.dispatched',
      data: {},
      source: 'runner_system',
    }),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    replay: vi.fn(),
  };
}

function makeInput(): MetricsInput {
  return {
    runId: createRunId('run-1'),
    workerId: 'worker-1',
    stateId: 'state-1',
    role: 'architect',
    model: 'claude-3',
    inputArtifacts: [],
  };
}

describe('MetricsRecorder', () => {
  it('emits worker.dispatched event', () => {
    const bus = makeEventBus();
    const recorder = new MetricsRecorder(bus);
    recorder.emitDispatched(makeInput());

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'worker.dispatched',
        source: 'runner_system',
      }),
    );
  });

  it('builds metrics with correct fields', () => {
    const bus = makeEventBus();
    const recorder = new MetricsRecorder(bus);
    const metrics = recorder.buildMetrics('2024-01-01T00:00:00Z', 100, 50, 1, 'claude-3');

    expect(metrics.inputTokens).toBe(100);
    expect(metrics.outputTokens).toBe(50);
    expect(metrics.retryCount).toBe(1);
    expect(metrics.modelUsed).toBe('claude-3');
    expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(metrics.completedAt).toBeTruthy();
  });

  it('emits worker.completed event', () => {
    const bus = makeEventBus();
    const recorder = new MetricsRecorder(bus);
    const metrics = recorder.buildMetrics('2024-01-01T00:00:00Z', 100, 50, 0, 'claude-3');
    const outputArtifacts: ArtifactRef[] = [
      { type: 'static_review', name: 'review-1', version: 1, checksum: 'abc' },
    ];

    recorder.emitCompleted(makeInput(), outputArtifacts, metrics, 0);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'worker.completed',
        source: 'runner_system',
      }),
    );
  });

  it('emits worker.failed event', () => {
    const bus = makeEventBus();
    const recorder = new MetricsRecorder(bus);
    const metrics = recorder.buildMetrics('2024-01-01T00:00:00Z', 0, 0, 0, 'claude-3');

    recorder.emitFailed(
      makeInput(),
      { type: 'agent_error', message: 'API error', retryable: true },
      metrics,
      true,
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'worker.failed',
        source: 'runner_system',
      }),
    );
  });

  it('builds invocation record with all fields', () => {
    const bus = makeEventBus();
    const recorder = new MetricsRecorder(bus);
    const metrics = recorder.buildMetrics('2024-01-01T00:00:00Z', 100, 50, 0, 'claude-3');

    const record = recorder.buildInvocationRecord(makeInput(), [], 'success', metrics);

    expect(record.runId).toBe('run-1');
    expect(record.workerId).toBe('worker-1');
    expect(record.role).toBe('architect');
    expect(record.status).toBe('success');
    expect(record.metrics).toBe(metrics);
  });

  it('includes error in invocation record when provided', () => {
    const bus = makeEventBus();
    const recorder = new MetricsRecorder(bus);
    const metrics = recorder.buildMetrics('2024-01-01T00:00:00Z', 0, 0, 0, 'claude-3');
    const error = { type: 'timeout' as const, message: 'timed out', retryable: true };

    const record = recorder.buildInvocationRecord(makeInput(), [], 'failure', metrics, error);

    expect(record.error).toBe(error);
  });
});
