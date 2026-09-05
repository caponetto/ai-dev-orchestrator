import type { IterationContractRegistry } from '@ai-dev-orchestrator/ports';
import type { IterationContract, IterationState } from '@ai-dev-orchestrator/schemas';

import { BUILT_IN_CONTRACTS } from './built-in-contracts';

const STATE_TO_CONTRACT: Readonly<Record<string, string>> = {
  PLAN_REVIEW: 'plan_review_loop',
  CODE_REVIEW: 'implementation_review_loop',
  REVIEW_SYNTHESIS: 'implementation_review_loop',
  IMPLEMENTATION: 'implementation_review_loop',
  TEST_AUTHORING: 'implementation_review_loop',
  JUDGE_REVIEW: 'implementation_review_loop',
  REFINEMENT: 'clarification_loop',
  WAITING_FOR_HUMAN: 'clarification_loop',
  ACCEPTANCE_VALIDATION: 'acceptance_validation_loop',
};

const ROUND_ENTRY_STATES: ReadonlySet<string> = new Set([
  'PLAN_REVIEW',
  'CODE_REVIEW',
  'REFINEMENT',
  'ACCEPTANCE_VALIDATION',
]);
const JUDGE_ENTRY_STATES: ReadonlySet<string> = new Set(['JUDGE_REVIEW']);

/** Default registry of iteration contracts with built-in contracts pre-loaded. */
export class DefaultIterationContractRegistry implements IterationContractRegistry {
  private readonly contracts = new Map<string, IterationContract>();
  private readonly iterationCounts = new Map<string, number>();
  private readonly judgeArbitrationCounts = new Map<string, number>();
  private readonly findingStatuses = new Map<string, Map<string, 'open' | 'resolved'>>();

  constructor(additionalContracts: readonly IterationContract[] = []) {
    for (const contract of BUILT_IN_CONTRACTS) {
      this.contracts.set(contract.id, contract);
    }
    for (const contract of additionalContracts) {
      this.contracts.set(contract.id, contract);
    }
  }

  /** @inheritdoc */
  getContract(id: string): IterationContract | null {
    return this.contracts.get(id) ?? null;
  }

  /** @inheritdoc */
  listContracts(): readonly IterationContract[] {
    return [...this.contracts.values()];
  }

  /** @inheritdoc */
  getContractForState(stateId: string): IterationContract | null {
    const contractId = STATE_TO_CONTRACT[stateId];
    if (!contractId) {
      return null;
    }
    return this.contracts.get(contractId) ?? null;
  }

  /** Record that the FSM entered a state, incrementing the iteration count only for round-entry states. */
  recordStateEntry(stateId: string, _stateType?: string): void {
    const contract = this.getContractForState(stateId);
    if (!contract) {
      return;
    }

    if (JUDGE_ENTRY_STATES.has(stateId)) {
      const current = this.judgeArbitrationCounts.get(contract.id) ?? 0;
      this.judgeArbitrationCounts.set(contract.id, current + 1);
      return;
    }

    if (!ROUND_ENTRY_STATES.has(stateId)) {
      return;
    }
    const current = this.iterationCounts.get(contract.id) ?? 0;
    this.iterationCounts.set(contract.id, current + 1);
  }

  /** Restore iteration counts from persisted state (e.g. on resume). */
  restoreIterationCounts(counts: Map<string, number>): void {
    for (const [contractId, count] of counts) {
      this.iterationCounts.set(contractId, count);
    }
  }

  /** Restore judge arbitration counts from persisted state (e.g. on resume). */
  restoreJudgeArbitrationCounts(counts: ReadonlyMap<string, number>): void {
    for (const [contractId, count] of counts) {
      this.judgeArbitrationCounts.set(contractId, count);
    }
  }

  /** Reset iteration count for a specific contract (e.g. after human rejection restarts a loop). */
  resetIterationCount(contractId: string): void {
    this.iterationCounts.set(contractId, 0);
  }

  /** Record a finding being raised or resolved, scoped to a contract. */
  recordFinding(contractId: string, findingId: string, status: 'open' | 'resolved'): void {
    let findings = this.findingStatuses.get(contractId);
    if (!findings) {
      findings = new Map();
      this.findingStatuses.set(contractId, findings);
    }
    findings.set(findingId, status);
  }

  /** Get the current iteration counts for all contracts. */
  getIterationCounts(): ReadonlyMap<string, number> {
    return this.iterationCounts;
  }

  /** Get the current judge arbitration counts for all contracts. */
  getJudgeArbitrationCounts(): ReadonlyMap<string, number> {
    return this.judgeArbitrationCounts;
  }

  /** @inheritdoc */
  getIterationState(contractId: string): IterationState {
    const contract = this.contracts.get(contractId);
    const currentIteration = this.iterationCounts.get(contractId) ?? 0;
    const judgeArbitrations = this.judgeArbitrationCounts.get(contractId) ?? 0;

    let findingsTotal = 0;
    let findingsResolved = 0;
    const contractFindings = this.findingStatuses.get(contractId);
    if (contractFindings) {
      for (const status of contractFindings.values()) {
        findingsTotal++;
        if (status === 'resolved') {
          findingsResolved++;
        }
      }
    }
    const findingsOpen = findingsTotal - findingsResolved;

    if (!contract) {
      return {
        contractId,
        currentIteration,
        judgeArbitrations,
        producerArtifactVersions: [],
        reviewerArtifactVersions: [],
        findingsTotal,
        findingsResolved,
        findingsOpen,
        status: 'in_progress',
      };
    }

    const exceeded = currentIteration >= contract.maxIterations;
    const status = exceeded ? 'failed' : 'in_progress';

    return {
      contractId,
      currentIteration,
      judgeArbitrations,
      producerArtifactVersions: [],
      reviewerArtifactVersions: [],
      findingsTotal,
      findingsResolved,
      findingsOpen,
      status,
    };
  }
}
