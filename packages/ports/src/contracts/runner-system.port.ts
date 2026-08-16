import type {
  DispatchRequest,
  DispatchResult,
  StreamEventCallback,
  WorkerStatus,
} from '@ai-orchestrator/schemas';

/**
 * Port for the runner system that dispatches workers and manages their lifecycle.
 *
 * For protocol-capable agents with resumable session support, dispatch may return
 * a result with `sessionOutcome: 'awaiting_human'` or `'session_active'` instead
 * of blocking until completion. Legacy non-protocol agents always return terminal
 * results with `sessionOutcome: 'completed'` (or undefined for backwards compat).
 */
export interface RunnerSystem {
  /** Dispatch a single worker for a role. */
  dispatch(request: DispatchRequest, onStreamEvent?: StreamEventCallback): Promise<DispatchResult>;

  /** Dispatch multiple workers in parallel, returning all results. */
  dispatchParallel(
    requests: readonly DispatchRequest[],
    createStreamCallback?: (request: DispatchRequest) => StreamEventCallback | undefined,
  ): Promise<readonly DispatchResult[]>;

  /** Get the status of an active worker. Returns null if the worker is not found. */
  getWorkerStatus(workerId: string): WorkerStatus | null;

  /** Cancel an active worker. */
  cancelWorker(workerId: string): Promise<void>;

  /** Cancel all active workers. Called on abort to clean up running subprocesses. */
  cancelAllWorkers(): Promise<void>;
}
