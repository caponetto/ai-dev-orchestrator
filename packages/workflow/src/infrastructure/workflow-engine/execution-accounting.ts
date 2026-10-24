import type { Logger } from '@ai-dev-orchestrator/ports';
import type { ActionResult, PersistedState, WorkflowRunConfig } from '@ai-dev-orchestrator/schemas';

/** Owns token totals, worker accounting and budget-alert progress for one controller. */
export class ExecutionAccounting {
  private _cumulativeInputTokens = 0;
  private _cumulativeOutputTokens = 0;
  private _firedThresholdIndex = -1;
  private _hasReceivedUsage = false;
  private _workerMetricsByRole: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      dispatches: number;
      durationMs: number;
      artifactsProduced: number;
    }
  > = {};
  private _workerFailuresByRole: Record<string, { error: string; model?: string }[]> = {};
  private _workerModelByRole: Record<string, string> = {};

  get cumulativeInputTokens(): number {
    return this._cumulativeInputTokens;
  }
  get cumulativeOutputTokens(): number {
    return this._cumulativeOutputTokens;
  }
  get firedThresholdIndex(): number {
    return this._firedThresholdIndex;
  }
  get hasReceivedUsage(): boolean {
    return this._hasReceivedUsage;
  }
  get workerMetricsByRole(): Readonly<NonNullable<PersistedState['workerMetricsByRole']>> {
    return this._workerMetricsByRole;
  }
  get workerFailuresByRole(): Readonly<
    Record<string, readonly { error: string; model?: string }[]>
  > {
    return this._workerFailuresByRole;
  }
  get workerModelByRole(): Readonly<Record<string, string>> {
    return this._workerModelByRole;
  }

  restore(
    state: Pick<
      PersistedState,
      | 'cumulativeInputTokens'
      | 'cumulativeOutputTokens'
      | 'firedThresholdIndex'
      | 'hasReceivedUsage'
      | 'workerMetricsByRole'
    >,
  ): void {
    this._cumulativeInputTokens = state.cumulativeInputTokens ?? 0;
    this._cumulativeOutputTokens = state.cumulativeOutputTokens ?? 0;
    this._firedThresholdIndex = state.firedThresholdIndex ?? -1;
    this._hasReceivedUsage = state.hasReceivedUsage ?? false;
    this._workerMetricsByRole = state.workerMetricsByRole
      ? Object.fromEntries(Object.entries(state.workerMetricsByRole).map(([k, v]) => [k, { ...v }]))
      : {};
  }

  reset(): void {
    this._cumulativeInputTokens = 0;
    this._cumulativeOutputTokens = 0;
    this._firedThresholdIndex = -1;
    this._hasReceivedUsage = false;
    this._workerMetricsByRole = {};
    this._workerFailuresByRole = {};
    this._workerModelByRole = {};
  }

  record(actionResults: readonly ActionResult[]): void {
    for (const result of actionResults) {
      if (result.workerResults) {
        for (const wr of result.workerResults) {
          if (wr.role && wr.model) {
            this._workerModelByRole[wr.role] = wr.model;
          }
          if (!wr.success && wr.error && wr.role) {
            const role = wr.role;
            const failures = (this._workerFailuresByRole[role] ??= []);
            failures.push({ error: wr.error, model: wr.model });
          }
        }
      }

      if (!result.usageSnapshot) {
        continue;
      }
      const snap = result.usageSnapshot;
      this._cumulativeInputTokens += snap.totalInputTokens;
      this._cumulativeOutputTokens += snap.totalOutputTokens;
      this._hasReceivedUsage = true;
      for (const [role, usage] of Object.entries(snap.byRole)) {
        const existing = this._workerMetricsByRole[role] as
          (typeof this._workerMetricsByRole)[string] | undefined;
        if (existing) {
          existing.inputTokens += usage.inputTokens;
          existing.outputTokens += usage.outputTokens;
          existing.dispatches += 1;
          existing.durationMs += usage.durationMs;
        } else {
          this._workerMetricsByRole[role] = {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            dispatches: 1,
            durationMs: usage.durationMs,
            artifactsProduced: 0,
          };
        }
      }
    }
  }

  checkAlertThresholds(
    config: Pick<WorkflowRunConfig, 'budgetMaxTokens' | 'budgetAlertThresholds'> | null,
    logger: Logger,
  ): void {
    if (!config?.budgetMaxTokens || !config.budgetAlertThresholds?.length) {
      return;
    }
    const totalTokens = this._cumulativeInputTokens + this._cumulativeOutputTokens;
    const ratio = totalTokens / config.budgetMaxTokens;
    const sorted = [...config.budgetAlertThresholds].sort((a, b) => a - b);
    for (let i = this._firedThresholdIndex + 1; i < sorted.length; i++) {
      if (ratio >= sorted[i]) {
        this._firedThresholdIndex = i;
        const pct = Math.round(sorted[i] * 100);
        logger.warn(
          `[LifecycleController] Budget alert: ${String(pct)}% threshold reached (${String(totalTokens)}/${String(config.budgetMaxTokens)} tokens used)`,
        );
      } else {
        break;
      }
    }
  }
}
