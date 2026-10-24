import type { AgentResult, AgentTask } from '@ai-dev-orchestrator/schemas';

interface TrackedProcess {
  readonly pid?: number;
  kill(): boolean;
}

/** Owns active subprocesses and cancellation generations across all dispatch attempts. */
export class CliProcessRegistry {
  private readonly active = new Set<TrackedProcess>();
  private cancellationGeneration = 0;

  get generation(): number {
    return this.cancellationGeneration;
  }

  track(process: TrackedProcess): () => void {
    this.active.add(process);
    return () => {
      this.active.delete(process);
    };
  }

  killAll(): void {
    this.cancellationGeneration += 1;
    for (const process of this.active) {
      try {
        process.kill();
      } catch {
        // One failed signal must not prevent cancellation of the remaining processes.
      }
    }
    this.active.clear();
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
