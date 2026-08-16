import type {
  ArtifactRef,
  StaleArtifact,
  StaleSet,
  StalenessResult,
} from '@ai-orchestrator/schemas';

/** Port for detecting and managing artifact staleness. */
export interface StalenessDetector {
  /** Compute the set of downstream artifacts made stale by a new artifact version. */
  computeStaleSet(newArtifact: ArtifactRef): StaleSet;

  /** Check whether a specific artifact is stale. */
  isStale(ref: ArtifactRef): StalenessResult;

  /** Get all stale artifacts in the current run. */
  allStale(): readonly StaleArtifact[];

  /** Mark an artifact as explicitly not-stale with a reason. */
  clearStale(ref: ArtifactRef, reason: string): void;
}
