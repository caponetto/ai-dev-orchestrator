import { NonRecoverableErrorBase } from '@ai-orchestrator/ports';

/** Thrown when an iteration contract definition is invalid. */
export class InvalidContractError extends NonRecoverableErrorBase {
  readonly code = 'INVALID_CONTRACT';

  constructor(
    readonly contractId: string,
    readonly cause: string,
  ) {
    super(`Invalid iteration contract "${contractId}": ${cause}`);
  }
}

/** Thrown when a referenced contract does not exist. */
export class ContractNotFoundError extends NonRecoverableErrorBase {
  readonly code = 'CONTRACT_NOT_FOUND';

  constructor(readonly contractId: string) {
    super(`Iteration contract not found: "${contractId}"`);
  }
}

/** Thrown when contract state cannot be derived for a given FSM state. */
export class ContractStateMismatchError extends NonRecoverableErrorBase {
  readonly code = 'CONTRACT_STATE_MISMATCH';

  constructor(
    readonly contractId: string,
    readonly stateId: string,
  ) {
    super(`Contract "${contractId}" does not apply to state "${stateId}"`);
  }
}
