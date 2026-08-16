import type { JournalWriter } from '@ai-orchestrator/ports';
import type { GovernanceDecision, GovernanceEventData } from '@ai-orchestrator/schemas';

/** Records governance decisions for audit trail. */
export class DecisionRecorder {
  private readonly decisions: GovernanceDecision[] = [];
  private readonly journalWriter: JournalWriter | null;

  constructor(journalWriter?: JournalWriter) {
    this.journalWriter = journalWriter ?? null;
  }

  /** Record a governance decision. */
  record(decision: GovernanceDecision): void {
    this.decisions.push(decision);

    if (this.journalWriter) {
      const data: GovernanceEventData = {
        kind: 'governance',
        outcome: decision.outcome,
        reason: decision.reason,
        transitionFrom: decision.transitionRequested.from,
        transitionTo: decision.transitionRequested.to,
        policiesEvaluated: decision.policiesEvaluated.length,
      };

      this.journalWriter.append({
        timestamp: decision.timestamp,
        runId: decision.runId,
        sequence: 0,
        type: 'governance_decision',
        data,
      });
    }
  }

  /** Get all recorded decisions. */
  getDecisions(): readonly GovernanceDecision[] {
    return [...this.decisions];
  }

  /** Get decisions for a specific run. */
  getDecisionsForRun(runId: string): readonly GovernanceDecision[] {
    return this.decisions.filter((d) => d.runId === runId);
  }
}
