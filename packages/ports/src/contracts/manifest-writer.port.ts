import type { RunManifest } from '@ai-orchestrator/schemas';

/** Port for persisting a run manifest to durable storage. */
export interface ManifestWriter {
  /** Write the manifest for the given run. */
  write(runId: string, manifest: RunManifest): void;
}
