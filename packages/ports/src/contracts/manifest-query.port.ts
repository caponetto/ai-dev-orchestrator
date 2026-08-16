import type { RunManifest } from '@ai-orchestrator/schemas';

/** Filter criteria for listing run manifests. */
export interface ManifestFilter {
  readonly status?: string;
  readonly repository?: string;
  readonly after?: string;
  readonly before?: string;
}

/** Port for querying persisted run manifests. */
export interface ManifestQuery {
  /** List all run manifests, optionally filtered. */
  list(filter?: ManifestFilter): readonly RunManifest[];

  /** Get a specific run manifest by runId. */
  get(runId: string): RunManifest | null;
}
