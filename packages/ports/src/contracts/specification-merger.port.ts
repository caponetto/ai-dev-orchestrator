import type {
  CanonicalSpecification,
  MergeResult,
  MergeStrategy,
} from '@ai-dev-orchestrator/schemas';

/** Port for merging multiple canonical specifications into one using a given strategy. */
export interface SpecificationMerger {
  merge(specs: readonly CanonicalSpecification[], strategy: MergeStrategy): MergeResult;
}
