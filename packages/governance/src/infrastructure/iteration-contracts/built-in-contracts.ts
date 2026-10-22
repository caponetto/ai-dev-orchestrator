import type { IterationContract, IterationLimitDefaults } from '@ai-dev-orchestrator/schemas';

/**
 * Fallback limits used only when no governance config is available (e.g. fixture mode).
 * Production runs always use values from governance.yaml / UI settings.
 */
const FALLBACK_LIMITS: IterationLimitDefaults = {
  maxReviewIterations: 5,
  maxJudgeArbitrations: 3,
  maxClarificationRounds: 3,
  maxAcceptanceIterations: 3,
};

function buildPlanReviewLoop(limits: IterationLimitDefaults): IterationContract {
  return {
    id: 'plan_review_loop',
    name: 'Plan Review Loop',
    description: 'Iterative review of the implementation plan by the plan reviewer',
    producer: 'planner',
    reviewers: [
      {
        role: 'plan_reviewer',
        output: 'plan_review',
        inputs: ['plan'],
      },
    ],
    aggregation: 'all_must_pass',
    producerInputs: ['canonical_specification', 'clarification_answers'],
    producerOutput: 'plan',
    successCondition: { type: 'no_blocking_findings' },
    failureCondition: { type: 'max_iterations_exceeded' },
    maxIterations: limits.maxReviewIterations,
    maxJudgeArbitrations: limits.maxJudgeArbitrations,
    escalationPolicy: {
      action: 'escalate_to_human',
      produceEscalationArtifact: true,
      includeFullHistory: true,
    },
    completionAgreement: 'planning_agreement',
  };
}

function buildImplementationReviewLoop(limits: IterationLimitDefaults): IterationContract {
  return {
    id: 'implementation_review_loop',
    name: 'Implementation Review Loop',
    description: 'Iterative review of implementation by all configured code reviewers',
    producer: 'implementer',
    reviewers: [
      {
        role: 'static_reviewer',
        output: 'static_review',
        inputs: ['implementation'],
      },
      {
        role: 'security_reviewer',
        output: 'security_review',
        inputs: ['implementation'],
      },
      {
        role: 'performance_reviewer',
        output: 'performance_review',
        inputs: ['implementation'],
      },
      {
        role: 'adversarial_reviewer',
        output: 'adversarial_review',
        inputs: ['implementation'],
      },
      {
        role: 'design_reviewer',
        output: 'design_review',
        inputs: ['implementation'],
      },
      {
        role: 'docs_reviewer',
        output: 'docs_review',
        inputs: ['implementation'],
      },
      {
        role: 'ux_reviewer',
        output: 'ux_review',
        inputs: ['implementation'],
      },
    ],
    aggregation: 'all_must_pass',
    producerInputs: ['plan', 'test_plan'],
    producerOutput: 'implementation',
    successCondition: { type: 'no_blocking_findings' },
    failureCondition: { type: 'max_iterations_exceeded' },
    maxIterations: limits.maxReviewIterations,
    maxJudgeArbitrations: limits.maxJudgeArbitrations,
    escalationPolicy: {
      action: 'escalate_to_human',
      produceEscalationArtifact: true,
      includeFullHistory: true,
    },
    completionAgreement: 'implementation_agreement',
  };
}

function buildClarificationLoop(limits: IterationLimitDefaults): IterationContract {
  return {
    id: 'clarification_loop',
    name: 'Clarification Loop',
    description: 'Iterative clarification of requirements with the human',
    producer: 'requirements_analyst',
    reviewers: [],
    aggregation: 'all_must_pass',
    producerInputs: ['canonical_specification'],
    producerOutput: 'clarification_questions',
    successCondition: { type: 'all_findings_addressed' },
    failureCondition: { type: 'max_iterations_exceeded' },
    maxIterations: limits.maxClarificationRounds,
    maxJudgeArbitrations: 0,
    escalationPolicy: {
      action: 'abort',
      produceEscalationArtifact: false,
      includeFullHistory: false,
    },
  };
}

function buildAcceptanceValidationLoop(limits: IterationLimitDefaults): IterationContract {
  return {
    id: 'acceptance_validation_loop',
    name: 'Acceptance Validation Loop',
    description:
      'Iterative acceptance validation cycle — implementer addresses uncovered or failed criteria',
    producer: 'implementer',
    reviewers: [],
    aggregation: 'all_must_pass',
    producerInputs: ['plan', 'canonical_specification', 'acceptance_validation'],
    producerOutput: 'implementation',
    successCondition: { type: 'all_findings_addressed' },
    failureCondition: { type: 'max_iterations_exceeded' },
    maxIterations: limits.maxAcceptanceIterations,
    maxJudgeArbitrations: 0,
    escalationPolicy: {
      action: 'escalate_to_human',
      produceEscalationArtifact: true,
      includeFullHistory: true,
    },
    completionAgreement: 'verification_agreement',
  };
}

function buildDecompositionReviewLoop(): IterationContract {
  return {
    id: 'decomposition_review_loop',
    name: 'Decomposition Review Loop',
    description: 'Review task independence and coverage before specification authoring',
    producer: 'decomposer',
    reviewers: [
      {
        role: 'decomposition_reviewer',
        output: 'decomposition_review',
        inputs: ['task_breakdown'],
      },
    ],
    aggregation: 'all_must_pass',
    producerInputs: ['canonical_specification', 'codebase_context'],
    producerOutput: 'task_breakdown',
    successCondition: { type: 'no_blocking_findings' },
    failureCondition: { type: 'max_iterations_exceeded' },
    maxIterations: 3,
    maxJudgeArbitrations: 0,
    escalationPolicy: {
      action: 'abort',
      produceEscalationArtifact: false,
      includeFullHistory: false,
    },
  };
}

/** Build all iteration contracts using the provided governance limits and fixed task-breakdown limit. */
export function buildContracts(limits: IterationLimitDefaults): readonly IterationContract[] {
  return [
    buildPlanReviewLoop(limits),
    buildImplementationReviewLoop(limits),
    buildClarificationLoop(limits),
    buildAcceptanceValidationLoop(limits),
    buildDecompositionReviewLoop(),
  ];
}

/** Convenience aliases built with fallback limits — use `buildContracts(limits)` in production. */
export const PLAN_REVIEW_LOOP: IterationContract = buildPlanReviewLoop(FALLBACK_LIMITS);
export const IMPLEMENTATION_REVIEW_LOOP: IterationContract =
  buildImplementationReviewLoop(FALLBACK_LIMITS);
export const CLARIFICATION_LOOP: IterationContract = buildClarificationLoop(FALLBACK_LIMITS);
export const ACCEPTANCE_VALIDATION_LOOP: IterationContract =
  buildAcceptanceValidationLoop(FALLBACK_LIMITS);
export const DECOMPOSITION_REVIEW_LOOP: IterationContract = buildDecompositionReviewLoop();

/** All built-in iteration contracts (with fallback limits). */
export const BUILT_IN_CONTRACTS: readonly IterationContract[] = [
  PLAN_REVIEW_LOOP,
  IMPLEMENTATION_REVIEW_LOOP,
  CLARIFICATION_LOOP,
  ACCEPTANCE_VALIDATION_LOOP,
  DECOMPOSITION_REVIEW_LOOP,
];
