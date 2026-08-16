import { OrchestratorError } from '@ai-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { AgreementGateError, InvalidAgreementError } from '../errors';

describe('agreement artifact errors', () => {
  it('InvalidAgreementError includes agreementType and cause', () => {
    const error = new InvalidAgreementError('planning_agreement', 'no participants');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('INVALID_AGREEMENT');
    expect(error.recoverable).toBe(false);
    expect(error.agreementType).toBe('planning_agreement');
    expect(error.cause).toBe('no participants');
    expect(error.message).toContain('planning_agreement');
    expect(error.message).toContain('no participants');
  });

  it('AgreementGateError includes agreementType and cause', () => {
    const error = new AgreementGateError('implementation_agreement', 'not found');
    expect(error.code).toBe('AGREEMENT_GATE_ERROR');
    expect(error.agreementType).toBe('implementation_agreement');
    expect(error.cause).toBe('not found');
    expect(error.message).toContain('implementation_agreement');
  });

  it('all errors have correct name from constructor', () => {
    expect(new InvalidAgreementError('planning_agreement', 'x').name).toBe('InvalidAgreementError');
    expect(new AgreementGateError('planning_agreement', 'x').name).toBe('AgreementGateError');
  });
});
