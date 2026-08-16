import { describe, expect, it } from 'vitest';

import {
  dependencyEdgeSchema,
  dependencyGraphValidationSchema,
  provenanceNodeSchema,
  provenanceRecordSchema,
  rebuildEstimateSchema,
  rebuildPlanSchema,
  staleArtifactSchema,
  staleInputSchema,
  staleSetSchema,
  stalenessResultSchema,
} from '../artifact-dependency-graph';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('dependencyGraphValidationSchema', () => {
  it('validates a passing result', () => {
    const data = { valid: true, errors: [], warnings: [] };
    expect(dependencyGraphValidationSchema.safeParse(data).success).toBe(true);
  });

  it('validates with messages', () => {
    const data = { valid: false, errors: ['Cycle detected'], warnings: ['Slow rebuild'] };
    expect(dependencyGraphValidationSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing valid field', () => {
    expect(dependencyGraphValidationSchema.safeParse({ errors: [], warnings: [] }).success).toBe(
      false,
    );
  });
});

describe('provenanceRecordSchema', () => {
  it('validates a provenance record', () => {
    const data = {
      output: validRef,
      inputs: [validRef],
      recordedAt: '2026-01-01T00:00:00Z',
      workerId: 'w-1',
    };
    expect(provenanceRecordSchema.safeParse(data).success).toBe(true);
  });

  it('validates with empty inputs', () => {
    const data = {
      output: validRef,
      inputs: [],
      recordedAt: '2026-01-01T00:00:00Z',
      workerId: 'w-1',
    };
    expect(provenanceRecordSchema.safeParse(data).success).toBe(true);
  });
});

describe('provenanceNodeSchema', () => {
  it('validates a leaf node', () => {
    const data = { artifact: validRef, inputs: [] };
    expect(provenanceNodeSchema.safeParse(data).success).toBe(true);
  });

  it('validates a nested node tree', () => {
    const data = {
      artifact: validRef,
      inputs: [{ artifact: validRef, inputs: [] }],
    };
    expect(provenanceNodeSchema.safeParse(data).success).toBe(true);
  });
});

describe('staleInputSchema', () => {
  it('validates a stale input pair', () => {
    const latestRef = { ...validRef, version: 2, checksum: 'sha256-def' };
    const data = { currentInput: validRef, latestAvailable: latestRef };
    expect(staleInputSchema.safeParse(data).success).toBe(true);
  });
});

describe('staleArtifactSchema', () => {
  it('validates a stale artifact', () => {
    const data = {
      artifact: validRef,
      staleInputs: [{ currentInput: validRef, latestAvailable: validRef }],
      depth: 2,
    };
    expect(staleArtifactSchema.safeParse(data).success).toBe(true);
  });
});

describe('staleSetSchema', () => {
  it('validates a stale set', () => {
    const data = {
      trigger: validRef,
      staleArtifacts: [],
      rebuildOrder: ['plan', 'implementation'],
    };
    expect(staleSetSchema.safeParse(data).success).toBe(true);
  });
});

describe('stalenessResultSchema', () => {
  it('validates a non-stale result', () => {
    const data = { stale: false, staleInputs: [], clearedManually: false };
    expect(stalenessResultSchema.safeParse(data).success).toBe(true);
  });

  it('validates a manually cleared result', () => {
    const data = {
      stale: false,
      staleInputs: [],
      clearedManually: true,
      clearReason: 'User override',
    };
    expect(stalenessResultSchema.safeParse(data).success).toBe(true);
  });
});

describe('rebuildPlanSchema', () => {
  it('validates a rebuild plan', () => {
    const data = {
      statesToReenter: ['IMPLEMENTATION', 'CODE_REVIEW'],
      artifactsToRebuild: ['implementation', 'static_review'],
      artifactsPreserved: ['plan'],
      requiresGovernanceApproval: true,
    };
    expect(rebuildPlanSchema.safeParse(data).success).toBe(true);
  });
});

describe('rebuildEstimateSchema', () => {
  it('validates a rebuild estimate', () => {
    const data = {
      stateCount: 3,
      estimatedWorkerInvocations: 5,
      estimatedTokens: { input: 10000, output: 5000 },
      estimatedDurationMs: 120000,
    };
    expect(rebuildEstimateSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing nested token fields', () => {
    const data = {
      stateCount: 3,
      estimatedWorkerInvocations: 5,
      estimatedTokens: { input: 10000 },
      estimatedDurationMs: 120000,
    };
    expect(rebuildEstimateSchema.safeParse(data).success).toBe(false);
  });
});

describe('dependencyEdgeSchema', () => {
  it('validates an edge', () => {
    const data = {
      type: 'implementation',
      dependsOn: ['plan', 'canonical_specification'],
      producedInState: 'IMPLEMENTATION',
    };
    expect(dependencyEdgeSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid artifact type', () => {
    const data = { type: 'nope', dependsOn: [], producedInState: 'X' };
    expect(dependencyEdgeSchema.safeParse(data).success).toBe(false);
  });
});
