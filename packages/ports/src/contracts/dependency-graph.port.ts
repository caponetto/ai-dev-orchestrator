import type { ArtifactType, DependencyGraphValidation } from '@ai-dev-orchestrator/schemas';

/** Port for querying the static artifact type dependency graph. */
export interface DependencyGraph {
  /** Get the direct dependencies of an artifact type. */
  getDependencies(type: ArtifactType): readonly ArtifactType[];

  /** Get the artifact types that directly depend on a given type. */
  getDependents(type: ArtifactType): readonly ArtifactType[];

  /** Get all transitive dependencies (all ancestors). */
  getTransitiveDependencies(type: ArtifactType): readonly ArtifactType[];

  /** Get all transitive dependents (all descendants). */
  getTransitiveDependents(type: ArtifactType): readonly ArtifactType[];

  /** Validate the graph: no cycles, all types connected, all types present. */
  validate(): DependencyGraphValidation;

  /** Generate a topological ordering of all artifact types. */
  topologicalOrder(): readonly ArtifactType[];

  /** Get the workflow state that produces a given artifact type. */
  getProducingState(type: ArtifactType): string | undefined;
}
