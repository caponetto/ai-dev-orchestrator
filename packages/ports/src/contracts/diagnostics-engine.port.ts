import type {
  ConfigurationInspection,
  DiagnosticReport,
  FailureAnalysis,
  Result,
  SubsystemDiagnostic,
} from '@ai-orchestrator/schemas';

/** Port for system diagnostics — failure analysis, config inspection, subsystem health. */
export interface DiagnosticsEngine {
  /** Analyze why a workflow run failed or stopped. */
  analyzeFailure(runId: string): Result<FailureAnalysis>;

  /** Inspect the current system configuration for issues. */
  inspectConfiguration(): Result<ConfigurationInspection>;

  /** Get diagnostics for a specific subsystem. */
  getSubsystemDiagnostics(subsystem: string): Result<SubsystemDiagnostic>;

  /** Generate a full diagnostic report for a run or the system. */
  generateReport(runId?: string): Result<DiagnosticReport>;
}
