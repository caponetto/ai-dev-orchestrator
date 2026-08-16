import type { JournalWriter } from '@ai-orchestrator/ports';
import type { EscalationContext, EscalationReason } from '@ai-orchestrator/schemas';

/** Escalation state handler for workflow engine. */
export class EscalationHandler {
  private readonly journalWriter: JournalWriter;

  constructor(journalWriter: JournalWriter) {
    this.journalWriter = journalWriter;
  }

  /** Enter escalation state and record event. */
  enterEscalation(runId: string, fromState: string, context: EscalationContext): void {
    this.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId,
      sequence: 0,
      type: 'escalation',
      data: {
        kind: 'governance',
        outcome: 'escalated',
        reason: context.reason,
        transitionFrom: fromState,
        escalationReason: context.reason,
      },
    });
  }

  /** Resolve target state based on escalation reason. */
  resolveEscalationTarget(reason: EscalationReason): string {
    switch (reason) {
      case 'iteration_limit_exceeded':
      case 'quality_gate_failed':
      case 'unresolvable_conflict':
      case 'human_requested':
      case 'token_budget_exceeded':
      case 'retry_limit_exceeded':
      case 'confidence_too_low':
        return 'WAITING_FOR_HUMAN';
      default: {
        const _exhaustive: never = reason;
        return _exhaustive;
      }
    }
  }

  /** Check if state is escalation-related. */
  isEscalationState(stateId: string): boolean {
    return stateId === 'WAITING_FOR_HUMAN';
  }
}
