import { NonRecoverableErrorBase } from '@ai-orchestrator/ports';

/** Thrown when a cycle is detected in the artifact dependency graph. */
export class DependencyGraphCycleError extends NonRecoverableErrorBase {
  readonly code = 'DEPENDENCY_GRAPH_CYCLE';

  constructor(readonly cyclePath: readonly string[]) {
    super(`Cycle detected in artifact dependency graph: ${cyclePath.join(' -> ')}`);
  }
}

/** Thrown when an artifact type is not found in the dependency graph. */
export class ArtifactTypeNotInGraphError extends NonRecoverableErrorBase {
  readonly code = 'ARTIFACT_TYPE_NOT_IN_GRAPH';

  constructor(readonly artifactType: string) {
    super(`Artifact type "${artifactType}" is not registered in the dependency graph`);
  }
}
