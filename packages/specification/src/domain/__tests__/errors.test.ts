import { OrchestratorError } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import {
  SpecificationMergeConflictError,
  SpecificationSchemaError,
  SpecificationSemanticError,
  SpecificationVersionChainError,
} from '../errors';

describe('canonical specification errors', () => {
  it('SpecificationSchemaError includes field and violations', () => {
    const violations = [
      { path: '/title', message: 'is required' },
      { path: '/version', message: 'must be number' },
    ];
    const error = new SpecificationSchemaError('title', violations);
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('SPEC_SCHEMA_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.field).toBe('title');
    expect(error.violations).toBe(violations);
    expect(error.message).toContain('/title: is required');
    expect(error.message).toContain('/version: must be number');
  });

  it('SpecificationSemanticError includes field and detail', () => {
    const error = new SpecificationSemanticError(
      'acceptanceCriteria',
      'AC-1 references non-existent requirement FR-99',
    );
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('SPEC_SEMANTIC_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.field).toBe('acceptanceCriteria');
    expect(error.detail).toBe('AC-1 references non-existent requirement FR-99');
    expect(error.message).toContain('acceptanceCriteria');
    expect(error.message).toContain('AC-1 references non-existent requirement FR-99');
  });

  it('SpecificationMergeConflictError includes conflicts', () => {
    const conflicts = [
      {
        field: 'title',
        values: [
          { source: 'jira', value: 'Title A' },
          { source: 'github', value: 'Title B' },
        ],
        resolution: 'flagged' as const,
      },
    ];
    const error = new SpecificationMergeConflictError(conflicts);
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('SPEC_MERGE_CONFLICT');
    expect(error.recoverable).toBe(false);
    expect(error.conflicts).toBe(conflicts);
    expect(error.message).toContain('1 unresolvable conflict');
    expect(error.message).toContain('title');
  });

  it('SpecificationVersionChainError includes specId and missingVersion', () => {
    const error = new SpecificationVersionChainError('spec-abc', 'v2');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('SPEC_VERSION_CHAIN_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.specId).toBe('spec-abc');
    expect(error.missingVersion).toBe('v2');
    expect(error.message).toContain('spec-abc');
    expect(error.message).toContain('v2');
  });

  it('all errors have correct name from constructor', () => {
    expect(new SpecificationSchemaError('f', []).name).toBe('SpecificationSchemaError');
    expect(new SpecificationSemanticError('f', 'd').name).toBe('SpecificationSemanticError');
    expect(new SpecificationMergeConflictError([]).name).toBe('SpecificationMergeConflictError');
    expect(new SpecificationVersionChainError('s', 'v').name).toBe(
      'SpecificationVersionChainError',
    );
  });
});
