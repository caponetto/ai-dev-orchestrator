import { z } from 'zod/v4';

import { approvalStatusSchema } from '../artifacts/agreement-artifacts';
import { artifactRefSchema } from '../artifacts/artifact-system';
import {
  escalationTriggerSchema,
  governanceOutcomeSchema,
  policyCheckOutcomeSchema,
} from '../governance/governance';
import { policyOutcomeSchema } from '../governance/policy-engine';
import { threeTierSeveritySchema } from '../shared/string-enums';

// ---------------------------------------------------------------------------
// Run payload schemas
// ---------------------------------------------------------------------------

export const runStartedDataSchema = z.object({
  config: z.object({
    workflow: z.string(),
    variant: z.string().optional(),
    repository: z.string(),
    sourceType: z.string(),
  }),
  tokenBudget: z.number().optional(),
});
export type RunStartedData = z.infer<typeof runStartedDataSchema>;

export const runCompletedDataSchema = z.object({
  outcome: z.enum(['success', 'partial', 'failed']),
  reason: z.string().optional(),
  artifactCount: z.number(),
  totalDurationMs: z.number(),
  totalTokens: z.object({ input: z.number(), output: z.number() }),
});
export type RunCompletedData = z.infer<typeof runCompletedDataSchema>;

export const runAbortedDataSchema = z.object({
  reason: z.string(),
  abortedBy: z.enum(['user', 'governance', 'system', 'policy']),
  lastState: z.string(),
});
export type RunAbortedData = z.infer<typeof runAbortedDataSchema>;

export const runResumedDataSchema = z.object({
  resumedFromState: z.string(),
  checkpointTimestamp: z.string(),
  eventsReplayed: z.number(),
});
export type RunResumedData = z.infer<typeof runResumedDataSchema>;

export const runPausedDataSchema = z.object({
  reason: z.enum(['human_input_required', 'rate_limited', 'manual']),
  pausedInState: z.string(),
});
export type RunPausedData = z.infer<typeof runPausedDataSchema>;

// ---------------------------------------------------------------------------
// State payload schemas
// ---------------------------------------------------------------------------

export const stateEnteredDataSchema = z.object({
  stateId: z.string(),
  stateType: z.string(),
  entryActionsCount: z.number(),
});
export type StateEnteredData = z.infer<typeof stateEnteredDataSchema>;

export const stateExitedDataSchema = z.object({
  stateId: z.string(),
  durationMs: z.number(),
});
export type StateExitedData = z.infer<typeof stateExitedDataSchema>;

// ---------------------------------------------------------------------------
// Transition payload schemas
// ---------------------------------------------------------------------------

export const transitionRequestedDataSchema = z.object({
  from: z.string(),
  to: z.string(),
  trigger: z.string(),
  guardsToEvaluate: z.number(),
});
export type TransitionRequestedData = z.infer<typeof transitionRequestedDataSchema>;

export const transitionCompletedDataSchema = z.object({
  from: z.string(),
  to: z.string(),
  trigger: z.string(),
  guardsEvaluated: z.number(),
  guardsPassed: z.number(),
  governanceConsulted: z.boolean(),
  durationMs: z.number(),
});
export type TransitionCompletedData = z.infer<typeof transitionCompletedDataSchema>;

export const transitionDeniedDataSchema = z.object({
  from: z.string(),
  to: z.string(),
  trigger: z.string(),
  deniedBy: z.enum(['guard', 'governance', 'policy']),
  reason: z.string(),
});
export type TransitionDeniedData = z.infer<typeof transitionDeniedDataSchema>;

// ---------------------------------------------------------------------------
// Worker payload schemas
// ---------------------------------------------------------------------------

export const workerDispatchedDataSchema = z.object({
  workerId: z.string(),
  role: z.string(),
  model: z.string(),
  inputArtifacts: z.array(artifactRefSchema).readonly(),
});
export type WorkerDispatchedData = z.infer<typeof workerDispatchedDataSchema>;

export const workerCompletedDataSchema = z.object({
  workerId: z.string(),
  role: z.string(),
  model: z.string(),
  outputArtifacts: z.array(artifactRefSchema).readonly(),
  durationMs: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  repairAttempts: z.number(),
});
export type WorkerCompletedData = z.infer<typeof workerCompletedDataSchema>;

export const workerFailedDataSchema = z.object({
  workerId: z.string(),
  role: z.string(),
  error: z.string(),
  errorCategory: z.enum(['agent_error', 'validation_error', 'timeout', 'cancelled', 'unknown']),
  durationMs: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  willRetry: z.boolean(),
});
export type WorkerFailedData = z.infer<typeof workerFailedDataSchema>;

