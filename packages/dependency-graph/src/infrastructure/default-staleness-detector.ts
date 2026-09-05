import type {
  ArtifactStore,
  DependencyGraph,
  ProvenanceTracker,
  StalenessDetector,
} from '@ai-dev-orchestrator/ports';
import type {
  ArtifactRef,
  StaleArtifact,
  StaleInput,
  StaleSet,
  StalenessResult,
} from '@ai-dev-orchestrator/schemas';

/** Default implementation of staleness detector with propagation and clearing support. */
export class DefaultStalenessDetector implements StalenessDetector {
  private readonly cleared = new Map<string, string>();

  constructor(
    private readonly graph: DependencyGraph,
    private readonly provenance: ProvenanceTracker,
    private readonly artifactStore: ArtifactStore,
  ) {}

  /** @inheritdoc */
  computeStaleSet(newArtifact: ArtifactRef): StaleSet {
    this.latestCache.clear();
    const staleArtifacts: StaleArtifact[] = [];
    const visited = new Set<string>();

    this.propagateStaleness(newArtifact, 0, staleArtifacts, visited);

    const rebuildTypes = this.graph
      .topologicalOrder()
      .filter((type) => staleArtifacts.some((sa) => sa.artifact.type === type));

    return {
      trigger: newArtifact,
      staleArtifacts,
      rebuildOrder: rebuildTypes,
    };
  }

  /** @inheritdoc */
  isStale(ref: ArtifactRef): StalenessResult {
    const key = this.refKey(ref);
    if (this.cleared.has(key)) {
      return {
        stale: false,
        staleInputs: [],
        clearedManually: true,
        clearReason: this.cleared.get(key),
      };
    }

    const staleInputs = this.findStaleInputs(ref);
    return {
      stale: staleInputs.length > 0,
      staleInputs,
      clearedManually: false,
    };
  }

  /** @inheritdoc */
  allStale(): readonly StaleArtifact[] {
    this.latestCache.clear();
    const result: StaleArtifact[] = [];
    const records = this.provenance.allRecords();

    for (const record of records) {
      const key = this.refKey(record.output);
      if (this.cleared.has(key)) {
        continue;
      }

      const staleInputs = this.findStaleInputs(record.output);
      if (staleInputs.length > 0) {
        result.push({
          artifact: record.output,
          staleInputs,
          depth: 0,
        });
      }
    }

    return result;
  }

  /** @inheritdoc */
  clearStale(ref: ArtifactRef, reason: string): void {
    this.cleared.set(this.refKey(ref), reason);
  }

  private propagateStaleness(
    changedArtifact: ArtifactRef,
    depth: number,
    result: StaleArtifact[],
    visited: Set<string>,
  ): void {
    const dependents = this.graph.getDependents(changedArtifact.type);

    for (const depType of dependents) {
      const outputs = this.provenance.getOutputs(changedArtifact);
      for (const output of outputs) {
        if (output.type !== depType) {
          continue;
        }

        const outputKey = this.refKey(output);
        if (visited.has(outputKey)) {
          continue;
        }
        if (this.cleared.has(outputKey)) {
          continue;
        }
        visited.add(outputKey);

        const staleInputs = this.findStaleInputs(output);
        if (staleInputs.length > 0) {
          result.push({
            artifact: output,
            staleInputs,
            depth: depth + 1,
          });
          this.propagateStaleness(output, depth + 1, result, visited);
        }
      }
    }
  }

  private findStaleInputs(ref: ArtifactRef): readonly StaleInput[] {
    const inputs = this.provenance.getInputs(ref);
    const staleInputs: StaleInput[] = [];

    for (const input of inputs) {
      const latest = this.getLatestSync(input);
      if (latest && latest.version > input.version) {
        staleInputs.push({ currentInput: input, latestAvailable: latest });
      }
    }

    return staleInputs;
  }

  /**
   * Synchronous latest-version lookup. The ArtifactStore port is async,
   * but staleness detection runs in-process against an in-memory store
   * during orchestration. We cache the call result at construction boundary.
   * For production async stores, wrap this class with an async facade.
   */
  private latestCache = new Map<string, ArtifactRef | null>();

  private getLatestSync(ref: ArtifactRef): ArtifactRef | null {
    const cacheKey = `${ref.type}:${ref.name}`;
    if (this.latestCache.has(cacheKey)) {
      return this.latestCache.get(cacheKey) ?? null;
    }

    let result: ArtifactRef | null = null;
    const records = this.provenance.allRecords();
    for (const record of records) {
      if (record.output.type === ref.type && record.output.name === ref.name) {
        if (!result || record.output.version > result.version) {
          result = record.output;
        }
      }
    }

    // Also check outputs that were inputs to other things
    for (const record of records) {
      for (const input of record.inputs) {
        if (input.type === ref.type && input.name === ref.name) {
          if (!result || input.version > result.version) {
            result = input;
          }
        }
      }
    }

    this.latestCache.set(cacheKey, result);
    return result;
  }

  private refKey(ref: ArtifactRef): string {
    return `${ref.type}:${ref.name}:${String(ref.version)}`;
  }
}
