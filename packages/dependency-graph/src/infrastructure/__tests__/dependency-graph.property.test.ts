import type { ArtifactType } from '@ai-orchestrator/schemas';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DefaultDependencyGraph } from '../default-dependency-graph';

/** A subset of ArtifactType values used to build random DAGs. */
const DAG_TYPES: ArtifactType[] = [
  'canonical_specification',
  'plan',
  'test_plan',
  'implementation',
  'static_review',
  'security_review',
  'verification',
];

interface RawEdge {
  readonly a: number;
  readonly b: number;
}

/**
 * Build a valid DAG from random pairs. Only edges from lower to higher index
 * in DAG_TYPES are kept, guaranteeing acyclicity.
 */
function buildDagEdges(pairs: readonly RawEdge[]) {
  const depsMap = new Map<number, Set<number>>();
  for (const { a, b } of pairs) {
    if (a === b) {
      continue;
    }
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    if (!depsMap.has(to)) {
      depsMap.set(to, new Set());
    }
    const set = depsMap.get(to);
    if (set) {
      set.add(from);
    }
  }

  return DAG_TYPES.map((type, idx) => ({
    type,
    dependsOn: [...(depsMap.get(idx) ?? [])].map((i) => DAG_TYPES[i]),
    producedInState: `STATE_${String(idx)}`,
  }));
}

const rawEdgeArb = fc.record({
  a: fc.integer({ min: 0, max: DAG_TYPES.length - 1 }),
  b: fc.integer({ min: 0, max: DAG_TYPES.length - 1 }),
});

describe('Artifact Dependency Graph property-based tests', () => {
  it('adding edges preserves DAG acyclicity (topological sort always succeeds)', () => {
    fc.assert(
      fc.property(fc.array(rawEdgeArb, { minLength: 0, maxLength: 15 }), (pairs) => {
        const edges = buildDagEdges(pairs);
        const graph = new DefaultDependencyGraph(edges);

        // topologicalOrder() throws DependencyGraphCycleError on cycles
        const order = graph.topologicalOrder();
        expect(order.length).toBe(DAG_TYPES.length);
      }),
      { numRuns: 500 },
    );
  });

  it('topological sort order respects all edges (for every A->B, A before B)', () => {
    fc.assert(
      fc.property(fc.array(rawEdgeArb, { minLength: 1, maxLength: 15 }), (pairs) => {
        const edges = buildDagEdges(pairs);
        const graph = new DefaultDependencyGraph(edges);
        const order = graph.topologicalOrder();
        const orderIndex = new Map(order.map((t, i) => [t, i]));

        for (const edge of edges) {
          for (const dep of edge.dependsOn) {
            const depIdx = orderIndex.get(dep);
            const typeIdx = orderIndex.get(edge.type);
            expect(depIdx).toBeDefined();
            expect(typeIdx).toBeDefined();
            if (depIdx !== undefined && typeIdx !== undefined) {
              expect(depIdx).toBeLessThan(typeIdx);
            }
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it('impact analysis is monotonic (adding edges only increases or maintains dependents)', () => {
    const CHAIN_TYPES: ArtifactType[] = [
      'canonical_specification',
      'plan',
      'test_plan',
      'implementation',
      'verification',
    ];

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: CHAIN_TYPES.length - 1 }),
        fc.integer({ min: 0, max: CHAIN_TYPES.length - 2 }),
        (targetIdx, srcIdxRaw) => {
          const actualSrc = Math.min(srcIdxRaw, targetIdx - 1);

          // Base graph: linear chain 0 -> 1 -> 2 -> ... -> N-1
          const baseEdges = CHAIN_TYPES.map((type, idx) => ({
            type,
            dependsOn: idx > 0 ? [CHAIN_TYPES[idx - 1]] : ([] as ArtifactType[]),
            producedInState: `S${String(idx)}`,
          }));

          const baseGraph = new DefaultDependencyGraph(baseEdges);
          const baseDependents = new Set(baseGraph.getTransitiveDependents(CHAIN_TYPES[actualSrc]));

          // Extended graph: add an extra edge from actualSrc to targetIdx
          const extEdges = baseEdges.map((edge, idx) => {
            if (idx === targetIdx) {
              const deps = [...edge.dependsOn];
              if (!deps.includes(CHAIN_TYPES[actualSrc])) {
                deps.push(CHAIN_TYPES[actualSrc]);
              }
              return { ...edge, dependsOn: deps };
            }
            return edge;
          });

          const extGraph = new DefaultDependencyGraph(extEdges);
          const extDependents = new Set(extGraph.getTransitiveDependents(CHAIN_TYPES[actualSrc]));

          // The extended set must be a superset of the base set
          for (const dep of baseDependents) {
            expect(extDependents.has(dep)).toBe(true);
          }
          expect(extDependents.size).toBeGreaterThanOrEqual(baseDependents.size);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('staleness propagates transitively (if A is stale, all dependents of A are affected)', () => {
    const CHAIN_TYPES: ArtifactType[] = [
      'canonical_specification',
      'plan',
      'test_plan',
      'implementation',
      'verification',
    ];

    fc.assert(
      fc.property(fc.integer({ min: 0, max: CHAIN_TYPES.length - 2 }), (staleIdx) => {
        // Linear chain: each type depends on the previous one
        const edges = CHAIN_TYPES.map((type, idx) => ({
          type,
          dependsOn: idx > 0 ? [CHAIN_TYPES[idx - 1]] : ([] as ArtifactType[]),
          producedInState: `S${String(idx)}`,
        }));

        const graph = new DefaultDependencyGraph(edges);
        const transitiveDeps = graph.getTransitiveDependents(CHAIN_TYPES[staleIdx]);

        // In a linear chain, all nodes after staleIdx should be transitive dependents
        for (let i = staleIdx + 1; i < CHAIN_TYPES.length; i++) {
          expect(transitiveDeps).toContain(CHAIN_TYPES[i]);
        }

        // Nodes before staleIdx should NOT be transitive dependents
        for (let i = 0; i < staleIdx; i++) {
          expect(transitiveDeps).not.toContain(CHAIN_TYPES[i]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('default graph validates without errors', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const graph = new DefaultDependencyGraph();
        const validation = graph.validate();
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
