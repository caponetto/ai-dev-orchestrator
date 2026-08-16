import type { ActionResult } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { extractConfidenceReport } from '../confidence-extractor';

describe('extractConfidenceReport', () => {
  it('returns null when no dispatch_worker results have confidence', () => {
    const results = [
      {
        action: { type: 'dispatch_worker', params: { role: 'implementer' } },
        success: true,
      },
    ] as unknown as ActionResult[];
    expect(extractConfidenceReport(results)).toBeNull();
  });

  it('returns null for empty results', () => {
    expect(extractConfidenceReport([])).toBeNull();
  });

  it('extracts confidence from dispatch_worker action result', () => {
    const results = [
      {
        action: { type: 'dispatch_worker', params: { role: 'implementer' } },
        success: true,
        confidenceReport: {
          score: 0.75,
          criteriaResults: [{ criterionId: 'sc-1', met: true, evidence: 'Tests pass' }],
          rationale: 'Mostly confident',
        },
      },
    ] as unknown as ActionResult[];
    const report = extractConfidenceReport(results);
    expect(report).not.toBeNull();
    expect(report?.score).toBe(0.75);
  });

  it('returns the first confidence report when multiple workers report', () => {
    const results = [
      {
        action: { type: 'dispatch_worker', params: { role: 'implementer' } },
        success: true,
        confidenceReport: {
          score: 0.6,
          criteriaResults: [],
          rationale: 'First worker',
        },
      },
      {
        action: { type: 'dispatch_worker', params: { role: 'reviewer' } },
        success: true,
        confidenceReport: {
          score: 0.9,
          criteriaResults: [],
          rationale: 'Second worker',
        },
      },
    ] as unknown as ActionResult[];
    const report = extractConfidenceReport(results);
    expect(report?.score).toBe(0.6);
  });

  it('ignores non-dispatch_worker actions with confidence', () => {
    const results = [
      {
        action: { type: 'run_script', params: {} },
        success: true,
        confidenceReport: {
          score: 0.5,
          criteriaResults: [],
          rationale: 'Script result',
        },
      },
    ] as unknown as ActionResult[];
    expect(extractConfidenceReport(results)).toBeNull();
  });
});
