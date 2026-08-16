import type { ArtifactType } from '@ai-orchestrator/schemas';

/** Artifact types that represent code/plan reviews. */
export const REVIEW_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  'plan_review',
  'static_review',
  'security_review',
  'performance_review',
  'adversarial_review',
  'design_review',
  'docs_review',
  'ux_review',
  'decomposition_review',
]);

/** Artifact types that represent governance agreements. */
export const AGREEMENT_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  'planning_agreement',
  'implementation_agreement',
  'verification_agreement',
  'release_agreement',
]);

/** Artifact types that carry a pass/fail or approved/rejected verdict. */
export const VERDICT_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  ...REVIEW_ARTIFACT_TYPES,
  ...AGREEMENT_ARTIFACT_TYPES,
  'review_report',
  'review_findings',
  'judge_decision',
  'verification',
  'acceptance_validation',
]);
