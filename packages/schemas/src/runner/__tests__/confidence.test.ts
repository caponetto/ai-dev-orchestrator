import { describe, expect, it } from 'vitest';

import { confidenceReportSchema } from '../confidence';

describe('confidenceReportSchema', () => {
  it('accepts a valid confidence report', () => {
    const result = confidenceReportSchema.safeParse({
      score: 0.85,
      criteriaResults: [
        { criterionId: 'sc-1', met: true, evidence: 'Test passes with 200 status' },
      ],
      rationale: 'All success criteria met with high certainty',
    });
    expect(result.success).toBe(true);
  });

  it('rejects score below 0', () => {
    const result = confidenceReportSchema.safeParse({
      score: -0.1,
      criteriaResults: [],
      rationale: 'N/A',
    });
    expect(result.success).toBe(false);
  });

  it('rejects score above 1', () => {
    const result = confidenceReportSchema.safeParse({
      score: 1.1,
      criteriaResults: [],
      rationale: 'N/A',
    });
    expect(result.success).toBe(false);
  });

  it('accepts score at boundaries 0 and 1', () => {
    expect(
      confidenceReportSchema.safeParse({
        score: 0,
        criteriaResults: [],
        rationale: 'Zero confidence',
      }).success,
    ).toBe(true);
    expect(
      confidenceReportSchema.safeParse({
        score: 1,
        criteriaResults: [],
        rationale: 'Full confidence',
      }).success,
    ).toBe(true);
  });
});
