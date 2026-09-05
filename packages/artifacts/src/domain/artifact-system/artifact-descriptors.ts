import type { ArtifactType } from '@ai-dev-orchestrator/schemas';
import { type z } from 'zod/v4';

import {
  acceptanceValidationContentSchema,
  remediationPlanContentSchema,
  agreementContentSchema,
  canonicalSpecificationContentSchema,
  clarificationAnswersContentSchema,
  codebaseContextContentSchema,
  decompositionReviewContentSchema,
  escalationContextContentSchema,
  implementationContentSchema,
  intakeAnalysisContentSchema,
  intakeRequirementsContentSchema,
  judgeDecisionContentSchema,
  planContentSchema,
  prDiffContextContentSchema,
  releaseSummaryContentSchema,
  reviewContentSchema,
  reviewFindingsContentSchema,
  reviewReportContentSchema,
  runManifestContentSchema,
  taskBreakdownContentSchema,
  taskSpecificationsContentSchema,
  testPlanContentSchema,
  testSuiteContentSchema,
  verificationContentSchema,
} from './artifact-content-schemas';

export interface ArtifactDescriptor {
  readonly contentSchema: z.ZodType;
  readonly defaultOwners: readonly string[];
  readonly producerLabel?: string;
}

export const ARTIFACT_DESCRIPTORS: Readonly<Record<ArtifactType, ArtifactDescriptor>> = {
  intake_requirements: {
    contentSchema: intakeRequirementsContentSchema,
    defaultOwners: ['human'],
    producerLabel: 'human',
  },
  canonical_specification: {
    contentSchema: canonicalSpecificationContentSchema,
    defaultOwners: ['requirements_analyst', 'context_analyst'],
    producerLabel: 'requirements_analyst',
  },
  clarification_questions: {
    contentSchema: intakeAnalysisContentSchema,
    defaultOwners: ['requirements_analyst'],
    producerLabel: 'requirements_analyst',
  },
  clarification_answers: {
    contentSchema: clarificationAnswersContentSchema,
    defaultOwners: ['human'],
  },
  plan: {
    contentSchema: planContentSchema,
    defaultOwners: ['planner'],
    producerLabel: 'planner',
  },
  plan_review: {
    contentSchema: reviewContentSchema,
    defaultOwners: ['plan_reviewer'],
    producerLabel: 'plan_reviewer',
  },
  test_plan: {
    contentSchema: testPlanContentSchema,
    defaultOwners: ['implementer'],
    producerLabel: 'implementer',
  },
  implementation: {
    contentSchema: implementationContentSchema,
    defaultOwners: ['implementer'],
    producerLabel: 'implementer',
  },
  static_review: {
    contentSchema: reviewContentSchema,
    defaultOwners: ['static_reviewer'],
    producerLabel: 'static_reviewer',
  },
  security_review: {
    contentSchema: reviewContentSchema,
    defaultOwners: ['security_reviewer'],
    producerLabel: 'security_reviewer',
  },
  performance_review: {
    contentSchema: reviewContentSchema,
    defaultOwners: ['performance_reviewer'],
    producerLabel: 'performance_reviewer',
  },
  adversarial_review: {
    contentSchema: reviewContentSchema,
    defaultOwners: ['adversarial_reviewer'],
    producerLabel: 'adversarial_reviewer',
  },
  design_review: {
    contentSchema: reviewContentSchema,
    defaultOwners: ['design_reviewer'],
    producerLabel: 'design_reviewer',
  },
  docs_review: {
    contentSchema: reviewContentSchema,
    defaultOwners: ['docs_reviewer'],
    producerLabel: 'docs_reviewer',
  },
  ux_review: {
    contentSchema: reviewContentSchema,
    defaultOwners: ['ux_reviewer'],
    producerLabel: 'ux_reviewer',
  },
  review_report: {
    contentSchema: reviewReportContentSchema,
    defaultOwners: ['report_synthesizer'],
    producerLabel: 'report_synthesizer',
  },
  remediation_plan: {
    contentSchema: remediationPlanContentSchema,
    defaultOwners: ['remediation_triage'],
    producerLabel: 'remediation_triage',
  },
  verification: {
    contentSchema: verificationContentSchema,
    defaultOwners: ['verifier'],
    producerLabel: 'verifier',
  },
  judge_decision: {
    contentSchema: judgeDecisionContentSchema,
    defaultOwners: ['judge'],
    producerLabel: 'judge',
  },
  planning_agreement: {
    contentSchema: agreementContentSchema,
    defaultOwners: ['governance'],
  },
  implementation_agreement: {
    contentSchema: agreementContentSchema,
    defaultOwners: ['governance'],
  },
  verification_agreement: {
    contentSchema: agreementContentSchema,
    defaultOwners: ['governance'],
  },
  release_agreement: {
    contentSchema: agreementContentSchema,
    defaultOwners: ['governance'],
  },
  escalation_context: {
    contentSchema: escalationContextContentSchema,
    defaultOwners: ['governance'],
  },
  run_manifest: {
    contentSchema: runManifestContentSchema,
    defaultOwners: ['workflow_engine'],
  },
  release_summary: {
    contentSchema: releaseSummaryContentSchema,
    defaultOwners: ['summary_writer'],
    producerLabel: 'summary_writer',
  },
  review_findings: {
    contentSchema: reviewFindingsContentSchema,
    defaultOwners: ['review_findings_writer', 'script'],
    producerLabel: 'review_findings_writer',
  },
  codebase_context: {
    contentSchema: codebaseContextContentSchema,
    defaultOwners: ['codebase_analyst'],
  },
  test_suite: {
    contentSchema: testSuiteContentSchema,
    defaultOwners: ['test_engineer'],
  },
  acceptance_validation: {
    contentSchema: acceptanceValidationContentSchema,
    defaultOwners: ['acceptance_validator'],
  },
  task_breakdown: {
    contentSchema: taskBreakdownContentSchema,
    defaultOwners: ['decomposer'],
    producerLabel: 'decomposer',
  },
  decomposition_review: {
    contentSchema: decompositionReviewContentSchema,
    defaultOwners: ['decomposition_reviewer'],
    producerLabel: 'decomposition_reviewer',
  },
  task_specifications: {
    contentSchema: taskSpecificationsContentSchema,
    defaultOwners: ['task_spec_writer'],
    producerLabel: 'task_spec_writer',
  },
  pr_diff_context: {
    contentSchema: prDiffContextContentSchema,
    defaultOwners: ['script'],
    producerLabel: 'compute-pr-diff',
  },
} as const;

export const ARTIFACT_SCHEMA_MAP: Readonly<Record<ArtifactType, z.ZodType>> = Object.fromEntries(
  Object.entries(ARTIFACT_DESCRIPTORS).map(([k, v]) => [k, v.contentSchema]),
) as Record<ArtifactType, z.ZodType>;
