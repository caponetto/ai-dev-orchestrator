import { RecoverableErrorBase } from '@ai-orchestrator/ports';

export class DiagnosticsError extends RecoverableErrorBase {
  readonly code = 'DIAGNOSTICS_ERROR';
  readonly recoverable = true;

  constructor(
    readonly subsystem: string,
    readonly detail: string,
  ) {
    super(`Diagnostics error in ${subsystem}: ${detail}`);
  }
}

export class FailureAnalysisError extends RecoverableErrorBase {
  readonly code = 'FAILURE_ANALYSIS_ERROR';
  readonly recoverable = true;

  constructor(
    readonly runId: string,
    readonly detail: string,
  ) {
    super(`Failure analysis error for run ${runId}: ${detail}`);
  }
}

export class ConfigInspectionError extends RecoverableErrorBase {
  readonly code = 'CONFIG_INSPECTION_ERROR';
  readonly recoverable = true;

  constructor(readonly detail: string) {
    super(`Configuration inspection error: ${detail}`);
  }
}
