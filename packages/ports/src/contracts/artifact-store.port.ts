import type {
  Artifact,
  ArtifactInput,
  ArtifactInventory,
  ArtifactQuery,
  ArtifactRef,
  ArtifactType,
  IntegrityResult,
} from '@ai-dev-orchestrator/schemas';

/** Port for storing, retrieving, and managing artifacts. */
export interface ArtifactStore {
  /** Store a new artifact version. Rejects ownership violations, immutability violations, and type validation failures. */
  store(artifact: ArtifactInput): Promise<ArtifactRef>;

  /** Retrieve an artifact by exact reference. */
  get(ref: ArtifactRef): Promise<Artifact>;

  /** Retrieve the latest version of an artifact by type and name. Returns null if none exist. */
  getLatest(type: ArtifactType, name: string): Promise<Artifact | null>;

  /** List all artifacts matching a query. */
  list(query: ArtifactQuery): Promise<readonly ArtifactRef[]>;

  /** Get the full version history for an artifact name, sorted by version. */
  history(type: ArtifactType, name: string): Promise<readonly ArtifactRef[]>;

  /** Verify the integrity of a stored artifact against its checksum. */
  verify(ref: ArtifactRef): Promise<IntegrityResult>;

  /** Get the complete artifact inventory for the current run. */
  inventory(): Promise<ArtifactInventory>;
}
