import type {
  DispatchRequest,
  DispatchResult,
  StreamEventCallback,
} from '@ai-dev-orchestrator/schemas';
import { getErrorMessage } from '@ai-dev-orchestrator/utils';
export type DispatchFn = (
  request: DispatchRequest,
  onStreamEvent?: StreamEventCallback,
) => Promise<DispatchResult>;

/** Manages parallel execution of multiple dispatch requests with concurrency control. */
export class ParallelManager {
  private readonly dispatchFn: DispatchFn;
  private readonly maxConcurrency: number;

  constructor(dispatchFn: DispatchFn, maxConcurrency = Infinity) {
    this.dispatchFn = dispatchFn;
    this.maxConcurrency = maxConcurrency;
  }

  /** Dispatch all requests in parallel, respecting the concurrency limit. */
  async dispatchAll(
    requests: readonly DispatchRequest[],
    createStreamCallback?: (request: DispatchRequest) => StreamEventCallback | undefined,
  ): Promise<readonly DispatchResult[]> {
    if (this.maxConcurrency === Infinity || requests.length <= this.maxConcurrency) {
      return this.dispatchUnbounded(requests, createStreamCallback);
    }
    return this.dispatchBounded(requests, createStreamCallback);
  }

  private async dispatchUnbounded(
    requests: readonly DispatchRequest[],
    createStreamCallback?: (request: DispatchRequest) => StreamEventCallback | undefined,
  ): Promise<readonly DispatchResult[]> {
    const settled = await Promise.allSettled(
      requests.map((r) => this.dispatchFn(r, createStreamCallback?.(r))),
    );
    return settled.map((outcome, index) => this.settledToResult(outcome, requests[index], index));
  }

  private async dispatchBounded(
    requests: readonly DispatchRequest[],
    createStreamCallback?: (request: DispatchRequest) => StreamEventCallback | undefined,
  ): Promise<readonly DispatchResult[]> {
    const results: DispatchResult[] = new Array<DispatchResult>(requests.length);
    let nextIndex = 0;

    const runNext = async (): Promise<void> => {
      while (nextIndex < requests.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = await this.dispatchFn(
            requests[index],
            createStreamCallback?.(requests[index]),
          );
        } catch (error: unknown) {
          results[index] = this.errorResult(error, requests[index], index);
        }
      }
    };

    const workers = Array.from({ length: Math.min(this.maxConcurrency, requests.length) }, () =>
      runNext(),
    );

    await Promise.all(workers);
    return results;
  }

  private settledToResult(
    outcome: PromiseSettledResult<DispatchResult>,
    request: DispatchRequest,
    index: number,
  ): DispatchResult {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    return this.errorResult(outcome.reason, request, index);
  }

  private errorResult(error: unknown, request: DispatchRequest, index: number): DispatchResult {
    const message = getErrorMessage(error);
    return {
      workerId: `worker-${String(index)}`,
      role: request.role,
      status: 'failure' as const,
      outputArtifacts: [],
      error: {
        type: 'agent_error' as const,
        message,
        retryable: false,
      },
      metrics: {
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        retryCount: 0,
        modelUsed: 'unknown',
      },
    };
  }
}
