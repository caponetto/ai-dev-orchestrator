import type { ArtifactRef, ProvenanceNode, ProvenanceRecord } from '@ai-orchestrator/schemas';

/** Port for recording and querying artifact provenance (derivation relationships). */
export interface ProvenanceTracker {
  /** Record that an output artifact was derived from specific input artifacts. */
  recordDerivation(output: ArtifactRef, inputs: readonly ArtifactRef[], workerId: string): void;

  /** Get the input artifacts that a given artifact was derived from. */
  getInputs(ref: ArtifactRef): readonly ArtifactRef[];

  /** Get all artifacts that were derived from a given artifact. */
  getOutputs(ref: ArtifactRef): readonly ArtifactRef[];

  /** Get the full provenance chain (all ancestors, recursively). */
  getProvenanceChain(ref: ArtifactRef): ProvenanceNode;

  /** Get all provenance records for the current run. */
  allRecords(): readonly ProvenanceRecord[];

  /** Clear all provenance records. */
  clear(): void;
}
