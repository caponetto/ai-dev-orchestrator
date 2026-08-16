import { z } from 'zod/v4';

import { artifactRefSchema } from '../artifacts/artifact-system';
import { runIdSchema } from '../shared/shared';

export const policyTokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
});
export type PolicyTokenUsage = z.infer<typeof policyTokenUsageSchema>;

export const humanApprovalSchema = z.object({
  approvedBy: z.string(),
  timestamp: z.string(),
  conditions: z.string().optional(),
  artifactRef: artifactRefSchema.optional(),
});
export type HumanApproval = z.infer<typeof humanApprovalSchema>;

const ESCALATION_REASONS = [
  'iteration_limit_exceeded',
  'quality_gate_failed',
  'unresolvable_conflict',
  'human_requested',
  'token_budget_exceeded',
  'retry_limit_exceeded',
  'confidence_too_low',
] as const;

export const escalationReasonSchema = z.enum(ESCALATION_REASONS);
export type EscalationReason = z.infer<typeof escalationReasonSchema>;

const ESCALATION_TRIGGERS = [
  ...ESCALATION_REASONS,
  'provider_failure',
  'timeout',
  'unrecoverable_error',
] as const;

export const escalationTriggerSchema = z.enum(ESCALATION_TRIGGERS);
export type EscalationTrigger = z.infer<typeof escalationTriggerSchema>;

export const findingSummarySchema = z.object({
  id: z.string(),
  severity: z.string(),
  status: z.string(),
  description: z.string(),
  resolutionRef: artifactRefSchema.optional(),
});
export type FindingSummary = z.infer<typeof findingSummarySchema>;

export const iterationSummarySchema = z.object({
  iteration: z.number(),
  producerArtifact: artifactRefSchema,
  reviewerArtifact: artifactRefSchema,
  findingsProduced: z.number(),
  findingsResolved: z.number(),
  findingsRemaining: z.number(),
});
export type IterationSummary = z.infer<typeof iterationSummarySchema>;

export const escalationContextSchema = z.object({
  runId: runIdSchema,
  stageId: z.string(),
  reason: escalationReasonSchema,
  iterationHistory: z.array(iterationSummarySchema).readonly(),
  unresolvedFindings: z.array(findingSummarySchema).readonly(),
  artifactRefs: z.array(artifactRefSchema).readonly(),
  suggestedActions: z.array(z.string()).readonly(),
});
export type EscalationContext = z.infer<typeof escalationContextSchema>;

export const transitionAllowedSchema = z.object({
  allowed: z.literal(true),
  reason: z.string(),
});
export type TransitionAllowed = z.infer<typeof transitionAllowedSchema>;

export const transitionDeniedSchema = z.object({
  allowed: z.literal(false),
  reason: z.string(),
  remediation: z.string(),
});
export type TransitionDenied = z.infer<typeof transitionDeniedSchema>;

export const transitionEscalatedSchema = z.object({
  escalate: z.literal(true),
  reason: z.string(),
  context: escalationContextSchema,
});
export type TransitionEscalated = z.infer<typeof transitionEscalatedSchema>;

export const transitionDecisionSchema = z.union([
  transitionAllowedSchema,
  transitionDeniedSchema,
  transitionEscalatedSchema,
]);
export type TransitionDecision = z.infer<typeof transitionDecisionSchema>;

export const transitionRequestSchema = z.object({
  runId: runIdSchema,
  from: z.string(),
  to: z.string(),
  artifacts: z.array(artifactRefSchema).readonly(),
  iterationCount: z.number().optional(),
  findings: z.array(findingSummarySchema).readonly().optional(),
  humanApproval: humanApprovalSchema.optional(),
  tokenUsage: policyTokenUsageSchema.optional(),
});
export type TransitionRequest = z.infer<typeof transitionRequestSchema>;

export const agreementStatusSchema = z.object({
  exists: z.boolean(),
  valid: z.boolean(),
  artifact: artifactRefSchema.optional(),
  missingReason: z.string().optional(),
});
export type AgreementStatus = z.infer<typeof agreementStatusSchema>;

export const policyCheckOutcomeSchema = z.enum(['pass', 'fail', 'skip']);
export type PolicyCheckOutcome = z.infer<typeof policyCheckOutcomeSchema>;

export const policyEvaluationSchema = z.object({
  policy: z.string(),
  evaluated: z.boolean(),
  result: policyCheckOutcomeSchema,
  detail: z.string(),
  escalationTrigger: escalationTriggerSchema.optional(),
});
export type PolicyEvaluation = z.infer<typeof policyEvaluationSchema>;

export const governanceOutcomeSchema = z.enum(['allowed', 'denied', 'escalated']);
export type GovernanceOutcome = z.infer<typeof governanceOutcomeSchema>;

export const governanceDecisionSchema = z.object({
  timestamp: z.string(),
  runId: runIdSchema,
  transitionRequested: z.object({
    from: z.string(),
    to: z.string(),
  }),
  policiesEvaluated: z.array(policyEvaluationSchema).readonly(),
  outcome: governanceOutcomeSchema,
  reason: z.string(),
  artifactsInspected: z.array(artifactRefSchema).readonly(),
});
export type GovernanceDecision = z.infer<typeof governanceDecisionSchema>;
