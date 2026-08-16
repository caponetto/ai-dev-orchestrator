import { z } from 'zod/v4';

import { artifactRefSchema, artifactTypeSchema } from '../artifacts/artifact-system';

export const aggregationStrategySchema = z.enum(['all_must_pass', 'majority', 'any']);
export type AggregationStrategy = z.infer<typeof aggregationStrategySchema>;

export const successConditionTypeSchema = z.enum([
  'no_blocking_findings',
  'all_findings_addressed',
  'custom',
]);
export type SuccessConditionType = z.infer<typeof successConditionTypeSchema>;

export const successConditionSchema = z.object({
  type: successConditionTypeSchema,
  params: z.record(z.string(), z.unknown()).optional(),
});
export type SuccessCondition = z.infer<typeof successConditionSchema>;

export const failureConditionTypeSchema = z.enum([
  'max_iterations_exceeded',
  'judge_arbitration_failed',
  'custom',
]);
export type FailureConditionType = z.infer<typeof failureConditionTypeSchema>;

export const failureConditionSchema = z.object({
  type: failureConditionTypeSchema,
  params: z.record(z.string(), z.unknown()).optional(),
});
export type FailureCondition = z.infer<typeof failureConditionSchema>;

export const escalationActionSchema = z.enum(['escalate_to_human', 'force_approve', 'abort']);
export type EscalationAction = z.infer<typeof escalationActionSchema>;

export const escalationPolicySchema = z.object({
  action: escalationActionSchema,
  produceEscalationArtifact: z.boolean(),
  includeFullHistory: z.boolean(),
});
export type EscalationPolicy = z.infer<typeof escalationPolicySchema>;

export const reviewerSpecSchema = z.object({
  role: z.string(),
  output: artifactTypeSchema,
  inputs: z.array(artifactTypeSchema).readonly(),
});
export type ReviewerSpec = z.infer<typeof reviewerSpecSchema>;

export const iterationContractSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  producer: z.string(),
  reviewers: z.array(reviewerSpecSchema).readonly(),
  aggregation: aggregationStrategySchema,
  judge: z.string().optional(),
  producerInputs: z.array(artifactTypeSchema).readonly(),
  producerOutput: artifactTypeSchema,
  successCondition: successConditionSchema,
  failureCondition: failureConditionSchema,
  maxIterations: z.number(),
  maxJudgeArbitrations: z.number(),
  escalationPolicy: escalationPolicySchema,
  completionAgreement: z.string().optional(),
});
export type IterationContract = z.infer<typeof iterationContractSchema>;

export const iterationStatusSchema = z.enum(['in_progress', 'succeeded', 'failed', 'escalated']);
export type IterationStatus = z.infer<typeof iterationStatusSchema>;

export const iterationStateSchema = z.object({
  contractId: z.string(),
  currentIteration: z.number(),
  judgeArbitrations: z.number(),
  producerArtifactVersions: z.array(artifactRefSchema).readonly(),
  reviewerArtifactVersions: z.array(artifactRefSchema).readonly(),
  findingsTotal: z.number(),
  findingsResolved: z.number(),
  findingsOpen: z.number(),
  status: iterationStatusSchema,
});
export type IterationState = z.infer<typeof iterationStateSchema>;
