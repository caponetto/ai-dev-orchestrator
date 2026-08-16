import type { DependencyEdge } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { ArtifactTypeNotInGraphError, DependencyGraphCycleError } from '../../domain/errors';
import { DefaultDependencyGraph } from '../default-dependency-graph';

describe('DefaultDependencyGraph', () => {
  it('builds graph from default artifact types', () => {
    const graph = new DefaultDependencyGraph();
    const order = graph.topologicalOrder();
    expect(order.length).toBe(29);
  });

  it('validates default graph as valid', () => {
    const graph = new DefaultDependencyGraph();
    const result = graph.validate();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns direct dependencies for plan', () => {
    const graph = new DefaultDependencyGraph();
    const deps = graph.getDependencies('plan');
    expect(deps).toContain('canonical_specification');
  });

  it('returns direct dependents for plan', () => {
    const graph = new DefaultDependencyGraph();
    const dependents = graph.getDependents('plan');
    expect(dependents).toContain('plan_review');
    expect(dependents).toContain('test_plan');
    expect(dependents).toContain('implementation');
  });

  it('returns transitive dependencies for implementation', () => {
    const graph = new DefaultDependencyGraph();
    const deps = graph.getTransitiveDependencies('implementation');
    expect(deps).toContain('test_plan');
    expect(deps).toContain('plan');
    expect(deps).toContain('canonical_specification');
    expect(deps).toContain('planning_agreement');
  });

  it('returns transitive dependents for canonical_specification', () => {
    const graph = new DefaultDependencyGraph();
    const dependents = graph.getTransitiveDependents('canonical_specification');
    expect(dependents).toContain('plan');
    expect(dependents).toContain('implementation');
    expect(dependents).toContain('run_manifest');
  });

  it('returns empty dependencies for root nodes', () => {
    const graph = new DefaultDependencyGraph();
    expect(graph.getDependencies('canonical_specification')).toHaveLength(0);
    expect(graph.getDependencies('escalation_context')).toHaveLength(0);
  });

  it('returns empty dependents for leaf nodes', () => {
    const graph = new DefaultDependencyGraph();
    expect(graph.getDependents('run_manifest')).toHaveLength(0);
  });

  it('topological order places dependencies before dependents', () => {
    const graph = new DefaultDependencyGraph();
    const order = graph.topologicalOrder();
    const indexOf = (t: string) => order.indexOf(t as (typeof order)[number]);

    expect(indexOf('canonical_specification')).toBeLessThan(indexOf('plan'));
    expect(indexOf('plan')).toBeLessThan(indexOf('implementation'));
    expect(indexOf('implementation')).toBeLessThan(indexOf('verification'));
    expect(indexOf('verification')).toBeLessThan(indexOf('run_manifest'));
  });

  it('returns producing state for artifact types', () => {
    const graph = new DefaultDependencyGraph();
    expect(graph.getProducingState('canonical_specification')).toBe('INTAKE');
    expect(graph.getProducingState('plan')).toBe('PLANNING');
    expect(graph.getProducingState('implementation')).toBe('IMPLEMENTATION');
    expect(graph.getProducingState('test_plan')).toBe('IMPLEMENTATION');
    expect(graph.getProducingState('verification_agreement')).toBe('ACCEPTANCE_VALIDATION');
    expect(graph.getProducingState('implementation_agreement')).toBe('CODE_REVIEW');
    expect(graph.getProducingState('run_manifest')).toBe('DONE');
  });

  it('returns producing state for release_summary', () => {
    const graph = new DefaultDependencyGraph();
    expect(graph.getProducingState('release_summary')).toBe('WRAP_UP');
  });

  it('returns producing state for review_report', () => {
    const graph = new DefaultDependencyGraph();
    expect(graph.getProducingState('review_report')).toBe('REVIEW_SYNTHESIS');
  });

  it('review_report depends on all 7 review types', () => {
    const graph = new DefaultDependencyGraph();
    const deps = graph.getDependencies('review_report');
    expect(deps).toContain('static_review');
    expect(deps).toContain('security_review');
    expect(deps).toContain('performance_review');
    expect(deps).toContain('adversarial_review');
    expect(deps).toContain('design_review');
    expect(deps).toContain('docs_review');
    expect(deps).toContain('ux_review');
  });

  it('throws ArtifactTypeNotInGraphError for unknown type', () => {
    const graph = new DefaultDependencyGraph();
    expect(() => graph.getDependencies('intake_requirements')).toThrow(ArtifactTypeNotInGraphError);
  });

  it('detects cycles in custom graph', () => {
    const cyclicEdges: DependencyEdge[] = [
      { type: 'plan', dependsOn: ['implementation'], producedInState: 'PLANNING' },
      { type: 'implementation', dependsOn: ['plan'], producedInState: 'IMPLEMENTATION' },
    ];
    const graph = new DefaultDependencyGraph(cyclicEdges);
    const result = graph.validate();
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Cycle');
  });

  it('throws DependencyGraphCycleError on topologicalOrder with cycle', () => {
    const cyclicEdges: DependencyEdge[] = [
      { type: 'plan', dependsOn: ['implementation'], producedInState: 'PLANNING' },
      { type: 'implementation', dependsOn: ['plan'], producedInState: 'IMPLEMENTATION' },
    ];
    const graph = new DefaultDependencyGraph(cyclicEdges);
    expect(() => graph.topologicalOrder()).toThrow(DependencyGraphCycleError);
  });

  it('detects dangling references', () => {
    const edges: DependencyEdge[] = [
      { type: 'plan', dependsOn: ['nonexistent' as 'plan'], producedInState: 'PLANNING' },
    ];
    const graph = new DefaultDependencyGraph(edges);
    const result = graph.validate();
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('unregistered');
  });

  it('warns about isolated types', () => {
    const edges: DependencyEdge[] = [
      { type: 'plan', dependsOn: [], producedInState: 'PLANNING' },
      { type: 'implementation', dependsOn: [], producedInState: 'IMPLEMENTATION' },
    ];
    const graph = new DefaultDependencyGraph(edges);
    const result = graph.validate();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('isolated');
  });

  it('accepts custom graph without cycles', () => {
    const edges: DependencyEdge[] = [
      { type: 'canonical_specification', dependsOn: [], producedInState: 'INTAKE' },
      { type: 'plan', dependsOn: ['canonical_specification'], producedInState: 'PLANNING' },
      { type: 'implementation', dependsOn: ['plan'], producedInState: 'IMPLEMENTATION' },
    ];
    const graph = new DefaultDependencyGraph(edges);
    expect(graph.validate().valid).toBe(true);
    expect(graph.topologicalOrder()).toEqual(['canonical_specification', 'plan', 'implementation']);
  });
});
