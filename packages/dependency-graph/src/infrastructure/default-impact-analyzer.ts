import type { DependencyGraph, ImpactAnalyzer } from '@ai-dev-orchestrator/ports';
import type {
  ArtifactType,
  RebuildEstimate,
  RebuildPlan,
  StaleSet,
} from '@ai-dev-orchestrator/schemas';

/** Artifact types that represent governance agreements (inlined to avoid circular dependency on artifacts). */
const AGREEMENT_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  'planning_agreement',
  'implementation_agreement',
  'verification_agreement',
  'release_agreement',
]);

const ESTIMATED_TOKENS_PER_WORKER = { input: 4000, output: 2000 };
const ESTIMATED_MS_PER_WORKER = 30_000;

/** Default implementation of impact analyzer with rebuild planning and cost estimation. */
export class DefaultImpactAnalyzer implements ImpactAnalyzer {
  constructor(private readonly graph: DependencyGraph) {}

  /** @inheritdoc */
  computeRebuildPlan(staleSet: StaleSet): RebuildPlan {
    const staleTypes = new Set(staleSet.staleArtifacts.map((sa) => sa.artifact.type));
    const allTypes = new Set(this.graph.topologicalOrder());

    const statesToReenter = new Set<string>();
    const artifactsToRebuild: ArtifactType[] = [];
    const artifactsPreserved: ArtifactType[] = [];
    let requiresGovernanceApproval = false;

    for (const type of staleSet.rebuildOrder) {
      if (staleTypes.has(type)) {
        artifactsToRebuild.push(type);
        const state = this.graph.getProducingState(type);
        if (state) {
          statesToReenter.add(state);
        }
        if (AGREEMENT_ARTIFACT_TYPES.has(type)) {
          requiresGovernanceApproval = true;
        }
      }
    }

    for (const type of allTypes) {
      if (!staleTypes.has(type)) {
        artifactsPreserved.push(type);
      }
    }

    return {
      statesToReenter: [...statesToReenter],
      artifactsToRebuild,
      artifactsPreserved,
      requiresGovernanceApproval,
    };
  }

  /** @inheritdoc */
  estimateRebuildCost(plan: RebuildPlan): RebuildEstimate {
    const workerCount = plan.artifactsToRebuild.length;

    return {
      stateCount: plan.statesToReenter.length,
      estimatedWorkerInvocations: workerCount,
      estimatedTokens: {
        input: workerCount * ESTIMATED_TOKENS_PER_WORKER.input,
        output: workerCount * ESTIMATED_TOKENS_PER_WORKER.output,
      },
      estimatedDurationMs: workerCount * ESTIMATED_MS_PER_WORKER,
    };
  }
}