export const workerRetriedDataSchema = z.object({
  workerId: z.string(),
  role: z.string(),
  attempt: z.number(),
  maxAttempts: z.number(),
  retryReason: z.string(),
  backoffMs: z.number(),
});
export type WorkerRetriedData = z.infer<typeof workerRetriedDataSchema>;

export const workerCancelledDataSchema = z.object({
  workerId: z.string(),
  role: z.string(),
  cancelledBy: z.enum(['user', 'governance', 'timeout', 'system']),
  reason: z.string(),
});
export type WorkerCancelledData = z.infer<typeof workerCancelledDataSchema>;

export const workerTimeoutDataSchema = z.object({
  workerId: z.string(),
  role: z.string(),
  timeoutMs: z.number(),
  elapsedMs: z.number(),
});
export type WorkerTimeoutData = z.infer<typeof workerTimeoutDataSchema>;

// ---------------------------------------------------------------------------
// Artifact payload schemas
// ---------------------------------------------------------------------------

export const artifactStoredDataSchema = z.object({
  artifactRef: artifactRefSchema,
  producedBy: z.string(),
  sizeBytes: z.number(),
  predecessorRef: artifactRefSchema.optional(),
});
export type ArtifactStoredData = z.infer<typeof artifactStoredDataSchema>;

export const artifactVerifiedDataSchema = z.object({
  artifactRef: artifactRefSchema,
  integrityValid: z.boolean(),
  expectedChecksum: z.string(),
  actualChecksum: z.string(),
});
export type ArtifactVerifiedData = z.infer<typeof artifactVerifiedDataSchema>;

export const artifactInvalidatedDataSchema = z.object({
  artifactRef: artifactRefSchema,
  reason: z.enum(['upstream_changed', 'manual', 'policy']),
  invalidatedBy: z.string(),
});
export type ArtifactInvalidatedData = z.infer<typeof artifactInvalidatedDataSchema>;

// ---------------------------------------------------------------------------
// Governance payload schemas
// ---------------------------------------------------------------------------

export const governanceDecisionDataSchema = z.object({
  transition: z.object({ from: z.string(), to: z.string() }),
  decision: governanceOutcomeSchema,
  policiesEvaluated: z.array(z.string()).readonly(),
  policyResults: z
    .array(
      z.object({
        policyType: z.string(),
        outcome: policyCheckOutcomeSchema,
        reason: z.string().optional(),
      }),
    )
    .readonly(),
  reason: z.string(),
});
export type GovernanceDecisionData = z.infer<typeof governanceDecisionDataSchema>;

export const agreementProducedDataSchema = z.object({
  agreementType: z.string(),
  artifactRef: artifactRefSchema,
  participantCount: z.number(),
  findingsCount: z.number(),
  verdict: approvalStatusSchema,
});
export type AgreementProducedData = z.infer<typeof agreementProducedDataSchema>;

export const escalationTriggeredDataSchema = z.object({
  trigger: escalationTriggerSchema,
  currentState: z.string(),
  iterationCount: z.number(),
  escalationContextRef: artifactRefSchema,
});
export type EscalationTriggeredData = z.infer<typeof escalationTriggeredDataSchema>;

// ---------------------------------------------------------------------------
// Policy payload schemas
// ---------------------------------------------------------------------------

export const policyEvaluatedDataSchema = z.object({
  policyCount: z.number(),
  passCount: z.number(),
  failCount: z.number(),
  skipCount: z.number(),
  overallOutcome: policyOutcomeSchema,
});
export type PolicyEvaluatedData = z.infer<typeof policyEvaluatedDataSchema>;

export const policyDeniedDataSchema = z.object({
  policyType: z.string(),
  reason: z.string(),
  remediations: z.array(z.string()).readonly(),
});
export type PolicyDeniedData = z.infer<typeof policyDeniedDataSchema>;

export const policyEscalatedDataSchema = z.object({
  policyType: z.string(),
  reason: z.string(),
  escalationTarget: z.enum(['human', 'governance']),
});
export type PolicyEscalatedData = z.infer<typeof policyEscalatedDataSchema>;

// ---------------------------------------------------------------------------
// Finding payload schemas
// ---------------------------------------------------------------------------

export const findingRaisedDataSchema = z.object({
  findingId: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  category: z.string(),
  title: z.string(),
  reviewArtifact: artifactRefSchema,
});
export type FindingRaisedData = z.infer<typeof findingRaisedDataSchema>;

export const findingAddressedDataSchema = z.object({
  findingId: z.string(),
  resolutionType: z.enum(['fixed', 'acknowledged', 'wont_fix', 'deferred']),
  implementationArtifact: artifactRefSchema,
});
export type FindingAddressedData = z.infer<typeof findingAddressedDataSchema>;

