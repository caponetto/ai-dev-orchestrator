import { OrchestratorError } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import {
  ActionExecutionError,
  GuardEvaluationError,
  InvalidStateError,
  MaxTransitionsExceededError,
  TransitionError,
  WorkflowDefinitionError,
  WorkflowTimeoutError,
} from '../errors';

describe('workflow engine errors', () => {
  it('WorkflowDefinitionError includes cause', () => {
    const error = new WorkflowDefinitionError('missing initial state');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('WORKFLOW_DEFINITION_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.cause).toBe('missing initial state');
    expect(error.message).toContain('missing initial state');
  });

  it('InvalidStateError includes stateId', () => {
    const error = new InvalidStateError('UNKNOWN_STATE');
    expect(error.code).toBe('INVALID_STATE');
    expect(error.stateId).toBe('UNKNOWN_STATE');
    expect(error.message).toContain('UNKNOWN_STATE');
  });

  it('TransitionError includes from, to, and cause', () => {
    const error = new TransitionError('INTAKE', 'DONE', 'guard failed');
    expect(error.code).toBe('TRANSITION_ERROR');
    expect(error.from).toBe('INTAKE');
    expect(error.to).toBe('DONE');
    expect(error.cause).toBe('guard failed');
    expect(error.message).toContain('INTAKE');
    expect(error.message).toContain('DONE');
  });

  it('GuardEvaluationError includes guardType and cause', () => {
    const error = new GuardEvaluationError('artifact_exists', 'store unavailable');
    expect(error.code).toBe('GUARD_EVALUATION_ERROR');
    expect(error.guardType).toBe('artifact_exists');
    expect(error.message).toContain('artifact_exists');
  });

  it('ActionExecutionError includes actionType and cause', () => {
    const error = new ActionExecutionError('dispatch_worker', 'provider timeout');
    expect(error.code).toBe('ACTION_EXECUTION_ERROR');
    expect(error.actionType).toBe('dispatch_worker');
    expect(error.message).toContain('dispatch_worker');
  });

  it('WorkflowTimeoutError includes stateId and timeoutMs', () => {
    const error = new WorkflowTimeoutError('WAITING_FOR_HUMAN', 30000);
    expect(error.code).toBe('WORKFLOW_TIMEOUT');
    expect(error.stateId).toBe('WAITING_FOR_HUMAN');
    expect(error.timeoutMs).toBe(30000);
    expect(error.message).toContain('30000');
  });

  it('MaxTransitionsExceededError includes count and limit', () => {
    const error = new MaxTransitionsExceededError(201, 200);
    expect(error.code).toBe('MAX_TRANSITIONS_EXCEEDED');
    expect(error.count).toBe(201);
    expect(error.limit).toBe(200);
    expect(error.message).toContain('201');
    expect(error.message).toContain('200');
  });

  it('all errors have correct name from constructor', () => {
    expect(new WorkflowDefinitionError('x').name).toBe('WorkflowDefinitionError');
    expect(new InvalidStateError('x').name).toBe('InvalidStateError');
    expect(new TransitionError('a', 'b', 'c').name).toBe('TransitionError');
    expect(new GuardEvaluationError('a', 'b').name).toBe('GuardEvaluationError');
    expect(new ActionExecutionError('a', 'b').name).toBe('ActionExecutionError');
    expect(new WorkflowTimeoutError('a', 1).name).toBe('WorkflowTimeoutError');
    expect(new MaxTransitionsExceededError(1, 2).name).toBe('MaxTransitionsExceededError');
  });
});
