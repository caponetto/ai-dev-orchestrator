import { OrchestratorError } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { EscalationError, GovernanceError, PolicyLoadError } from '../errors';

describe('governance errors', () => {
  it('GovernanceError includes cause', () => {
    const error = new GovernanceError('policy evaluation timeout');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('GOVERNANCE_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.cause).toBe('policy evaluation timeout');
    expect(error.message).toContain('policy evaluation timeout');
  });

  it('PolicyLoadError includes cause', () => {
    const error = new PolicyLoadError('file not found');
    expect(error.code).toBe('POLICY_LOAD_ERROR');
    expect(error.cause).toBe('file not found');
    expect(error.message).toContain('file not found');
  });

  it('EscalationError includes stageId and cause', () => {
    const error = new EscalationError('PLAN_REVIEW', 'no resolution path');
    expect(error.code).toBe('ESCALATION_ERROR');
    expect(error.stageId).toBe('PLAN_REVIEW');
    expect(error.cause).toBe('no resolution path');
    expect(error.message).toContain('PLAN_REVIEW');
  });

  it('all errors have correct name from constructor', () => {
    expect(new GovernanceError('x').name).toBe('GovernanceError');
    expect(new PolicyLoadError('x').name).toBe('PolicyLoadError');
    expect(new EscalationError('a', 'b').name).toBe('EscalationError');
  });
});
