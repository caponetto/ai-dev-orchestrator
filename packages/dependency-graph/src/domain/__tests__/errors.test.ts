import { describe, expect, it } from 'vitest';

import { ArtifactTypeNotInGraphError, DependencyGraphCycleError } from '../errors';

describe('Artifact Dependency Graph Errors', () => {
  it('creates DependencyGraphCycleError with cycle path', () => {
    const error = new DependencyGraphCycleError(['plan', 'test_plan', 'plan']);
    expect(error.code).toBe('DEPENDENCY_GRAPH_CYCLE');
    expect(error.cyclePath).toEqual(['plan', 'test_plan', 'plan']);
    expect(error.message).toContain('plan -> test_plan -> plan');
    expect(error.recoverable).toBe(false);
  });

  it('creates ArtifactTypeNotInGraphError with type', () => {
    const error = new ArtifactTypeNotInGraphError('unknown_type');
    expect(error.code).toBe('ARTIFACT_TYPE_NOT_IN_GRAPH');
    expect(error.artifactType).toBe('unknown_type');
    expect(error.message).toContain('unknown_type');
  });
});
