import type { ManifestContext, ManifestContextConfig } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { assembleManifest } from '../manifest-assembler';

const DEFAULT_CONFIG: ManifestContextConfig = {
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:01:00Z',
  governanceDecisions: 0,
  escalations: 0,
  iterations: [],
  stateTimestamps: [],
};

interface ContextOverrides extends Omit<Partial<ManifestContext>, 'config'> {
  config?: Partial<ManifestContextConfig>;
}

function makeContext(overrides: ContextOverrides = {}): ManifestContext {
  const { config: configOverrides, ...rest } = overrides;
  return {
    runId: 'run-001',
    config: { ...DEFAULT_CONFIG, ...configOverrides },
    stateHistory: ['INTAKE', 'REFINEMENT', 'PLANNING', 'DONE'],
    artifactInventory: [],
    journalPath: '/tmp/journal.md',
    workerMetrics: {},
    ...rest,
  };
}

describe('assembleManifest', () => {
  it('assembles a manifest with correct runId', () => {
    const manifest = assembleManifest(makeContext());
    expect(manifest.runId).toBe('run-001');
  });

  it('sets status to completed when final state is DONE', () => {
    const manifest = assembleManifest(makeContext());
    expect(manifest.status).toBe('completed');
    expect(manifest.finalState).toBe('DONE');
  });

  it('sets status to aborted when final state is ABORTED', () => {
    const manifest = assembleManifest(
      makeContext({
        stateHistory: ['INTAKE', 'ABORTED'],
      }),
    );
    expect(manifest.status).toBe('aborted');
    expect(manifest.finalState).toBe('ABORTED');
  });

  it('sets status to interrupted for non-terminal final states', () => {
    const manifest = assembleManifest(
      makeContext({
        stateHistory: ['INTAKE', 'WAITING_FOR_HUMAN'],
      }),
    );
    expect(manifest.status).toBe('interrupted');
  });

  it('includes version and defaults workflow to "unknown" when not specified', () => {
    const manifest = assembleManifest(makeContext());
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.workflow.name).toBe('unknown');
    expect(manifest.workflow.version).toBe('1.0.0');
  });

  it('uses workflowName and workflowVersion from context when provided', () => {
    const manifest = assembleManifest(
      makeContext({
        workflowName: 'pr-review',
        workflowVersion: '2.0.0',
      }),
    );
    expect(manifest.workflow.name).toBe('pr-review');
    expect(manifest.workflow.version).toBe('2.0.0');
  });

  it('counts artifact inventory', () => {
    const manifest = assembleManifest(
      makeContext({
        artifactInventory: [
          { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
          { type: 'implementation', name: 'impl', version: 1, checksum: 'def' },
        ],
      }),
    );
    expect(manifest.totalArtifacts).toBe(2);
  });

  it('uses artifactSummaries verbatim when provided', () => {
    const summaries = [
      {
        ref: { type: 'plan' as const, name: 'plan', version: 1, checksum: 'abc' },
        producedBy: 'planner',
        createdAt: '2025-06-01T10:00:00.000Z',
        sizeBytes: 2048,
      },
      {
        ref: { type: 'implementation' as const, name: 'impl', version: 1, checksum: 'def' },
        producedBy: 'developer',
        createdAt: '2025-06-01T10:05:00.000Z',
        sizeBytes: 8192,
      },
    ];
    const manifest = assembleManifest(
      makeContext({
        artifactInventory: summaries.map((s) => s.ref),
        artifactSummaries: summaries,
      }),
    );
    expect(manifest.artifactInventory).toHaveLength(2);
    expect(manifest.artifactInventory[0].producedBy).toBe('planner');
    expect(manifest.artifactInventory[0].createdAt).toBe('2025-06-01T10:00:00.000Z');
    expect(manifest.artifactInventory[0].sizeBytes).toBe(2048);
    expect(manifest.artifactInventory[1].producedBy).toBe('developer');
    expect(manifest.artifactInventory[1].sizeBytes).toBe(8192);
  });

  it('falls back to buildArtifactInventory when artifactSummaries is absent', () => {
    const manifest = assembleManifest(
      makeContext({
        artifactInventory: [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
      }),
    );
    expect(manifest.artifactInventory).toHaveLength(1);
    expect(manifest.totalArtifacts).toBe(1);
  });

  it('handles empty state history', () => {
    const manifest = assembleManifest(makeContext({ stateHistory: [] }));
    expect(manifest.finalState).toBe('UNKNOWN');
    expect(manifest.status).toBe('interrupted');
  });

  // -------------------------------------------------------------------
  // Timing from config.stateTimestamps
  // -------------------------------------------------------------------
  describe('timing from config.stateTimestamps', () => {
    it('computes timing and per-state durations from stateTimestamps', () => {
      const manifest = assembleManifest(
        makeContext({
          config: {
            stateTimestamps: [
              {
                stateId: 'INTAKE',
                enteredAt: '2025-01-01T00:00:00.000Z',
                exitedAt: '2025-01-01T00:00:10.000Z',
              },
              {
                stateId: 'PLANNING',
                enteredAt: '2025-01-01T00:00:10.000Z',
                exitedAt: '2025-01-01T00:00:30.000Z',
              },
              {
                stateId: 'DONE',
                enteredAt: '2025-01-01T00:00:30.000Z',
                exitedAt: '2025-01-01T00:00:35.000Z',
              },
            ],
          },
        }),
      );

      expect(manifest.timing.startedAt).toBe('2025-01-01T00:00:00.000Z');
      expect(manifest.timing.completedAt).toBe('2025-01-01T00:00:35.000Z');
      expect(manifest.timing.totalDurationMs).toBe(35_000);
      expect(manifest.timing.stateTimings).toHaveLength(3);
      expect(manifest.timing.stateTimings[0]).toEqual({
        stateId: 'INTAKE',
        enteredAt: '2025-01-01T00:00:00.000Z',
        exitedAt: '2025-01-01T00:00:10.000Z',
        durationMs: 10_000,
        visits: 1,
      });
    });

    it('builds stateTrace preserving per-visit order for repeated states', () => {
      const manifest = assembleManifest(
        makeContext({
          config: {
            stateTimestamps: [
              {
                stateId: 'REVIEW',
                enteredAt: '2025-01-01T00:00:00.000Z',
                exitedAt: '2025-01-01T00:00:05.000Z',
              },
              {
                stateId: 'FIX',
                enteredAt: '2025-01-01T00:00:05.000Z',
                exitedAt: '2025-01-01T00:00:10.000Z',
              },
              {
                stateId: 'REVIEW',
                enteredAt: '2025-01-01T00:00:10.000Z',
                exitedAt: '2025-01-01T00:00:18.000Z',
              },
            ],
          },
        }),
      );

      expect(manifest.timing.stateTrace).toHaveLength(3);
      expect(manifest.timing.stateTrace?.[0].stateId).toBe('REVIEW');
      expect(manifest.timing.stateTrace?.[0].durationMs).toBe(5_000);
      expect(manifest.timing.stateTrace?.[1].stateId).toBe('FIX');
      expect(manifest.timing.stateTrace?.[1].durationMs).toBe(5_000);
      expect(manifest.timing.stateTrace?.[2].stateId).toBe('REVIEW');
      expect(manifest.timing.stateTrace?.[2].durationMs).toBe(8_000);
    });

    it('aggregates visits for repeated states', () => {
      const manifest = assembleManifest(
        makeContext({
          config: {
            stateTimestamps: [
              {
                stateId: 'REVIEW',
                enteredAt: '2025-01-01T00:00:00.000Z',
                exitedAt: '2025-01-01T00:00:05.000Z',
              },
              {
                stateId: 'FIX',
                enteredAt: '2025-01-01T00:00:05.000Z',
                exitedAt: '2025-01-01T00:00:10.000Z',
              },
              {
                stateId: 'REVIEW',
                enteredAt: '2025-01-01T00:00:10.000Z',
                exitedAt: '2025-01-01T00:00:18.000Z',
              },
            ],
          },
        }),
      );

      const reviewTiming = manifest.timing.stateTimings.find((s) => s.stateId === 'REVIEW');
      expect(reviewTiming).toBeDefined();
      if (reviewTiming) {
        expect(reviewTiming.visits).toBe(2);
        expect(reviewTiming.durationMs).toBe(13_000); // 5000 + 8000
      }
    });

    it('handles single-entry stateTimestamps', () => {
      const manifest = assembleManifest(
        makeContext({
          config: {
            stateTimestamps: [
              {
                stateId: 'INTAKE',
                enteredAt: '2025-01-01T00:00:00.000Z',
                exitedAt: '2025-01-01T00:00:05.000Z',
              },
            ],
          },
        }),
      );

      expect(manifest.timing.stateTimings).toHaveLength(1);
      expect(manifest.timing.stateTimings[0].stateId).toBe('INTAKE');
    });
  });

  // -------------------------------------------------------------------
  // Timing from config.startedAt / config.completedAt
  // -------------------------------------------------------------------
  describe('timing from config.startedAt/completedAt', () => {
    it('computes total duration from startedAt and completedAt', () => {
      const manifest = assembleManifest(
        makeContext({
          config: {
            startedAt: '2025-06-01T10:00:00.000Z',
            completedAt: '2025-06-01T10:05:00.000Z',
          },
        }),
      );

      expect(manifest.timing.startedAt).toBe('2025-06-01T10:00:00.000Z');
      expect(manifest.timing.completedAt).toBe('2025-06-01T10:05:00.000Z');
      expect(manifest.timing.totalDurationMs).toBe(300_000);
      expect(manifest.timing.stateTimings).toEqual([]);
    });

    it('uses default config timestamps when stateTimestamps is empty', () => {
      const manifest = assembleManifest(
        makeContext({
          config: {
            startedAt: '2026-01-01T00:00:00Z',
            completedAt: '2026-01-01T00:01:00Z',
            stateTimestamps: [],
          },
        }),
      );

      expect(manifest.timing.startedAt).toBe('2026-01-01T00:00:00Z');
      expect(manifest.timing.completedAt).toBe('2026-01-01T00:01:00Z');
      expect(manifest.timing.totalDurationMs).toBe(60_000);
    });
  });

  // -------------------------------------------------------------------
  // Token usage from workerMetrics
  // -------------------------------------------------------------------
  describe('token usage from workerMetrics', () => {
    it('sums token usage across roles', () => {
      const manifest = assembleManifest(
        makeContext({
          workerMetrics: {
            developer: {
              inputTokens: 100,
              outputTokens: 50,
              dispatches: 2,
              durationMs: 500,
              artifactsProduced: 1,
            },
            reviewer: {
              inputTokens: 200,
              outputTokens: 80,
              dispatches: 1,
              durationMs: 300,
              artifactsProduced: 0,
            },
          },
        }),
      );

      expect(manifest.tokenUsage.totalInputTokens).toBe(300);
      expect(manifest.tokenUsage.totalOutputTokens).toBe(130);
      expect(manifest.tokenUsage.totalTokens).toBe(430);
    });

    it('builds byRole map from workerMetrics', () => {
      const manifest = assembleManifest(
        makeContext({
          workerMetrics: {
            developer: {
              inputTokens: 100,
              outputTokens: 50,
              dispatches: 2,
              durationMs: 500,
              artifactsProduced: 1,
            },
          },
        }),
      );

      expect(manifest.tokenUsage.byRole).toEqual({
        developer: { input: 100, output: 50 },
      });
    });

    it('returns zeros when workerMetrics is empty', () => {
      const manifest = assembleManifest(makeContext({ workerMetrics: {} }));

      expect(manifest.tokenUsage.totalInputTokens).toBe(0);
      expect(manifest.tokenUsage.totalOutputTokens).toBe(0);
      expect(manifest.tokenUsage.totalTokens).toBe(0);
      expect(manifest.tokenUsage.byRole).toEqual({});
    });
  });

  // -------------------------------------------------------------------
  // Active roles from workerMetrics
  // -------------------------------------------------------------------
  describe('activeRoles from workerMetrics', () => {
    it('builds RoleUsage objects from workerMetrics', () => {
      const manifest = assembleManifest(
        makeContext({
          workerMetrics: {
            developer: {
              inputTokens: 100,
              outputTokens: 50,
              dispatches: 3,
              durationMs: 1200,
              artifactsProduced: 2,
            },
          },
        }),
      );

      expect(manifest.activeRoles).toHaveLength(1);
      expect(manifest.activeRoles[0]).toEqual({
        role: 'developer',
        dispatches: 3,
        inputTokens: 100,
        outputTokens: 50,
        totalDurationMs: 1200,
        artifactsProduced: 2,
      });
    });

    it('includes multiple roles', () => {
      const manifest = assembleManifest(
        makeContext({
          workerMetrics: {
            developer: {
              inputTokens: 100,
              outputTokens: 50,
              dispatches: 2,
              durationMs: 500,
              artifactsProduced: 1,
            },
            reviewer: {
              inputTokens: 200,
              outputTokens: 80,
              dispatches: 1,
              durationMs: 300,
              artifactsProduced: 0,
            },
            architect: {
              inputTokens: 50,
              outputTokens: 30,
              dispatches: 1,
              durationMs: 200,
              artifactsProduced: 1,
            },
          },
        }),
      );

      expect(manifest.activeRoles).toHaveLength(3);
      const roles = manifest.activeRoles.map((r) => r.role);
      expect(roles).toContain('developer');
      expect(roles).toContain('reviewer');
      expect(roles).toContain('architect');
    });

    it('returns empty array when workerMetrics is empty', () => {
      const manifest = assembleManifest(makeContext({ workerMetrics: {} }));
      expect(manifest.activeRoles).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // Iterations from config
  // -------------------------------------------------------------------
  describe('iterations from config', () => {
    it('extracts valid iteration summaries', () => {
      const manifest = assembleManifest(
        makeContext({
          config: {
            iterations: [
              {
                contractId: 'contract-1',
                totalIterations: 3,
                judgeArbitrations: 1,
                finalStatus: 'accepted',
                findingsTotal: 5,
                findingsResolved: 4,
              },
            ],
          },
        }),
      );

      expect(manifest.iterations).toHaveLength(1);
      expect(manifest.iterations[0]).toEqual({
        contractId: 'contract-1',
        totalIterations: 3,
        judgeArbitrations: 1,
        finalStatus: 'accepted',
        findingsTotal: 5,
        findingsResolved: 4,
      });
    });

    it('returns empty array when iterations is empty', () => {
      const manifest = assembleManifest(makeContext({ config: { iterations: [] } }));
      expect(manifest.iterations).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // Governance decisions & escalations from config
  // -------------------------------------------------------------------
  describe('governanceDecisions and escalations from config', () => {
    it('extracts governanceDecisions from config', () => {
      const manifest = assembleManifest(makeContext({ config: { governanceDecisions: 7 } }));
      expect(manifest.governanceDecisions).toBe(7);
    });

    it('extracts escalations from config', () => {
      const manifest = assembleManifest(makeContext({ config: { escalations: 3 } }));
      expect(manifest.escalations).toBe(3);
    });

    it('defaults to 0 with default config', () => {
      const manifest = assembleManifest(makeContext());
      expect(manifest.governanceDecisions).toBe(0);
      expect(manifest.escalations).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // repoRoot from config
  // -------------------------------------------------------------------
  describe('repoRoot from config', () => {
    it('extracts repoRoot from config', () => {
      const manifest = assembleManifest(
        makeContext({ config: { repoRoot: '/home/user/project' } }),
      );
      expect(manifest.repoRoot).toBe('/home/user/project');
    });

    it('defaults to undefined when repoRoot is missing', () => {
      const manifest = assembleManifest(makeContext());
      expect(manifest.repoRoot).toBeUndefined();
    });

    it('always sets repository to empty string', () => {
      const manifest = assembleManifest(makeContext());
      expect(manifest.repository).toBe('');
    });
  });

  // -------------------------------------------------------------------
  // Graceful fallback for missing/malformed data
  // -------------------------------------------------------------------
  describe('graceful fallback', () => {
    it('produces valid manifest with minimal context', () => {
      const manifest = assembleManifest(
        makeContext({
          workerMetrics: {},
          stateHistory: [],
          artifactInventory: [],
        }),
      );

      expect(manifest.runId).toBe('run-001');
      expect(manifest.status).toBe('interrupted');
      expect(manifest.finalState).toBe('UNKNOWN');
      expect(manifest.tokenUsage.totalTokens).toBe(0);
      expect(manifest.activeRoles).toEqual([]);
      expect(manifest.iterations).toEqual([]);
      expect(manifest.governanceDecisions).toBe(0);
      expect(manifest.escalations).toBe(0);
      expect(manifest.repository).toBe('');
      expect(manifest.timing.stateTimings).toEqual([]);
    });

    it('handles stateTimestamps as empty array gracefully', () => {
      const manifest = assembleManifest(makeContext({ config: { stateTimestamps: [] } }));
      expect(manifest.timing.stateTimings).toEqual([]);
    });

    it('combines data from all sources in a full context', () => {
      const manifest = assembleManifest(
        makeContext({
          config: {
            startedAt: '2025-01-01T00:00:00.000Z',
            completedAt: '2025-01-01T01:00:00.000Z',
            governanceDecisions: 5,
            escalations: 2,
            repoRoot: '/home/user/acme-project',
            iterations: [
              {
                contractId: 'c1',
                totalIterations: 2,
                judgeArbitrations: 0,
                finalStatus: 'accepted',
                findingsTotal: 3,
                findingsResolved: 3,
              },
            ],
          },
          workerMetrics: {
            developer: {
              inputTokens: 500,
              outputTokens: 250,
              dispatches: 4,
              durationMs: 2000,
              artifactsProduced: 3,
            },
          },
          stateHistory: ['INTAKE', 'PLANNING', 'DONE'],
          artifactInventory: [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
        }),
      );

      expect(manifest.repoRoot).toBe('/home/user/acme-project');
      expect(manifest.timing.totalDurationMs).toBe(3_600_000);
      expect(manifest.governanceDecisions).toBe(5);
      expect(manifest.escalations).toBe(2);
      expect(manifest.iterations).toHaveLength(1);
      expect(manifest.activeRoles).toHaveLength(1);
      expect(manifest.tokenUsage.totalTokens).toBe(750);
      expect(manifest.totalArtifacts).toBe(1);
      expect(manifest.status).toBe('completed');
    });
  });
});
