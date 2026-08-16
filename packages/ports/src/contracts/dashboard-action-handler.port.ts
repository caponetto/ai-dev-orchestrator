import type {
  DashboardActionResult,
  RunCreationParams,
  WorkflowStateView,
  WorkflowSummary,
} from '@ai-orchestrator/schemas';

/** Result of creating a new run. */
export interface CreateRunResult extends DashboardActionResult {
  readonly runId?: string;
}

export interface ApproveRejectOptions {
  readonly message?: string;
  readonly sessionId?: string;
}

export interface AbortOptions {
  readonly force?: boolean;
  readonly sessionId?: string;
  readonly reason?: string;
}

export interface AnswerOptions {
  readonly content: string;
  readonly sessionId?: string;
}

/** Port for handling persisted workflow actions from the dashboard UI. */
export interface DashboardActionHandler {
  approve(runId: string, options: ApproveRejectOptions): Promise<DashboardActionResult>;
  reject(runId: string, options: ApproveRejectOptions): Promise<DashboardActionResult>;
  abort(runId: string, options: AbortOptions): Promise<DashboardActionResult>;
  answer(runId: string, options: AnswerOptions): Promise<DashboardActionResult>;
  retry(runId: string): Promise<DashboardActionResult>;
  deleteRun(runId: string): Promise<DashboardActionResult>;
  createRun(options: RunCreationParams): Promise<CreateRunResult>;
  listWorkflows(): readonly WorkflowSummary[];
  getWorkflowPreview(name: string): WorkflowStateView | null;
}