export const findingAcceptedDataSchema = z.object({
  findingId: z.string(),
  acceptedBy: z.string(),
});
export type FindingAcceptedData = z.infer<typeof findingAcceptedDataSchema>;

export const findingRejectedDataSchema = z.object({
  findingId: z.string(),
  rejectedBy: z.string(),
  reason: z.string(),
});
export type FindingRejectedData = z.infer<typeof findingRejectedDataSchema>;

export const findingEscalatedDataSchema = z.object({
  findingId: z.string(),
  reason: z.string(),
  escalationContextRef: artifactRefSchema,
});
export type FindingEscalatedData = z.infer<typeof findingEscalatedDataSchema>;

// ---------------------------------------------------------------------------
// Human interaction payload schemas
// ---------------------------------------------------------------------------

export const humanInputRequestedDataSchema = z.object({
  requestType: z.enum(['clarification', 'approval', 'decision', 'review']),
  context: z.string(),
  currentState: z.string(),
  timeoutMs: z.number().optional(),
});
export type HumanInputRequestedData = z.infer<typeof humanInputRequestedDataSchema>;

export const humanInputReceivedDataSchema = z.object({
  requestType: z.string(),
  responseTimeMs: z.number(),
  inputSizeChars: z.number(),
});
export type HumanInputReceivedData = z.infer<typeof humanInputReceivedDataSchema>;

export const humanApprovalGrantedDataSchema = z.object({
  approvalType: z.string(),
  conditions: z.array(z.string()).readonly().optional(),
  artifactRef: artifactRefSchema.optional(),
});
export type HumanApprovalGrantedData = z.infer<typeof humanApprovalGrantedDataSchema>;

export const humanApprovalDeniedDataSchema = z.object({
  approvalType: z.string(),
  reason: z.string(),
  artifactRef: artifactRefSchema.optional(),
});
export type HumanApprovalDeniedData = z.infer<typeof humanApprovalDeniedDataSchema>;

export const humanTimeoutDataSchema = z.object({
  requestType: z.string(),
  timeoutMs: z.number(),
  fallbackAction: z.enum(['abort', 'escalate', 'continue_with_default']),
});
export type HumanTimeoutData = z.infer<typeof humanTimeoutDataSchema>;

export const humanPermissionRequestedDataSchema = z.object({
  runId: z.string(),
  messageId: z.string(),
  action: z.string(),
  resource: z.string(),
  riskLevel: threeTierSeveritySchema,
  reasoning: z.string().optional(),
});
export type HumanPermissionRequestedData = z.infer<typeof humanPermissionRequestedDataSchema>;

export const humanPermissionResolvedDataSchema = z.object({
  runId: z.string(),
  messageId: z.string(),
  granted: z.boolean(),
});
export type HumanPermissionResolvedData = z.infer<typeof humanPermissionResolvedDataSchema>;

export const humanClarificationRequestedDataSchema = z.object({
  runId: z.string(),
  messageId: z.string(),
  question: z.string(),
  context: z.string().optional(),
});
export type HumanClarificationRequestedData = z.infer<typeof humanClarificationRequestedDataSchema>;

export const humanClarificationAnsweredDataSchema = z.object({
  runId: z.string(),
  messageId: z.string(),
  answer: z.string(),
});
export type HumanClarificationAnsweredData = z.infer<typeof humanClarificationAnsweredDataSchema>;

// ---------------------------------------------------------------------------
// Checkpoint payload schemas
// ---------------------------------------------------------------------------

export const checkpointSavedDataSchema = z.object({
  checkpointId: z.string(),
  currentState: z.string(),
  artifactCount: z.number(),
  sizeBytes: z.number(),
});
export type CheckpointSavedData = z.infer<typeof checkpointSavedDataSchema>;

export const checkpointRestoredDataSchema = z.object({
  checkpointId: z.string(),
  restoredToState: z.string(),
  eventsSinceCheckpoint: z.number(),
});
export type CheckpointRestoredData = z.infer<typeof checkpointRestoredDataSchema>;

// ---------------------------------------------------------------------------
// System payload schemas
// ---------------------------------------------------------------------------

export const systemErrorDataSchema = z.object({
  component: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
  stack: z.string().optional(),
});
export type SystemErrorData = z.infer<typeof systemErrorDataSchema>;

export const systemWarningDataSchema = z.object({
  component: z.string(),
  message: z.string(),
  suggestion: z.string().optional(),
});
export type SystemWarningData = z.infer<typeof systemWarningDataSchema>;
