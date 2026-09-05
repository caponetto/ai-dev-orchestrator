import type {
  EngineState,
  HumanInput,
  RunResult,
  WaitingContext,
  WorkflowRunConfig,
} from '@ai-dev-orchestrator/schemas';

/** Port for the workflow engine that orchestrates the full FSM lifecycle. */
export interface WorkflowEngine {
  /** Start a new workflow run. Runs the FSM loop until a terminal state or human wait. */
  start(config: WorkflowRunConfig): Promise<RunResult>;

  /** Pause the current run, transitioning to a waiting state. */
  pause(context: WaitingContext): Promise<void>;

  /** Resume a paused run with human input. */
  resume(input: HumanInput): Promise<RunResult>;

  /** Retry a restored run from its current (non-terminal) state. */
  retry(): Promise<RunResult>;

  /** Abort the current run. */
  abort(reason: string): Promise<void>;

  /** Get the current engine state. */
  getState(): EngineState;
}
