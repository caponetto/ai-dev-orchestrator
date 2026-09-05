import type { EventBus } from '@ai-dev-orchestrator/ports';
import type {
  ArtifactRef,
  RoleId,
  RunId,
  WorkerError,
  WorkerFailedData,
  WorkerInvocationRecord,
  WorkerMetrics,
} from '@ai-dev-orchestrator/schemas';

export interface MetricsInput {
  readonly runId: RunId;
  readonly workerId: string;
  readonly stateId: string;
  readonly role: RoleId;
  readonly model: string;
  readonly inputArtifacts: readonly ArtifactRef[];
}

export class MetricsRecorder {
  private readonly eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  emitDispatched(input: MetricsInput): void {
    this.eventBus.publish({
      type: 'worker.dispatched',
      source: 'runner_system',
      correlationId: input.runId,
      data: {
        workerId: input.workerId,
        role: input.role,
        model: input.model,
        inputArtifacts: input.inputArtifacts,
      },
    });
  }

  buildMetrics(
    startedAt: string,
    inputTokens: number,
    outputTokens: number,
    retryCount: number,
    model: string,
  ): WorkerMetrics {
    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    return {
      startedAt,
      completedAt,
      durationMs,
      inputTokens,
      outputTokens,
      retryCount,
      modelUsed: model,
    };
  }

  emitCompleted(
    input: MetricsInput,
    outputArtifacts: readonly ArtifactRef[],
    metrics: WorkerMetrics,
    repairAttempts: number,
  ): void {
    this.eventBus.publish({
      type: 'worker.completed',
      source: 'runner_system',
      correlationId: input.runId,
      data: {
        workerId: input.workerId,
        role: input.role,
        model: input.model,
        outputArtifacts,
        durationMs: metrics.durationMs,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        repairAttempts,
      },
    });
  }

  emitFailed(
    input: MetricsInput,
    error: WorkerError,
    metrics: WorkerMetrics,
    willRetry: boolean,
  ): void {
    type ErrorCategory = WorkerFailedData['errorCategory'];
    const categoryMap: Record<WorkerError['type'], ErrorCategory> = {
      agent_error: 'agent_error',
      timeout: 'timeout',
      invalid_output: 'validation_error',
      schema_violation: 'validation_error',
      ownership_violation: 'validation_error',
      cancelled: 'cancelled',
    };
    this.eventBus.publish({
      type: 'worker.failed',
      source: 'runner_system',
      correlationId: input.runId,
      data: {
        workerId: input.workerId,
        role: input.role,
        error: error.message,
        errorCategory: categoryMap[error.type],
        durationMs: metrics.durationMs,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        willRetry,
      },
    });
  }

  buildInvocationRecord(
    input: MetricsInput,
    outputArtifacts: readonly ArtifactRef[],
    status: WorkerInvocationRecord['status'],
    metrics: WorkerMetrics,
    error?: WorkerError,
  ): WorkerInvocationRecord {
    return {
      timestamp: new Date().toISOString(),
      runId: input.runId,
      workerId: input.workerId,
      stateId: input.stateId,
      role: input.role,
      model: input.model,
      inputArtifacts: input.inputArtifacts,
      outputArtifacts,
      status,
      metrics,
      error,
    };
  }
}
