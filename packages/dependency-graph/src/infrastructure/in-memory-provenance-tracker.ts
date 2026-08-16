import type { ProvenanceTracker } from '@ai-orchestrator/ports';
import type { ArtifactRef, ProvenanceNode, ProvenanceRecord } from '@ai-orchestrator/schemas';

/** In-memory implementation of provenance tracker. */
export class InMemoryProvenanceTracker implements ProvenanceTracker {
  private readonly records: ProvenanceRecord[] = [];

  /** @inheritdoc */
  recordDerivation(output: ArtifactRef, inputs: readonly ArtifactRef[], workerId: string): void {
    this.records.push({
      output,
      inputs: [...inputs],
      recordedAt: new Date().toISOString(),
      workerId,
    });
  }

  /** @inheritdoc */
  getInputs(ref: ArtifactRef): readonly ArtifactRef[] {
    const record = this.findRecord(ref);
    return record ? record.inputs : [];
  }

  /** @inheritdoc */
  getOutputs(ref: ArtifactRef): readonly ArtifactRef[] {
    const results: ArtifactRef[] = [];
    for (const record of this.records) {
      if (record.inputs.some((i) => this.refsEqual(i, ref))) {
        results.push(record.output);
      }
    }
    return results;
  }

  /** @inheritdoc */
  getProvenanceChain(ref: ArtifactRef): ProvenanceNode {
    return this.buildChain(ref, new Set<string>());
  }

  /** @inheritdoc */
  allRecords(): readonly ProvenanceRecord[] {
    return [...this.records];
  }

  /** @inheritdoc */
  clear(): void {
    this.records.length = 0;
  }

  private findRecord(ref: ArtifactRef): ProvenanceRecord | undefined {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const record = this.records[i];
      if (this.refsEqual(record.output, ref)) {
        return record;
      }
    }
    return undefined;
  }

  private buildChain(ref: ArtifactRef, visited: Set<string>): ProvenanceNode {
    const key = this.refKey(ref);
    if (visited.has(key)) {
      return { artifact: ref, inputs: [] };
    }
    visited.add(key);

    const record = this.findRecord(ref);
    if (!record) {
      return { artifact: ref, inputs: [] };
    }

    const inputNodes = record.inputs.map((input) => this.buildChain(input, visited));
    return { artifact: ref, inputs: inputNodes };
  }

  private refsEqual(a: ArtifactRef, b: ArtifactRef): boolean {
    return a.type === b.type && a.name === b.name && a.version === b.version;
  }

  private refKey(ref: ArtifactRef): string {
    return `${ref.type}:${ref.name}:${String(ref.version)}`;
  }
}
