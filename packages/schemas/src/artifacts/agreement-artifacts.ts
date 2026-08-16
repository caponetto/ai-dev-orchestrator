import { z } from 'zod/v4';

import { artifactRefSchema } from './artifact-system';

export const agreementTypeSchema = z.enum([
  'planning_agreement',
  'implementation_agreement',
  'verification_agreement',
  'release_agreement',
]);
export type AgreementType = z.infer<typeof agreementTypeSchema>;

export const approvalStatusSchema = z.enum(['approved', 'conditionally_approved', 'rejected']);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalTypeSchema = z.enum(['human', 'automated', 'judge']);
export type ApprovalType = z.infer<typeof approvalTypeSchema>;

export const participantActionSchema = z.enum(['produced', 'reviewed', 'judged', 'approved']);
export type ParticipantAction = z.infer<typeof participantActionSchema>;

export const agreementParticipantSchema = z.object({
  role: z.string(),
  action: participantActionSchema,
});
export type AgreementParticipant = z.infer<typeof agreementParticipantSchema>;

export const agreementFindingSchema = z.object({
  id: z.string(),
  severity: z.string(),
  status: z.string(),
  title: z.string(),
  resolutionRef: artifactRefSchema.optional(),
});
export type AgreementFinding = z.infer<typeof agreementFindingSchema>;

export const agreementArtifactSchema = z.object({
  type: agreementTypeSchema,
  runId: z.string(),
  stageId: z.string(),
  timestamp: z.string(),
  participants: z.array(agreementParticipantSchema).readonly(),
  reviewedArtifacts: z.array(artifactRefSchema).readonly(),
  findings: z.array(agreementFindingSchema).readonly(),
  unresolvedFindings: z.array(agreementFindingSchema).readonly(),
  approvalStatus: approvalStatusSchema,
  approvalType: approvalTypeSchema,
  conditions: z.string().optional(),
  notes: z.string().optional(),
});
export type AgreementArtifact = z.infer<typeof agreementArtifactSchema>;

export const agreementValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).readonly(),
  warnings: z.array(z.string()).readonly(),
});
export type AgreementValidationResult = z.infer<typeof agreementValidationResultSchema>;

export const agreementGateResultSchema = z.object({
  exists: z.boolean(),
  valid: z.boolean(),
  approvalStatus: approvalStatusSchema.optional(),
  artifactRef: artifactRefSchema.optional(),
  reason: z.string().optional(),
});
export type AgreementGateResult = z.infer<typeof agreementGateResultSchema>;
