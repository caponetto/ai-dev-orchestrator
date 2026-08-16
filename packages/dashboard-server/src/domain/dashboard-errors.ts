import { RecoverableErrorBase } from '@ai-orchestrator/ports';

export class DashboardDataError extends RecoverableErrorBase {
  readonly code = 'DASHBOARD_DATA_ERROR';
  readonly recoverable = true;

  constructor(
    readonly source: string,
    readonly detail: string,
  ) {
    super(`Dashboard data error in ${source}: ${detail}`);
  }
}
