/** Builds escalation context when governance triggers escalation. */
import type {
  ArtifactRef,
  EscalationContext,
  EscalationReason,
  FindingSummary,
  IterationSummary,
  RunId,
} from '@ai-orchestrator/schemas';
export class EscalationManager {
  /** Assemble escalation context for the given trigger. */
  buildContext(
    runId: RunId,
    stageId: string,
    reason: EscalationReason,
    findings: readonly FindingSummary[],
    artifacts: readonly ArtifactRef[],
    iterationHistory: readonly IterationSummary[] = [],
  ): EscalationContext {
    const unresolvedFindings = findings.filter(
      (f) => f.status === 'open' || f.status === 'escalated',
    );

    const suggestedActions = this.suggestActions(reason, unresolvedFindings);

    return {
      runId,
      stageId,
      reason,
      iterationHistory,
      unresolvedFindings,
      artifactRefs: artifacts,
      suggestedActions,
    };
  }

  private suggestActions(
    reason: EscalationReason,
    unresolved: readonly FindingSummary[],
  ): readonly string[] {
    const actions: string[] = [];

    switch (reason) {
      case 'iteration_limit_exceeded':
        actions.push('Review iteration history and consider adjusting limits');
        actions.push('Manually resolve remaining findings');
        break;
      case 'quality_gate_failed':
        actions.push(`Address ${String(unresolved.length)} unresolved findings`);
        actions.push('Consider lowering quality thresholds if findings are acceptable');
        break;
      case 'unresolvable_conflict':
        actions.push('Review conflicting findings and make a judgment call');
        break;
      case 'human_requested':
        actions.push('Human intervention requested — review current state');
        break;
      case 'token_budget_exceeded':
        actions.push('Token budget exceeded — consider increasing budget or reducing scope');
        break;
      case 'retry_limit_exceeded':
        actions.push('Retry limit reached — review failures and consider manual intervention');
        break;
      case 'confidence_too_low':
        actions.push('Agent confidence below threshold — review output quality');
        break;
      default: {
        const _exhaustive: never = reason;
        throw new Error(`Unhandled: ${String(_exhaustive)}`);
      }
    }

    return actions;
  }
}
