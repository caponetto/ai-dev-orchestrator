import type { ArtifactRef } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { InMemoryProvenanceTracker } from '../in-memory-provenance-tracker';

function ref(type: string, name: string, version: number): ArtifactRef {
  return {
    type: type as ArtifactRef['type'],
    name,
    version,
    checksum: `sha-${type}-${String(version)}`,
  };
}

describe('InMemoryProvenanceTracker', () => {
  it('records and retrieves derivation inputs', () => {
    const tracker = new InMemoryProvenanceTracker();
    const spec = ref('canonical_specification', 'spec', 1);
    const plan = ref('plan', 'plan', 1);

    tracker.recordDerivation(plan, [spec], 'worker-001');

    const inputs = tracker.getInputs(plan);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ type: 'canonical_specification' });
  });

  it('returns empty inputs for unknown artifact', () => {
    const tracker = new InMemoryProvenanceTracker();
    expect(tracker.getInputs(ref('plan', 'plan', 1))).toHaveLength(0);
  });

  it('retrieves outputs derived from an input', () => {
    const tracker = new InMemoryProvenanceTracker();
    const spec = ref('canonical_specification', 'spec', 1);
    const plan = ref('plan', 'plan', 1);
    const questions = ref('clarification_questions', 'questions', 1);

    tracker.recordDerivation(plan, [spec], 'worker-001');
    tracker.recordDerivation(questions, [spec], 'worker-002');

    const outputs = tracker.getOutputs(spec);
    expect(outputs).toHaveLength(2);
    expect(outputs.map((o) => o.type)).toContain('plan');
    expect(outputs.map((o) => o.type)).toContain('clarification_questions');
  });

  it('builds provenance chain', () => {
    const tracker = new InMemoryProvenanceTracker();
    const spec = ref('canonical_specification', 'spec', 1);
    const plan = ref('plan', 'plan', 1);
    const impl = ref('implementation', 'impl', 1);

    tracker.recordDerivation(plan, [spec], 'worker-001');
    tracker.recordDerivation(impl, [plan], 'worker-002');

    const chain = tracker.getProvenanceChain(impl);
    expect(chain.artifact.type).toBe('implementation');
    expect(chain.inputs).toHaveLength(1);
    expect(chain.inputs[0]).toMatchObject({ artifact: { type: 'plan' } });
    expect(chain.inputs[0]?.inputs).toHaveLength(1);
    expect(chain.inputs[0]?.inputs[0]).toMatchObject({
      artifact: { type: 'canonical_specification' },
    });
  });

  it('handles diamond dependencies in provenance chain', () => {
    const tracker = new InMemoryProvenanceTracker();
    const spec = ref('canonical_specification', 'spec', 1);
    const plan = ref('plan', 'plan', 1);
    const testPlan = ref('test_plan', 'tests', 1);
    const impl = ref('implementation', 'impl', 1);

    tracker.recordDerivation(plan, [spec], 'w1');
    tracker.recordDerivation(testPlan, [plan], 'w2');
    tracker.recordDerivation(impl, [plan, testPlan], 'w3');

    const chain = tracker.getProvenanceChain(impl);
    expect(chain.inputs).toHaveLength(2);
  });

  it('returns all records', () => {
    const tracker = new InMemoryProvenanceTracker();
    const spec = ref('canonical_specification', 'spec', 1);
    const plan = ref('plan', 'plan', 1);

    tracker.recordDerivation(plan, [spec], 'worker-001');

    const records = tracker.allRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ output: { type: 'plan' }, workerId: 'worker-001' });
    expect(records[0]?.recordedAt).toBeTruthy();
  });

  it('clears all records', () => {
    const tracker = new InMemoryProvenanceTracker();
    tracker.recordDerivation(
      ref('plan', 'plan', 1),
      [ref('canonical_specification', 'spec', 1)],
      'w1',
    );

    tracker.clear();

    expect(tracker.allRecords()).toHaveLength(0);
    expect(tracker.getInputs(ref('plan', 'plan', 1))).toHaveLength(0);
  });

  it('records include timestamp and worker id', () => {
    const tracker = new InMemoryProvenanceTracker();
    const before = new Date().toISOString();
    tracker.recordDerivation(ref('plan', 'plan', 1), [], 'worker-042');
    const after = new Date().toISOString();

    const records = tracker.allRecords();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.workerId).toBe('worker-042');
    expect(record.recordedAt).toBeTruthy();
    expect(record.recordedAt >= before).toBe(true);
    expect(record.recordedAt <= after).toBe(true);
  });
});
