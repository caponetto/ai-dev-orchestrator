import type { RunManifest } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { renderReport } from '../report-renderer';

function makeManifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    runId: 'run-001',
    version: '1.0.0',
    repository: '',
    workflow: { name: 'default', version: '1.0.0' },
    timing: {
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:01:00.000Z',
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
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      byRole: {},
    },
    ...overrides,
  };
}

describe('renderReport', () => {
  it('renders a report with header, timing, and token usage', () => {
    const report = renderReport(makeManifest());
    expect(report).toContain('# Run Report: run-001');
    expect(report).toContain('**Workflow:** default v1.0.0');
    expect(report).toContain('**Status:** completed');
    expect(report).toContain('## Timing');
    expect(report).toContain('## Token Usage');
    expect(report).toContain('## Summary');
  });

  it('includes abort reason when present', () => {
    const report = renderReport(
      makeManifest({
        status: 'aborted',
        finalState: 'ABORTED',
        abortReason: 'Budget exceeded',
      }),
    );
    expect(report).toContain('**Abort Reason:** Budget exceeded');
  });

  it('renders workflow trace from stateTrace with per-visit rows', () => {
    const report = renderReport(
      makeManifest({
        timing: {
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:01:00.000Z',
          totalDurationMs: 60000,
          stateTimings: [],
          stateTrace: [
            {
              stateId: 'REVIEW',
              enteredAt: '2025-01-01T00:00:00.000Z',
              exitedAt: '2025-01-01T00:00:10.000Z',
              durationMs: 10000,
            },
            {
              stateId: 'FIX',
              enteredAt: '2025-01-01T00:00:10.000Z',
              exitedAt: '2025-01-01T00:00:20.000Z',
              durationMs: 10000,
            },
            {
              stateId: 'REVIEW',
              enteredAt: '2025-01-01T00:00:20.000Z',
              exitedAt: '2025-01-01T00:00:40.000Z',
              durationMs: 20000,
            },
          ],
        },
      }),
    );
    expect(report).toContain('## Workflow Trace');
    expect(report).toContain('| 1 | REVIEW |');
    expect(report).toContain('| 2 | FIX |');
    expect(report).toContain('| 3 | REVIEW |');
    expect(report).toContain('Exited At');
  });

  it('falls back to stateTimings for workflow trace when stateTrace is absent', () => {
    const report = renderReport(
      makeManifest({
        timing: {
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:01:00.000Z',
          totalDurationMs: 60000,
          stateTimings: [
            {
              stateId: 'PLANNING',
              enteredAt: '2025-01-01T00:00:00.000Z',
              exitedAt: '2025-01-01T00:00:20.000Z',
              durationMs: 20000,
              visits: 1,
            },
            {
              stateId: 'IMPLEMENTATION',
              enteredAt: '2025-01-01T00:00:20.000Z',
              exitedAt: '2025-01-01T00:01:00.000Z',
              durationMs: 40000,
              visits: 1,
            },
          ],
        },
      }),
    );
    expect(report).toContain('## Workflow Trace');
    expect(report).toContain('| 1 | PLANNING |');
    expect(report).toContain('| 2 | IMPLEMENTATION |');
    expect(report).toContain('Visits');
  });

  it('renders findings section when iterations have findings', () => {
    const report = renderReport(
      makeManifest({
        iterations: [
          {
            contractId: 'review-impl',
            totalIterations: 2,
            judgeArbitrations: 0,
            finalStatus: 'converged',
            findingsTotal: 5,
            findingsResolved: 3,
          },
          {
            contractId: 'review-security',
            totalIterations: 1,
            judgeArbitrations: 0,
            finalStatus: 'converged',
            findingsTotal: 2,
            findingsResolved: 2,
          },
        ],
      }),
    );
    expect(report).toContain('## Findings');
    expect(report).toContain('**Total Findings:** 7');
    expect(report).toContain('**Resolved:** 5');
    expect(report).toContain('**Unresolved:** 2');
    expect(report).toContain('| review-impl | 5 | 3 |');
    expect(report).toContain('| review-security | 2 | 2 |');
  });

  it('omits findings section when no findings exist', () => {
    const report = renderReport(
      makeManifest({
        iterations: [
          {
            contractId: 'review-impl',
            totalIterations: 1,
            judgeArbitrations: 0,
            finalStatus: 'converged',
            findingsTotal: 0,
            findingsResolved: 0,
          },
        ],
      }),
    );
    expect(report).not.toContain('## Findings');
  });

  it('renders artifacts section when artifactInventory has entries', () => {
    const report = renderReport(
      makeManifest({
        artifactInventory: [
          {
            ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
            producedBy: 'planner',
            createdAt: '2025-01-01T00:00:10.000Z',
            sizeBytes: 2048,
          },
          {
            ref: { type: 'implementation', name: 'impl', version: 1, checksum: 'def' },
            producedBy: 'developer',
            createdAt: '2025-01-01T00:00:30.000Z',
            sizeBytes: 10240,
          },
        ],
        totalArtifacts: 2,
      }),
    );
    expect(report).toContain('## Artifacts');
    expect(report).toContain('| plan | plan | planner |');
    expect(report).toContain('| implementation | impl | developer |');
    expect(report).toContain('2.0 KB');
    expect(report).toContain('10.0 KB');
  });

  it('omits artifacts section when inventory is empty', () => {
    const report = renderReport(makeManifest());
    expect(report).not.toContain('## Artifacts');
  });

  it('renders roles table when activeRoles are present', () => {
    const report = renderReport(
      makeManifest({
        activeRoles: [
          {
            role: 'developer',
            dispatches: 3,
            inputTokens: 100,
            outputTokens: 50,
            totalDurationMs: 1200,
            artifactsProduced: 2,
          },
        ],
      }),
    );
    expect(report).toContain('## Roles');
    expect(report).toContain('| developer |');
  });
});
