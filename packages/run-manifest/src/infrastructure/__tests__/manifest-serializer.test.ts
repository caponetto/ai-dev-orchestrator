import type { RunManifest } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { serializeManifest } from '../manifest-serializer';

function makeManifest(): RunManifest {
  return {
    runId: 'run-001',
    version: '1.0.0',
    repository: '',
    workflow: { name: 'default', version: '1.0.0' },
    timing: {
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
      totalDurationMs: 60000,
      stateTimings: [],
    },
    status: 'completed',
    finalState: 'DONE',
    activeRoles: [],
    artifactInventory: [],
    totalArtifacts: 0,
    totalArtifactSizeBytes: 0,
    iterations: [],
    governanceDecisions: 0,
    escalations: 0,
    humanInterventions: 0,
    agreements: [],
    tokenUsage: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      byRole: {},
    },
  };
}

describe('serializeManifest', () => {
  it('serializes manifest to YAML string', () => {
    const yaml = serializeManifest(makeManifest());
    expect(yaml).toContain('runId: run-001');
    expect(yaml).toContain('status: completed');
  });

  it('includes workflow info', () => {
    const yaml = serializeManifest(makeManifest());
    expect(yaml).toContain('name: default');
    expect(yaml).toContain('version: 1.0.0');
  });

  it('includes timing info', () => {
    const yaml = serializeManifest(makeManifest());
    expect(yaml).toContain('totalDurationMs: 60000');
  });

  it('returns valid YAML', () => {
    const yaml = serializeManifest(makeManifest());
    expect(typeof yaml).toBe('string');
    expect(yaml.length).toBeGreaterThan(0);
  });
});
