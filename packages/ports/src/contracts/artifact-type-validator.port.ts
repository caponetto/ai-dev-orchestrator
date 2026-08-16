import type { ArtifactType } from '@ai-orchestrator/schemas';

/** Result of validating artifact content against its type schema. */
export interface ArtifactValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
}

/** Port for validating artifact content against type-specific schemas. */
export interface ArtifactTypeValidator {
  /** Validate that artifact content conforms to its type schema. */
  validate(type: ArtifactType, content: string): ArtifactValidationResult;

  /** Get the schema for an artifact type. Returns null for types without schemas. */
  getSchema(type: ArtifactType): unknown;
}
