import type { AgentResult, AgentTask } from '@ai-dev-orchestrator/schemas';

interface TrackedProcess {
  readonly pid?: number;
  kill(): boolean;
  readonly closed?: Promise<void>;
}

/** Owns active subprocesses and cancellation generations across all dispatch attempts. */
export class CliProcessRegistry {
  private readonly active = new Set<TrackedProcess>();
  private cancellationGeneration = 0;
  private readonly cancelled = new Set<TrackedProcess>();

  get generation(): number {
    return this.cancellationGeneration;
  }

  track(process: TrackedProcess): () => void {
    this.active.add(process);
    const untrack = () => {
      this.active.delete(process);
      this.cancelled.delete(process);
    };
    void process.closed?.then(untrack);
    return untrack;
  }

  killAll(): void {
    this.cancellationGeneration += 1;
    for (const process of this.active) {
      if (this.cancelled.has(process)) {
        continue;
      }
      this.cancelled.add(process);
      try {
        process.kill();
      } catch {
        // One failed signal must not prevent cancellation of the remaining processes.
      }
      if (!process.closed) {
        this.active.delete(process);
        this.cancelled.delete(process);
      }
    }
  }
}

export function cancelledAgentResult(task: AgentTask, startTime: number): AgentResult {
  return {
    taskId: task.taskId,
    status: 'failure',
    error: 'Agent dispatch cancelled',
    recoverable: false,
    durationMs: Date.now() - startTime,
  };
}
