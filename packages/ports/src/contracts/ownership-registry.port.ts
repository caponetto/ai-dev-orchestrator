import type { ArtifactType } from '@ai-dev-orchestrator/schemas';

/** Port for querying artifact ownership rules. */
export interface OwnershipRegistry {
  /** Get the owner role for an artifact type. Returns null for unregistered types. */
  getOwner(type: ArtifactType): string | null;

  /** Verify that a role is authorized to produce an artifact type. */
  isAuthorized(role: string, type: ArtifactType): boolean;

  /** Get all artifact types owned by a role. */
  getOwnedTypes(role: string): readonly ArtifactType[];
}
