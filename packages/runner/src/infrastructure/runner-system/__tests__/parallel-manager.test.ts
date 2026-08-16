import { createRunId } from '@ai-orchestrator/ports';
import type { DispatchRequest, DispatchResult, WorkerMetrics } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { ParallelManager } from '../parallel-manager';
import type { DispatchFn } from '../parallel-manager';

function makeRequest(role: string): DispatchRequest {
  return {
    runId: createRunId('run-1'),
    stateId: 'state-1',
    role,
    inputArtifacts: [],
  };
}

function makeMetrics(): WorkerMetrics {
  return {
    startedAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:00:01Z',
    durationMs: 1000,
    inputTokens: 100,
    outputTokens: 50,
    retryCount: 0,
    modelUsed: 'test-model',
  };
}

function makeResult(role: string): DispatchResult {
  return {
    workerId: 'worker-1',
    role,
    status: 'success',
    outputArtifacts: [],
    metrics: makeMetrics(),
  };
}

function makeSuccessResult(request: DispatchRequest): DispatchResult {
  return {
    workerId: `worker-${request.role}`,
    role: request.role,
    status: 'success',
    outputArtifacts: [],
    metrics: makeMetrics(),
  };
}

describe('ParallelManager', () => {
  it('dispatches all requests in parallel', async () => {
    const dispatchFn = vi
      .fn()
      .mockResolvedValueOnce(makeResult('architect'))
      .mockResolvedValueOnce(makeResult('reviewer'));

    const manager = new ParallelManager(dispatchFn);
    const results = await manager.dispatchAll([makeRequest('architect'), makeRequest('reviewer')]);

    expect(results).toHaveLength(2);
    expect(results[0].role).toBe('architect');
    expect(results[1].role).toBe('reviewer');
    expect(dispatchFn).toHaveBeenCalledTimes(2);
  });

  it('handles partial failures', async () => {
    const dispatchFn = vi
      .fn()
      .mockResolvedValueOnce(makeResult('architect'))
      .mockRejectedValueOnce(new Error('Provider down'));

    const manager = new ParallelManager(dispatchFn);
    const results = await manager.dispatchAll([makeRequest('architect'), makeRequest('reviewer')]);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('failure');
    expect(results[1].error?.message).toBe('Provider down');
  });

  it('handles all failures', async () => {
    const dispatchFn = vi.fn().mockRejectedValue(new Error('All down'));

    const manager = new ParallelManager(dispatchFn);
    const results = await manager.dispatchAll([makeRequest('architect'), makeRequest('reviewer')]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'failure')).toBe(true);
  });

  it('returns empty array for empty requests', async () => {
    const dispatchFn = vi.fn();
    const manager = new ParallelManager(dispatchFn);
    const results = await manager.dispatchAll([]);

    expect(results).toHaveLength(0);
    expect(dispatchFn).not.toHaveBeenCalled();
  });

  it('preserves request role in failure results', async () => {
    const dispatchFn = vi.fn().mockRejectedValue(new Error('fail'));
    const manager = new ParallelManager(dispatchFn);
    const results = await manager.dispatchAll([makeRequest('architect')]);

    expect(results[0].role).toBe('architect');
  });

  it('limits concurrency to maxConcurrency', async () => {
    let activeCalls = 0;
    let peakConcurrency = 0;

    const slowDispatch: DispatchFn = async (request) => {
      activeCalls += 1;
      peakConcurrency = Math.max(peakConcurrency, activeCalls);
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      activeCalls -= 1;
      return makeSuccessResult(request);
    };

    const manager = new ParallelManager(slowDispatch, 2);
    const requests = Array.from({ length: 6 }, (_, i) => makeRequest(`role-${String(i)}`));
    await manager.dispatchAll(requests);

    expect(peakConcurrency).toBeLessThanOrEqual(2);
  });

  it('processes all requests even with concurrency limit', async () => {
    const dispatch: DispatchFn = (request) => Promise.resolve(makeSuccessResult(request));
    const manager = new ParallelManager(dispatch, 2);
    const requests = Array.from({ length: 5 }, (_, i) => makeRequest(`role-${String(i)}`));
    const results = await manager.dispatchAll(requests);

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('forwards per-request stream callbacks from factory', async () => {
    const callbackCalls: Array<{ role: string; content: string }> = [];

    const dispatch: DispatchFn = (request, onStreamEvent) => {
      onStreamEvent?.({
        timestamp: '2024-01-01T00:00:00Z',
        type: 'stdout',
        content: `output-${request.role}`,
      });
      return Promise.resolve(makeSuccessResult(request));
    };

    const manager = new ParallelManager(dispatch);
    const requests = [makeRequest('reviewer'), makeRequest('architect')];
    await manager.dispatchAll(requests, (request) => (event) => {
      callbackCalls.push({ role: request.role, content: event.content });
    });

    expect(callbackCalls).toHaveLength(2);
    expect(callbackCalls).toContainEqual({ role: 'reviewer', content: 'output-reviewer' });
    expect(callbackCalls).toContainEqual({ role: 'architect', content: 'output-architect' });
  });

  it('works without stream callback factory', async () => {
    const dispatch: DispatchFn = (request, onStreamEvent) => {
      onStreamEvent?.({
        timestamp: '2024-01-01T00:00:00Z',
        type: 'stdout',
        content: 'test',
      });
      return Promise.resolve(makeSuccessResult(request));
    };

    const manager = new ParallelManager(dispatch);
    const results = await manager.dispatchAll([makeRequest('role-1')]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
  });

  it('defaults to unbounded when maxConcurrency is not set', async () => {
    let activeCalls = 0;
    let peakConcurrency = 0;

    const dispatch: DispatchFn = async (request) => {
      activeCalls += 1;
      peakConcurrency = Math.max(peakConcurrency, activeCalls);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      activeCalls -= 1;
      return makeSuccessResult(request);
    };

    const manager = new ParallelManager(dispatch);
    const requests = Array.from({ length: 5 }, (_, i) => makeRequest(`role-${String(i)}`));
    await manager.dispatchAll(requests);

    expect(peakConcurrency).toBe(5);
  });
});
