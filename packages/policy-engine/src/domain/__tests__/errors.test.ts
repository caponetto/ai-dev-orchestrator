import { OrchestratorError } from '@ai-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import {
  PolicyConfigurationError,
  PolicyEvaluationError,
  PolicyResolverError,
  UnknownPolicyTypeError,
} from '../errors';

describe('policy engine errors', () => {
  it('PolicyEvaluationError includes policyId and cause', () => {
    const error = new PolicyEvaluationError('pol-001', 'missing context');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('POLICY_EVALUATION_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.policyId).toBe('pol-001');
    expect(error.cause).toBe('missing context');
    expect(error.message).toContain('pol-001');
    expect(error.message).toContain('missing context');
  });

  it('PolicyConfigurationError includes policyId and cause', () => {
    const error = new PolicyConfigurationError('pol-002', 'invalid threshold');
    expect(error.code).toBe('POLICY_CONFIGURATION_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.policyId).toBe('pol-002');
    expect(error.cause).toBe('invalid threshold');
    expect(error.message).toContain('pol-002');
  });

  it('UnknownPolicyTypeError includes policyType', () => {
    const error = new UnknownPolicyTypeError('custom');
    expect(error.code).toBe('UNKNOWN_POLICY_TYPE');
    expect(error.recoverable).toBe(false);
    expect(error.policyType).toBe('custom');
    expect(error.message).toContain('custom');
  });

  it('PolicyResolverError includes cause', () => {
    const error = new PolicyResolverError('conflicting layers');
    expect(error.code).toBe('POLICY_RESOLVER_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.cause).toBe('conflicting layers');
    expect(error.message).toContain('conflicting layers');
  });

  it('all errors have correct name from constructor', () => {
    expect(new PolicyEvaluationError('a', 'b').name).toBe('PolicyEvaluationError');
    expect(new PolicyConfigurationError('a', 'b').name).toBe('PolicyConfigurationError');
    expect(new UnknownPolicyTypeError('custom').name).toBe('UnknownPolicyTypeError');
    expect(new PolicyResolverError('x').name).toBe('PolicyResolverError');
  });
});
