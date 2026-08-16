import type { DependencyGraph } from '@ai-orchestrator/ports';
import type {
  ArtifactType,
  DependencyEdge,
  DependencyGraphValidation,
} from '@ai-orchestrator/schemas';

import { ArtifactTypeNotInGraphError, DependencyGraphCycleError } from '../domain/errors';

/** Default dependency definitions per spec §7. */
const DEFAULT_EDGES: readonly DependencyEdge[] = [
  { type: 'canonical_specification', dependsOn: [], producedInState: 'INTAKE' },
  {
    type: 'clarification_questions',
    dependsOn: ['canonical_specification'],
    producedInState: 'REFINEMENT',
  },
  {
    type: 'clarification_answers',
    dependsOn: ['clarification_questions'],
    producedInState: 'REFINEMENT',
  },
  { type: 'plan', dependsOn: ['canonical_specification'], producedInState: 'PLANNING' },
  { type: 'plan_review', dependsOn: ['plan'], producedInState: 'PLAN_REVIEW' },
  { type: 'planning_agreement', dependsOn: ['plan_review'], producedInState: 'PLAN_REVIEW' },
  {
    type: 'test_plan',
    dependsOn: ['planning_agreement', 'plan'],
    producedInState: 'IMPLEMENTATION',
  },
  { type: 'implementation', dependsOn: ['test_plan', 'plan'], producedInState: 'IMPLEMENTATION' },
  {
    type: 'static_review',
    dependsOn: ['implementation', 'pr_diff_context'],
    producedInState: 'CODE_REVIEW',
  },
  {
    type: 'security_review',
    dependsOn: ['implementation', 'pr_diff_context'],
    producedInState: 'CODE_REVIEW',
  },
  {
    type: 'performance_review',
    dependsOn: ['implementation', 'pr_diff_context'],
    producedInState: 'CODE_REVIEW',
  },
  {
    type: 'adversarial_review',
    dependsOn: ['implementation', 'pr_diff_context'],
    producedInState: 'CODE_REVIEW',
  },
  {
    type: 'design_review',
    dependsOn: ['implementation', 'pr_diff_context'],
    producedInState: 'CODE_REVIEW',
  },
  {
    type: 'docs_review',
    dependsOn: ['implementation', 'pr_diff_context'],
    producedInState: 'CODE_REVIEW',
  },
  {
    type: 'ux_review',
    dependsOn: ['implementation', 'pr_diff_context'],
    producedInState: 'CODE_REVIEW',
  },
  {
    type: 'implementation_agreement',
    dependsOn: [
      'static_review',
      'security_review',
      'performance_review',
      'adversarial_review',
      'design_review',
      'docs_review',
      'ux_review',
    ],
    producedInState: 'CODE_REVIEW',
  },
  {
    type: 'remediation_plan',
    dependsOn: ['review_report'],
    producedInState: 'REMEDIATION_TRIAGE',
  },
  {
    type: 'review_report',
    dependsOn: [
      'static_review',
      'security_review',
      'performance_review',
      'adversarial_review',
      'design_review',
      'docs_review',
      'ux_review',
    ],
    producedInState: 'REVIEW_SYNTHESIS',
  },
  {
    type: 'codebase_context',
    dependsOn: ['canonical_specification'],
    producedInState: 'CODEBASE_ANALYSIS',
  },
  {
    type: 'test_suite',
    dependsOn: ['implementation', 'plan'],
    producedInState: 'TEST_AUTHORING',
  },
  {
    type: 'verification',
    dependsOn: ['implementation', 'test_plan', 'test_suite', 'implementation_agreement'],
    producedInState: 'TEST_EXECUTION',
  },
  {
    type: 'acceptance_validation',
    dependsOn: ['verification', 'canonical_specification'],
    producedInState: 'ACCEPTANCE_VALIDATION',
  },
  {
    type: 'verification_agreement',
    dependsOn: ['acceptance_validation'],
    producedInState: 'ACCEPTANCE_VALIDATION',
  },
  { type: 'release_summary', dependsOn: ['acceptance_validation'], producedInState: 'WRAP_UP' },
  { type: 'review_findings', dependsOn: ['review_report'], producedInState: 'WRAP_UP' },
  { type: 'release_agreement', dependsOn: ['verification_agreement'], producedInState: 'WRAP_UP' },
  { type: 'run_manifest', dependsOn: ['release_agreement'], producedInState: 'DONE' },
  { type: 'escalation_context', dependsOn: [], producedInState: 'WAITING_FOR_HUMAN' },
  {
    type: 'pr_diff_context',
    dependsOn: ['canonical_specification'],
    producedInState: 'DIFF_COMPUTATION',
  },
];

/** Default implementation of dependency graph with built-in or custom edges. */
export class DefaultDependencyGraph implements DependencyGraph {
  private readonly edges: ReadonlyMap<ArtifactType, DependencyEdge>;
  private readonly forwardMap: ReadonlyMap<ArtifactType, readonly ArtifactType[]>;
  private readonly reverseMap: ReadonlyMap<ArtifactType, readonly ArtifactType[]>;
  private readonly stateMap: ReadonlyMap<ArtifactType, string>;

