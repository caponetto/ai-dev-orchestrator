import { describe, expect, it } from 'vitest';

import {
  artifactInputSchema,
  artifactInventorySchema,
  artifactMetadataSchema,
  artifactQuerySchema,
  artifactRefSchema,
  artifactSchema,
  artifactSummarySchema,
  artifactTypeSchema,
  integrityResultSchema,
} from '../artifact-system';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('artifactTypeSchema', () => {
  it('accepts valid artifact types', () => {
    expect(artifactTypeSchema.safeParse('plan').success).toBe(true);
    expect(artifactTypeSchema.safeParse('implementation').success).toBe(true);
    expect(artifactTypeSchema.safeParse('judge_decision').success).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(artifactTypeSchema.safeParse('unknown_type').success).toBe(false);
  });

  it('accepts task-breakdown artifact types', () => {
    expect(artifactTypeSchema.safeParse('task_breakdown').success).toBe(true);
    expect(artifactTypeSchema.safeParse('decomposition_review').success).toBe(true);
    expect(artifactTypeSchema.safeParse('task_specifications').success).toBe(true);
  });
});

describe('artifactRefSchema', () => {
  it('validates a complete ref', () => {
    expect(artifactRefSchema.safeParse(validRef).success).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(artifactRefSchema.safeParse({ type: 'plan' }).success).toBe(false);
    expect(artifactRefSchema.safeParse({}).success).toBe(false);
  });

  it('rejects invalid artifact type in ref', () => {
    expect(artifactRefSchema.safeParse({ ...validRef, type: 'bad' }).success).toBe(false);
  });
});

describe('artifactInputSchema', () => {
  it('validates a minimal input', () => {
    const data = { type: 'plan', name: 'plan', content: '# Plan', producedBy: 'architect' };
    expect(artifactInputSchema.safeParse(data).success).toBe(true);
  });

  it('validates with optional fields', () => {
    const data = {
      type: 'plan',
      name: 'plan',
      content: '# Plan',
      producedBy: 'architect',
      runId: 'r-1',
      predecessorRef: validRef,
      metadata: { validationFailed: true, extra: 42 },
      preValidated: false,
    };
    expect(artifactInputSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing content', () => {
    expect(
      artifactInputSchema.safeParse({ type: 'plan', name: 'p', producedBy: 'a' }).success,
    ).toBe(false);
  });
});

describe('artifactSchema', () => {
  it('validates a full artifact', () => {
    const data = {
      ref: validRef,
      type: 'plan',
      name: 'main-plan',
      version: 1,
      content: '# Content',
      checksum: 'sha256-abc',
      producedBy: 'architect',
      createdAt: '2026-01-01T00:00:00Z',
      sizeBytes: 1024,
    };
    expect(artifactSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(artifactSchema.safeParse({ ref: validRef }).success).toBe(false);
  });
});

describe('artifactQuerySchema', () => {
  it('validates an empty query (all optional)', () => {
    expect(artifactQuerySchema.safeParse({}).success).toBe(true);
  });

  it('validates with filters', () => {
    const data = { type: 'plan', producedBy: 'architect', minVersion: 1 };
    expect(artifactQuerySchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid type filter', () => {
    expect(artifactQuerySchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
});

describe('artifactSummarySchema', () => {
  it('validates a summary', () => {
    const data = {
      ref: validRef,
      type: 'plan',
      name: 'main-plan',
      version: 1,
      producedBy: 'architect',
      createdAt: '2026-01-01T00:00:00Z',
      sizeBytes: 512,
    };
    expect(artifactSummarySchema.safeParse(data).success).toBe(true);
  });
});

describe('artifactInventorySchema', () => {
  it('validates an inventory with artifacts', () => {
    const data = {
      runId: 'r-1',
      artifacts: [
        {
          ref: validRef,
          type: 'plan',
          name: 'main-plan',
          version: 1,
          producedBy: 'architect',
          createdAt: '2026-01-01T00:00:00Z',
          sizeBytes: 512,
        },
      ],
      totalCount: 1,
      totalSizeBytes: 512,
    };
    expect(artifactInventorySchema.safeParse(data).success).toBe(true);
  });

  it('validates an empty inventory', () => {
    const data = { runId: 'r-1', artifacts: [], totalCount: 0, totalSizeBytes: 0 };
    expect(artifactInventorySchema.safeParse(data).success).toBe(true);
  });
});

describe('integrityResultSchema', () => {
  it('validates a passing integrity check', () => {
    const data = {
      valid: true,
      expectedChecksum: 'sha256-abc',
      actualChecksum: 'sha256-abc',
      ref: validRef,
    };
    expect(integrityResultSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing ref', () => {
    expect(
      integrityResultSchema.safeParse({
        valid: false,
        expectedChecksum: 'a',
        actualChecksum: 'b',
      }).success,
    ).toBe(false);
  });
});

describe('artifactMetadataSchema', () => {
  it('validates metadata with nullable predecessorRef', () => {
    const data = {
      type: 'plan',
      name: 'main-plan',
      version: 1,
      checksum: 'sha256-abc',
      producedBy: 'architect',
      predecessorRef: null,
      createdAt: '2026-01-01T00:00:00Z',
      sizeBytes: 1024,
    };
    expect(artifactMetadataSchema.safeParse(data).success).toBe(true);
  });

  it('validates metadata with a predecessorRef', () => {
    const data = {
      type: 'plan',
      name: 'main-plan',
      version: 2,
      checksum: 'sha256-def',
      producedBy: 'architect',
      predecessorRef: validRef,
      createdAt: '2026-01-01T00:01:00Z',
      sizeBytes: 2048,
    };
    expect(artifactMetadataSchema.safeParse(data).success).toBe(true);
  });
});
