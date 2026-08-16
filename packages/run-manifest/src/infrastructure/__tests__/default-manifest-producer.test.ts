import type { ManifestContext } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { DefaultManifestProducer } from '../default-manifest-producer';

function makeContext(overrides: Partial<ManifestContext> = {}): ManifestContext {
  return {
    runId: 'run-002',
    config: {
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:01:00Z',
      governanceDecisions: 0,
      escalations: 0,
      iterations: [],
      stateTimestamps: [],
    },
    stateHistory: ['INTAKE', 'DONE'],
    artifactInventory: [],
    journalPath: '/tmp/journal.md',
    workerMetrics: {},
    ...overrides,
  };
}

describe('DefaultManifestProducer', () => {
  it('produces a manifest with correct runId', () => {
    const producer = new DefaultManifestProducer();
    const manifest = producer.produce(makeContext());
    expect(manifest.runId).toBe('run-002');
  });

  it('produces a manifest with completed status', () => {
    const producer = new DefaultManifestProducer();
    const manifest = producer.produce(makeContext());
    expect(manifest.status).toBe('completed');
    expect(manifest.finalState).toBe('DONE');
  });

  it('produces a manifest with aborted status', () => {
    const producer = new DefaultManifestProducer();
    const manifest = producer.produce(
      makeContext({
        stateHistory: ['INTAKE', 'ABORTED'],
      }),
    );
    expect(manifest.status).toBe('aborted');
  });

  it('includes timing and token usage', () => {
    const producer = new DefaultManifestProducer();
    const manifest = producer.produce(makeContext());
    expect(manifest.timing).toBeDefined();
    expect(manifest.tokenUsage).toBeDefined();
    expect(manifest.tokenUsage.totalTokens).toBe(0);
  });
});
