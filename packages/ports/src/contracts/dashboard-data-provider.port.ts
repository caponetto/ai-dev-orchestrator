import type {
  ArtifactContentView,
  ArtifactDetailView,
  ArtifactInventoryView,
  ArtifactRef,
  DashboardEvent,
  DashboardSessionView,
  FindingsView,
  IterationProgressView,
  Result,
  RunConfigView,
  RunStateView,
  RunSummaryView,
  SystemHealthView,
  UsageBreakdownView,
  WorkflowStateView,
} from '@ai-orchestrator/schemas';

/** Port providing read-only dashboard data from the running system. */
export interface DashboardDataProvider {
  getRunState(runId: string): Result<RunStateView>;
  getWorkflowView(runId: string): Result<WorkflowStateView>;
  getArtifactView(runId: string): Result<ArtifactInventoryView>;
  getArtifactDetail(runId: string, ref: ArtifactRef): Result<ArtifactDetailView>;
  getIterationView(runId: string): Result<IterationProgressView>;
  getFindingsView(runId: string): Result<FindingsView>;
  getUsageView(runId: string): Result<UsageBreakdownView>;
  getRunHistory(): Result<readonly RunSummaryView[]>;
  getRunConfig(runId: string): RunConfigView | null;
  getArtifactContent(
    runId: string,
    type: string,
    name: string,
    version: number,
  ): Result<ArtifactContentView>;
  getSystemHealth(): Result<SystemHealthView>;
}

export interface EventCapableDataProvider extends DashboardDataProvider {
  getRunEvents(runId: string): readonly DashboardEvent[];
}

export interface SessionCapableDataProvider extends DashboardDataProvider {
  getSessionsView(runId: string): Result<readonly DashboardSessionView[]>;
}
