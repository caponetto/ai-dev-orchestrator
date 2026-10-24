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
  private readonly publishedVersions = new Map<string, ArtifactRef>();

  constructor(
    private readonly graph: DependencyGraph,
    private readonly provenance: ProvenanceTracker,
    private readonly artifactStore: ArtifactStore,
  ) {}

  /** @inheritdoc */
  computeStaleSet(newArtifact: ArtifactRef): StaleSet {
    this.latestCache.clear();
    const publishedKey = `${newArtifact.type}:${newArtifact.name}`;
    const previous = this.publishedVersions.get(publishedKey);
    if (!previous || newArtifact.version > previous.version) {
      this.publishedVersions.set(publishedKey, newArtifact);
    }
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
    this.latestCache.clear();
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
      const outputs = this.provenance
        .allRecords()
        .filter((record) =>
          record.inputs.some(
            (input) =>
              input.type === changedArtifact.type &&
              input.name === changedArtifact.name &&
              input.version <= changedArtifact.version,
          ),
        )
        .map((record) => record.output);
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

  private findStaleInputs(
    ref: ArtifactRef,
    visited: ReadonlySet<string> = new Set(),
  ): readonly StaleInput[] {
    const key = this.refKey(ref);
    if (visited.has(key) || this.cleared.has(key)) {
      return [];
    }
    const path = new Set(visited).add(key);
    const inputs = this.provenance.getInputs(ref);
    const staleInputs: StaleInput[] = [];

    for (const input of inputs) {
      const latest = this.getLatestSync(input);
      if (
        (latest && latest.version > input.version) ||
        this.findStaleInputs(input, path).length > 0
      ) {
        staleInputs.push({ currentInput: input, latestAvailable: latest ?? input });
      }
    }

    return staleInputs;
  }

  /** Latest versions come from announced writes and recorded provenance, not async storage. */
  private latestCache = new Map<string, ArtifactRef | null>();

  private getLatestSync(ref: ArtifactRef): ArtifactRef | null {
    const cacheKey = `${ref.type}:${ref.name}`;
    if (this.latestCache.has(cacheKey)) {
      return this.latestCache.get(cacheKey) ?? null;
    }

    let result: ArtifactRef | null = this.publishedVersions.get(cacheKey) ?? null;
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
