import type {
  ArtifactFlowDefinition,
  ArtifactType,
  RoleId,
  RoleInteraction,
  VisibilityCheck,
} from '@ai-dev-orchestrator/schemas';

/** Port for querying role interactions, artifact flows, and visibility rules. */
export interface CollaborationModel {
  /** Get all interactions for a given role (as producer or consumer). */
  getInteractions(roleId: RoleId): readonly RoleInteraction[];

  /** Get artifact flow definitions for all owned artifact types. */
  getFlowDefinitions(): readonly ArtifactFlowDefinition[];

  /** Check whether a role may access an artifact type. */
  checkVisibility(roleId: RoleId, artifactType: ArtifactType): VisibilityCheck;

  /** Get the role that produces a given artifact type. */
  getProducerFor(artifactType: ArtifactType): string | null;

  /** Get all roles that consume a given artifact type. */
  getConsumersFor(artifactType: ArtifactType): readonly string[];

  /** Get the roles that review a given role's output. */
  getReviewersFor(roleId: RoleId): readonly string[];
}