  constructor(customEdges?: readonly DependencyEdge[]) {
    const allEdges = customEdges ?? DEFAULT_EDGES;
    const edgeMap = new Map<ArtifactType, DependencyEdge>();
    const forward = new Map<ArtifactType, ArtifactType[]>();
    const reverse = new Map<ArtifactType, ArtifactType[]>();
    const stateMap = new Map<ArtifactType, string>();

    for (const edge of allEdges) {
      edgeMap.set(edge.type, edge);
      forward.set(edge.type, [...edge.dependsOn]);
      stateMap.set(edge.type, edge.producedInState);

      if (!reverse.has(edge.type)) {
        reverse.set(edge.type, []);
      }
      for (const dep of edge.dependsOn) {
        if (!reverse.has(dep)) {
          reverse.set(dep, []);
        }
        const list = reverse.get(dep);
        if (list) {
          list.push(edge.type);
        }
      }
    }

    this.edges = edgeMap;
    this.forwardMap = forward;
    this.reverseMap = reverse;
    this.stateMap = stateMap;
  }

  /** @inheritdoc */
  getDependencies(type: ArtifactType): readonly ArtifactType[] {
    this.assertTypeExists(type);
    return this.forwardMap.get(type) ?? [];
  }

  /** @inheritdoc */
  getDependents(type: ArtifactType): readonly ArtifactType[] {
    this.assertTypeExists(type);
    return this.reverseMap.get(type) ?? [];
  }

  /** @inheritdoc */
  getTransitiveDependencies(type: ArtifactType): readonly ArtifactType[] {
    this.assertTypeExists(type);
    const visited = new Set<ArtifactType>();
    this.collectTransitive(type, this.forwardMap, visited);
    visited.delete(type);
    return [...visited];
  }

  /** @inheritdoc */
  getTransitiveDependents(type: ArtifactType): readonly ArtifactType[] {
    this.assertTypeExists(type);
    const visited = new Set<ArtifactType>();
    this.collectTransitive(type, this.reverseMap, visited);
    visited.delete(type);
    return [...visited];
  }

  /** @inheritdoc */
  validate(): DependencyGraphValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for cycles
    const cycleResult = this.detectCycle();
    if (cycleResult) {
      errors.push(`Cycle detected: ${cycleResult.join(' -> ')}`);
    }

    // Check for dangling references
    for (const [type, edge] of this.edges) {
      for (const dep of edge.dependsOn) {
        if (!this.edges.has(dep)) {
          errors.push(`Type "${type}" depends on unregistered type "${dep}"`);
        }
      }
    }

    // Check for orphans (not root, not depended on by anything, not a leaf)
    for (const type of this.edges.keys()) {
      const deps = this.forwardMap.get(type) ?? [];
      const dependents = this.reverseMap.get(type) ?? [];
      if (deps.length === 0 && dependents.length === 0 && this.edges.size > 1) {
        warnings.push(`Type "${type}" is isolated (no dependencies and no dependents)`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /** @inheritdoc */
  topologicalOrder(): readonly ArtifactType[] {
    const inDegree = new Map<ArtifactType, number>();
    for (const [type] of this.edges) {
      const deps = this.forwardMap.get(type) ?? [];
      inDegree.set(type, deps.length);
    }

    const queue: ArtifactType[] = [];
    for (const [type, degree] of inDegree) {
      if (degree === 0) {
        queue.push(type);
      }
    }

    const result: ArtifactType[] = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      result.push(current);

      const dependents = this.reverseMap.get(current) ?? [];
      for (const dep of dependents) {
        const newDegree = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) {
          queue.push(dep);
        }
      }
    }

    if (result.length !== this.edges.size) {
      const remaining = [...this.edges.keys()].filter((t) => !result.includes(t));
      throw new DependencyGraphCycleError(remaining);
    }

    return result;
  }

  /** @inheritdoc */
  getProducingState(type: ArtifactType): string | undefined {
    return this.stateMap.get(type);
  }

  private assertTypeExists(type: ArtifactType): void {
    if (!this.edges.has(type) && !this.reverseMap.has(type)) {
      throw new ArtifactTypeNotInGraphError(type);
    }
  }

  private collectTransitive(
    type: ArtifactType,
    adjacency: ReadonlyMap<ArtifactType, readonly ArtifactType[]>,
    visited: Set<ArtifactType>,
  ): void {
    if (visited.has(type)) {
      return;
    }
    visited.add(type);
    const neighbors = adjacency.get(type) ?? [];
    for (const neighbor of neighbors) {
      this.collectTransitive(neighbor, adjacency, visited);
    }
  }

  private detectCycle(): readonly string[] | null {
    const color = new Map<ArtifactType, number>();
    const parent = new Map<ArtifactType, ArtifactType | null>();

    for (const type of this.edges.keys()) {
      color.set(type, 0);
    }

    for (const type of this.edges.keys()) {
      if (color.get(type) === 0) {
        const cycle = this.dfsVisit(type, color, parent);
        if (cycle) {
          return cycle;
        }
      }
    }

    return null;
  }

  private dfsVisit(
    node: ArtifactType,
    color: Map<ArtifactType, number>,
    parent: Map<ArtifactType, ArtifactType | null>,
  ): readonly string[] | null {
    color.set(node, 1);

    const deps = this.forwardMap.get(node) ?? [];
    for (const dep of deps) {
      if (color.get(dep) === 1) {
        return this.buildCyclePath(dep, node, parent);
      }
      if (color.get(dep) !== 2) {
        parent.set(dep, node);
        const cycle = this.dfsVisit(dep, color, parent);
        if (cycle) {
          return cycle;
        }
      }
    }

    color.set(node, 2);
    return null;
  }

  private buildCyclePath(
    cycleStart: ArtifactType,
    cycleEnd: ArtifactType,
    parent: Map<ArtifactType, ArtifactType | null>,
  ): readonly string[] {
    const path: string[] = [cycleStart];
    let current: ArtifactType | null | undefined = cycleEnd;
    while (current && current !== cycleStart) {
      path.push(current);
      current = parent.get(current);
    }
    path.push(cycleStart);
    path.reverse();
    return path;
  }
}
