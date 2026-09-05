import type { SuccessCriterion, TaskBrief } from '@ai-dev-orchestrator/schemas';
import { taskBriefSchema } from '@ai-dev-orchestrator/schemas';

export interface TaskBriefParams {
  readonly roleId: string;
  readonly instructions: string;
  readonly businessGoal: string;
  readonly targetArtifactType: string;
  readonly approach?: string;
  readonly explicitCriteria?: readonly SuccessCriterion[];
}

const ARTIFACT_TYPE_CRITERIA: Readonly<Record<string, readonly SuccessCriterion[]>> = {
  implementation: [
    {
      id: 'impl-summary',
      description: 'Produces a clear summary of changes made',
      verifiable: true,
    },
    { id: 'impl-steps', description: 'Documents implementation steps taken', verifiable: true },
    { id: 'impl-tests', description: 'All existing tests continue to pass', verifiable: true },
  ],
  static_review: [
    {
      id: 'review-approved',
      description: 'Provides a clear approved/rejected decision',
      verifiable: true,
    },
    { id: 'review-summary', description: 'Summarizes the review findings', verifiable: true },
    { id: 'review-findings', description: 'Lists all findings with severity', verifiable: true },
  ],
  plan: [
    { id: 'plan-steps', description: 'Provides actionable implementation steps', verifiable: true },
    { id: 'plan-risks', description: 'Identifies risks and mitigations', verifiable: true },
  ],
  specification: [
    { id: 'spec-complete', description: 'Covers all required sections', verifiable: true },
    {
      id: 'spec-unambiguous',
      description: 'Requirements are clear and testable',
      verifiable: true,
    },
  ],
  adversarial_review: [
    { id: 'adv-attacks', description: 'Tests edge cases and failure modes', verifiable: true },
    { id: 'adv-findings', description: 'Lists vulnerabilities found', verifiable: true },
  ],
};

const DEFAULT_CRITERIA: readonly SuccessCriterion[] = [
  { id: 'default-complete', description: 'Task is completed as requested', verifiable: true },
];

export function buildTaskBrief(params: TaskBriefParams): TaskBrief {
  const derivedCriteria = ARTIFACT_TYPE_CRITERIA[params.targetArtifactType] ?? DEFAULT_CRITERIA;

  const allCriteria: SuccessCriterion[] = [...derivedCriteria, ...(params.explicitCriteria ?? [])];

  const brief = {
    what: params.instructions,
    why: params.businessGoal || 'Complete the assigned task successfully',
    ...(params.approach ? { how: params.approach } : {}),
    successCriteria: allCriteria,
  };

  return taskBriefSchema.parse(brief);
}
