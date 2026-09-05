import type { ArtifactRef, StaleArtifact, StaleSet } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { DefaultDependencyGraph } from '../default-dependency-graph';
import { DefaultImpactAnalyzer } from '../default-impact-analyzer';

function ref(type: string, name: string, version: number): ArtifactRef {
  return {
    type: type as ArtifactRef['type'],
    name,
    version,
    checksum: `sha-${type}-${String(version)}`,
  };
}

function makeStaleArtifact(type: string): StaleArtifact {
  return {
    artifact: ref(type, type, 1),
    staleInputs: [
      { currentInput: ref('plan', 'plan', 1), latestAvailable: ref('plan', 'plan', 2) },
    ],
    depth: 1,
  };
}

describe('DefaultImpactAnalyzer', () => {
  it('computes rebuild plan from stale set', () => {
    const graph = new DefaultDependencyGraph();
    const analyzer = new DefaultImpactAnalyzer(graph);

    const staleSet: StaleSet = {
      trigger: ref('plan', 'plan', 2),
      staleArtifacts: [makeStaleArtifact('implementation'), makeStaleArtifact('test_plan')],
      rebuildOrder: ['test_plan', 'implementation'],
    };

    const plan = analyzer.computeRebuildPlan(staleSet);
    expect(plan.artifactsToRebuild).toContain('implementation');
    expect(plan.artifactsToRebuild).toContain('test_plan');
    expect(plan.statesToReenter.length).toBeGreaterThan(0);
    expect(plan.statesToReenter).toContain('IMPLEMENTATION');
  });

  it('marks governance approval required when agreements are stale', () => {
    const graph = new DefaultDependencyGraph();
    const analyzer = new DefaultImpactAnalyzer(graph);

    const staleSet: StaleSet = {
      trigger: ref('plan_review', 'review', 2),
      staleArtifacts: [makeStaleArtifact('planning_agreement')],
      rebuildOrder: ['planning_agreement'],
    };

    const plan = analyzer.computeRebuildPlan(staleSet);
    expect(plan.requiresGovernanceApproval).toBe(true);
  });

  it('does not require governance when no agreements are stale', () => {
    const graph = new DefaultDependencyGraph();
    const analyzer = new DefaultImpactAnalyzer(graph);

    const staleSet: StaleSet = {
      trigger: ref('plan', 'plan', 2),
      staleArtifacts: [makeStaleArtifact('implementation')],
      rebuildOrder: ['implementation'],
    };

    const plan = analyzer.computeRebuildPlan(staleSet);
    expect(plan.requiresGovernanceApproval).toBe(false);
  });

  it('preserves non-stale artifacts', () => {
    const graph = new DefaultDependencyGraph();
    const analyzer = new DefaultImpactAnalyzer(graph);

    const staleSet: StaleSet = {
      trigger: ref('plan', 'plan', 2),
      staleArtifacts: [makeStaleArtifact('implementation')],
      rebuildOrder: ['implementation'],
    };

    const plan = analyzer.computeRebuildPlan(staleSet);
    expect(plan.artifactsPreserved).toContain('canonical_specification');
    expect(plan.artifactsPreserved).toContain('plan');
    expect(plan.artifactsPreserved).not.toContain('implementation');
  });

  it('estimates rebuild cost based on artifact count', () => {
    const graph = new DefaultDependencyGraph();
    const analyzer = new DefaultImpactAnalyzer(graph);

    const staleSet: StaleSet = {
      trigger: ref('plan', 'plan', 2),
      staleArtifacts: [makeStaleArtifact('implementation'), makeStaleArtifact('test_plan')],
      rebuildOrder: ['test_plan', 'implementation'],
    };

    const plan = analyzer.computeRebuildPlan(staleSet);
    const estimate = analyzer.estimateRebuildCost(plan);

    expect(estimate.estimatedWorkerInvocations).toBe(2);
    expect(estimate.stateCount).toBe(plan.statesToReenter.length);
    expect(estimate.estimatedTokens.input).toBeGreaterThan(0);
    expect(estimate.estimatedTokens.output).toBeGreaterThan(0);
    expect(estimate.estimatedDurationMs).toBeGreaterThan(0);
  });

  it('estimates zero cost for empty rebuild plan', () => {
    const graph = new DefaultDependencyGraph();
    const analyzer = new DefaultImpactAnalyzer(graph);

    const staleSet: StaleSet = {
      trigger: ref('plan', 'plan', 2),
      staleArtifacts: [],
      rebuildOrder: [],
    };

    const plan = analyzer.computeRebuildPlan(staleSet);
    const estimate = analyzer.estimateRebuildCost(plan);

    expect(estimate.estimatedWorkerInvocations).toBe(0);
    expect(estimate.estimatedDurationMs).toBe(0);
  });
});
