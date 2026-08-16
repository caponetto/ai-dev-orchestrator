import { z } from 'zod/v4';

import { artifactRefSchema } from '../artifacts/artifact-system';
import { runIdSchema } from '../shared/shared';
import { liveRequestKindSchema, sessionTransportSchema } from '../shared/string-enums';

export const budgetExhaustionContextSchema = z.object({
  limitType: z.literal('token'),
  current: z.number(),
  limit: z.number(),
  role: z.string().optional(),
  cumulativeTokens: z.number(),
});
export type BudgetExhaustionContext = z.infer<typeof budgetExhaustionContextSchema>;

export const persistedWaitingContextSchema = z.object({
  reason: z.string(),
  requiredInput: z.string(),
  requestingState: z.string(),
  autoResumeSafe: z.boolean(),
  presentedArtifacts: z.array(artifactRefSchema).readonly(),
  waitingSince: z.string(),
  budgetExhaustion: budgetExhaustionContextSchema.optional(),
  liveSessionId: z.string().optional(),
  pendingRequestId: z.string().optional(),
  liveRequestType: liveRequestKindSchema.optional(),
  sessionTransport: sessionTransportSchema.optional(),
});
export type PersistedWaitingContext = z.infer<typeof persistedWaitingContextSchema>;

export const persistedStateSchema = z.object({
  runId: runIdSchema,
  schemaVersion: z.number(),
  repoRoot: z.string().optional(),
  currentState: z.string(),
  previousState: z.string().nullable(),
  stateEnteredAt: z.string(),
  transitionCount: z.number(),
  stateHistory: z.array(z.string()).readonly(),
  iterationCounts: z.record(z.string(), z.number()),
  judgeArbitrationCounts: z.record(z.string(), z.number()).optional(),
  activeArtifacts: z.array(artifactRefSchema).readonly(),
  lastProducedArtifact: artifactRefSchema.nullable(),
  waitingContext: persistedWaitingContextSchema.optional(),
  workflowName: z.string(),
  workflowVersion: z.string(),
  persistedAt: z.string(),
  persistenceVersion: z.number(),
  checksum: z.string(),
  cumulativeInputTokens: z.number().optional(),
  cumulativeOutputTokens: z.number().optional(),
  hasReceivedUsage: z.boolean().optional(),
  governanceDecisionCount: z.number().optional(),
  escalationCount: z.number().optional(),
  workerMetricsByRole: z
    .record(
      z.string(),
      z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        dispatches: z.number(),
        durationMs: z.number(),
        artifactsProduced: z.number(),
      }),
    )
    .optional(),
  dispatchCounter: z.number().optional(),
  firedThresholdIndex: z.number().optional(),
  lastHumanFeedback: z.string().optional(),
  lastReviewContent: z.string().optional(),
  lastTrigger: z.string().optional(),
  stateTimestamps: z
    .array(
      z.object({
        stateId: z.string(),
        enteredAt: z.string(),
        exitedAt: z.string(),
      }),
    )
    .readonly()
    .optional(),
});
export type PersistedState = z.infer<typeof persistedStateSchema>;

export const stateValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).readonly(),
  warnings: z.array(z.string()).readonly(),
});
export type StateValidationResult = z.infer<typeof stateValidationResultSchema>;

export const lockHandleSchema = z.object({
  runId: runIdSchema,
  pid: z.number(),
  acquiredAt: z.string(),
  lockPath: z.string(),
  hostname: z.string(),
});
export type LockHandle = z.infer<typeof lockHandleSchema>;
