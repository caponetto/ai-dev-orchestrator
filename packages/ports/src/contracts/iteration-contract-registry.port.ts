import type { IterationContract, IterationState } from '@ai-orchestrator/schemas';

/** Port for managing iteration contracts and deriving iteration state. */
export interface IterationContractRegistry {
  /** Get an iteration contract by ID. Returns null if not found. */
  getContract(id: string): IterationContract | null;

  /** List all registered iteration contracts. */
  listContracts(): readonly IterationContract[];

  /** Get the iteration contract that applies to a given FSM state. Returns null if none applies. */
  getContractForState(stateId: string): IterationContract | null;

  /** Derive the current iteration state for a contract. */
  getIterationState(contractId: string): IterationState;

  /** Record that the FSM entered a state, incrementing the iteration count for the associated contract. */
  recordStateEntry(stateId: string, stateType?: string): void;

  /** Restore iteration counts from persisted state (e.g. on resume). */
  restoreIterationCounts(counts: ReadonlyMap<string, number>): void;

  /** Restore judge arbitration counts from persisted state (e.g. on resume). */
  restoreJudgeArbitrationCounts(counts: ReadonlyMap<string, number>): void;

  /** Reset iteration count for a specific contract (e.g. after human rejection restarts a loop). */
  resetIterationCount(contractId: string): void;
}
