import { describe, expect, it } from 'vitest';

import { WorkflowParseError, WorkflowValidationFailedError } from '../errors';

describe('WorkflowParseError', () => {
  it('has correct code and source', () => {
    const error = new WorkflowParseError('workflow.yaml', 'Missing required field "name"');
    expect(error.code).toBe('WORKFLOW_PARSE_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.source).toBe('workflow.yaml');
    expect(error.message).toContain('Missing required field "name"');
  });
});

describe('WorkflowValidationFailedError', () => {
  it('has correct code and error count', () => {
    const error = new WorkflowValidationFailedError('default', 3);
    expect(error.code).toBe('WORKFLOW_VALIDATION_FAILED');
    expect(error.recoverable).toBe(false);
    expect(error.workflowName).toBe('default');
    expect(error.errorCount).toBe(3);
    expect(error.message).toContain('3 error(s)');
  });
});
