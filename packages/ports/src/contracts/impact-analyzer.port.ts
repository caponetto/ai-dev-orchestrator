import type { RebuildEstimate, RebuildPlan, StaleSet } from '@ai-orchestrator/schemas';

/** Port for computing rebuild plans from stale artifact sets. */
export interface ImpactAnalyzer {
  /** Compute the workflow states that need re-entering to rebuild stale artifacts. */
  computeRebuildPlan(staleSet: StaleSet): RebuildPlan;

  /** Estimate the cost of executing a rebuild plan. */
  estimateRebuildCost(plan: RebuildPlan): RebuildEstimate;
}
