import type { ManifestContext, RunManifest } from '@ai-dev-orchestrator/schemas';

/** Port for producing a run manifest at workflow completion. */
export interface ManifestProducer {
  /** Produce a run manifest from the given context. */
  produce(context: ManifestContext): RunManifest;
}
