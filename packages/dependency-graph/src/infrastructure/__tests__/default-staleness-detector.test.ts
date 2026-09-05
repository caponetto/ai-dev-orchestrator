import type { ArtifactRef } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { DefaultDependencyGraph } from '../default-dependency-graph';
import { DefaultStalenessDetector } from '../default-staleness-detector';
import { InMemoryProvenanceTracker } from '../in-memory-provenance-tracker';

function ref(type: string, name: string, version: number): ArtifactRef {
  return {
    type: type as ArtifactRef['type'],
    name,
    version,
    checksum: `sha-${type}-${String(version)}`,
  };
}

function makeDetector() {
  const graph = new DefaultDependencyGraph();
  const provenance = new InMemoryProvenanceTracker();
  const artifactStore = {} as never;
  const detector = new DefaultStalenessDetector(graph, provenance, artifactStore);
  return { graph, provenance, detector };
}

describe('DefaultStalenessDetector', () => {
  it('reports artifact as not stale when inputs are current', () => {
    const { provenance, detector } = makeDetector();
    const spec = ref('canonical_specification', 'spec', 1);
    const plan = ref('plan', 'plan', 1);

    provenance.recordDerivation(plan, [spec], 'w1');

    const result = detector.isStale(plan);
    expect(result.stale).toBe(false);
    expect(result.staleInputs).toHaveLength(0);
  });

  it('reports artifact as stale when input has newer version', () => {
    const { provenance, detector } = makeDetector();
    const specV1 = ref('canonical_specification', 'spec', 1);
    const specV2 = ref('canonical_specification', 'spec', 2);
    const plan = ref('plan', 'plan', 1);

    provenance.recordDerivation(plan, [specV1], 'w1');
    provenance.recordDerivation(ref('clarification_questions', 'q', 1), [specV2], 'w2');

    const result = detector.isStale(plan);
    expect(result.stale).toBe(true);
    expect(result.staleInputs).toHaveLength(1);
    expect(result.staleInputs[0]).toBeDefined();
    expect(result.staleInputs[0]?.currentInput.version).toBe(1);
    expect(result.staleInputs[0]?.latestAvailable.version).toBe(2);
  });

  it('clearStale marks artifact as not stale', () => {
    const { provenance, detector } = makeDetector();
    const specV1 = ref('canonical_specification', 'spec', 1);
    const specV2 = ref('canonical_specification', 'spec', 2);
    const plan = ref('plan', 'plan', 1);

    provenance.recordDerivation(plan, [specV1], 'w1');
    provenance.recordDerivation(ref('clarification_questions', 'q', 1), [specV2], 'w2');

    detector.clearStale(plan, 'manually verified');

    const result = detector.isStale(plan);
    expect(result.stale).toBe(false);
    expect(result.clearedManually).toBe(true);
    expect(result.clearReason).toBe('manually verified');
  });

  it('allStale returns all stale artifacts', () => {
    const { provenance, detector } = makeDetector();
    const specV1 = ref('canonical_specification', 'spec', 1);
    const specV2 = ref('canonical_specification', 'spec', 2);
    const plan = ref('plan', 'plan', 1);

    provenance.recordDerivation(plan, [specV1], 'w1');
    provenance.recordDerivation(ref('clarification_questions', 'q', 1), [specV2], 'w2');

    const stale = detector.allStale();
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale.some((s) => s.artifact.type === 'plan')).toBe(true);
  });

  it('allStale excludes manually cleared artifacts', () => {
    const { provenance, detector } = makeDetector();
    const specV1 = ref('canonical_specification', 'spec', 1);
    const specV2 = ref('canonical_specification', 'spec', 2);
    const plan = ref('plan', 'plan', 1);

    provenance.recordDerivation(plan, [specV1], 'w1');
    provenance.recordDerivation(ref('clarification_questions', 'q', 1), [specV2], 'w2');

    detector.clearStale(plan, 'ok');

    const stale = detector.allStale();
    expect(stale.some((s) => s.artifact.type === 'plan')).toBe(false);
  });

  it('computeStaleSet returns stale artifacts with rebuild order', () => {
    const { provenance, detector } = makeDetector();
    const specV1 = ref('canonical_specification', 'spec', 1);
    const plan = ref('plan', 'plan', 1);
    const specV2 = ref('canonical_specification', 'spec', 2);

    provenance.recordDerivation(plan, [specV1], 'w1');

    const staleSet = detector.computeStaleSet(specV2);
    expect(staleSet.trigger).toBe(specV2);
    expect(staleSet.rebuildOrder).toBeDefined();
  });

  it('invalidates cache between computeStaleSet calls', () => {
    const { provenance, detector } = makeDetector();
    const specV1 = ref('canonical_specification', 'spec', 1);
    const plan = ref('plan', 'plan', 1);

    provenance.recordDerivation(plan, [specV1], 'w1');

    const result1 = detector.isStale(plan);
    expect(result1.stale).toBe(false);

    const specV2 = ref('canonical_specification', 'spec', 2);
    provenance.recordDerivation(ref('clarification_questions', 'q', 1), [specV2], 'w2');

    detector.computeStaleSet(specV2);

    const result2 = detector.isStale(plan);
    expect(result2.stale).toBe(true);
  });
});
