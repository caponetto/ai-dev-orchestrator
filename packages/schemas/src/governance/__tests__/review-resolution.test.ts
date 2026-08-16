import { describe, expect, it } from 'vitest';

import {
  aggregatedFindingsSchema,
  correlatedFindingSchema,
  correlatedFindingsSchema,
  findingBlockingSchema,
  findingCategorySchema,
  findingLocationSchema,
  findingResolutionSchema,
  findingSchema,
  findingStatusSchema,
} from '../review-resolution';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('findingBlockingSchema', () => {
  it.each(['must_fix', 'should_fix', 'nit'])('accepts "%s"', (val) => {
    expect(findingBlockingSchema.safeParse(val).success).toBe(true);
  });

  it('rejects invalid value', () => {
    expect(findingBlockingSchema.safeParse('optional').success).toBe(false);
  });
});

describe('findingCategorySchema', () => {
  it('accepts valid categories', () => {
    expect(findingCategorySchema.safeParse('correctness').success).toBe(true);
    expect(findingCategorySchema.safeParse('security').success).toBe(true);
    expect(findingCategorySchema.safeParse('other').success).toBe(true);
  });
});

describe('findingStatusSchema', () => {
  it.each(['open', 'addressed', 'accepted', 'rejected', 'escalated'])('accepts "%s"', (val) => {
    expect(findingStatusSchema.safeParse(val).success).toBe(true);
  });
});

describe('findingLocationSchema', () => {
  it('validates with only artifactRef', () => {
    expect(findingLocationSchema.safeParse({ artifactRef: validRef }).success).toBe(true);
  });

  it('validates with all optional fields', () => {
    const data = {
      artifactRef: validRef,
      section: 'imports',
      line: 42,
      snippet: 'import { foo } from "bar"',
    };
    expect(findingLocationSchema.safeParse(data).success).toBe(true);
  });
});

describe('findingResolutionSchema', () => {
  it('validates a resolution', () => {
    const data = {
      status: 'addressed',
      resolvedBy: 'implementer',
      rationale: 'Fixed the issue',
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(findingResolutionSchema.safeParse(data).success).toBe(true);
  });

  it('validates with resolvedInArtifact', () => {
    const data = {
      status: 'accepted',
      resolvedInArtifact: validRef,
      resolvedBy: 'reviewer',
      rationale: 'Acceptable risk',
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(findingResolutionSchema.safeParse(data).success).toBe(true);
  });
});

describe('findingSchema', () => {
  it('validates a minimal finding', () => {
    const data = {
      id: 'f-1',
      severity: 'high',
      blocking: 'must_fix',
      category: 'security',
      title: 'SQL Injection',
      description: 'User input not sanitized',
      status: 'open',
    };
    expect(findingSchema.safeParse(data).success).toBe(true);
  });

  it('validates a finding with all optional fields', () => {
    const data = {
      id: 'f-2',
      severity: 'low',
      blocking: 'nit',
      category: 'style',
      title: 'Naming convention',
      description: 'Variable name too short',
      location: { artifactRef: validRef, line: 10 },
      suggestedFix: 'Rename variable',
      status: 'addressed',
      resolution: {
        status: 'addressed',
        resolvedBy: 'implementer',
        rationale: 'Renamed',
        timestamp: '2026-01-01T00:00:00Z',
      },
      supersedes: 'f-1',
    };
    expect(findingSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid blocking level', () => {
    const data = {
      id: 'f-3',
      severity: 'high',
      blocking: 'critical',
      category: 'security',
      title: 'T',
      description: 'D',
      status: 'open',
    };
    expect(findingSchema.safeParse(data).success).toBe(false);
  });
});

describe('aggregatedFindingsSchema', () => {
  it('validates aggregated findings', () => {
    const finding = {
      id: 'f-1',
      severity: 'high',
      blocking: 'must_fix',
      category: 'security',
      title: 'Issue',
      description: 'Desc',
      status: 'open',
    };
    const data = {
      total: 1,
      bySeverity: { high: 1 },
      byStatus: { open: 1 },
      byCategory: { security: 1 },
      blocking: [finding],
      nonBlocking: [],
    };
    expect(aggregatedFindingsSchema.safeParse(data).success).toBe(true);
  });
});

describe('correlatedFindingSchema', () => {
  it('validates a correlated finding', () => {
    const finding = {
      id: 'f-1',
      severity: 'high',
      blocking: 'must_fix',
      category: 'security',
      title: 'Issue',
      description: 'Desc',
      status: 'open',
    };
    const data = { finding, producedIn: validRef };
    expect(correlatedFindingSchema.safeParse(data).success).toBe(true);
  });
});

describe('correlatedFindingsSchema', () => {
  it('validates correlated findings with resolution rate', () => {
    const data = { findings: [], resolutionRate: 0.85 };
    expect(correlatedFindingsSchema.safeParse(data).success).toBe(true);
  });
});
