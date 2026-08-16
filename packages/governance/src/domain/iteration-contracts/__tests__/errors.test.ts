import { OrchestratorError } from '@ai-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { ContractNotFoundError, ContractStateMismatchError, InvalidContractError } from '../errors';

describe('iteration contract errors', () => {
  it('InvalidContractError includes contractId and cause', () => {
    const error = new InvalidContractError('plan_review_loop', 'missing producer');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('INVALID_CONTRACT');
    expect(error.recoverable).toBe(false);
    expect(error.contractId).toBe('plan_review_loop');
    expect(error.cause).toBe('missing producer');
    expect(error.message).toContain('plan_review_loop');
  });

  it('ContractNotFoundError includes contractId', () => {
    const error = new ContractNotFoundError('nonexistent');
    expect(error.code).toBe('CONTRACT_NOT_FOUND');
    expect(error.contractId).toBe('nonexistent');
    expect(error.message).toContain('nonexistent');
  });

  it('ContractStateMismatchError includes contractId and stateId', () => {
    const error = new ContractStateMismatchError('plan_review_loop', 'INTAKE');
    expect(error.code).toBe('CONTRACT_STATE_MISMATCH');
    expect(error.contractId).toBe('plan_review_loop');
    expect(error.stateId).toBe('INTAKE');
    expect(error.message).toContain('plan_review_loop');
    expect(error.message).toContain('INTAKE');
  });

  it('all errors have correct name from constructor', () => {
    expect(new InvalidContractError('a', 'b').name).toBe('InvalidContractError');
    expect(new ContractNotFoundError('a').name).toBe('ContractNotFoundError');
    expect(new ContractStateMismatchError('a', 'b').name).toBe('ContractStateMismatchError');
  });
});
