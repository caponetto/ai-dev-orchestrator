import { z } from 'zod/v4';

import { artifactRefSchema, artifactTypeSchema } from '../artifacts/artifact-system';
import { findingSchema } from '../governance/review-resolution';
import { runIdSchema } from '../shared/shared';
import {
  type AgentStreamEventType,
  outputFormatSchema,
  sessionTransportSchema,
  threeTierSeveritySchema,
} from '../shared/string-enums';

import {
  agentConfigSchema,
  modelAssignmentSchema,
  roleContractSchema,
  roleIdSchema,
} from './role-system';

// ---------------------------------------------------------------------------
// Agent session types
// ---------------------------------------------------------------------------

export const agentSessionStateSchema = z.enum([
  'running',
  'awaiting_human',
  'paused',
  'reconnecting',
  'completed',
  'failed',
  'aborted',
  'orphaned',
]);
export type AgentSessionState = z.infer<typeof agentSessionStateSchema>;

export const agentSessionRefSchema = z.object({
  sessionId: z.string(),
  runId: z.string(),
  stateId: z.string(),
  role: roleIdSchema,
  transport: sessionTransportSchema,
});
export type AgentSessionRef = z.infer<typeof agentSessionRefSchema>;

export const permissionPayloadSchema = z
  .object({
    action: z.string(),
    resource: z.string(),
    detail: z.string().optional(),
    riskLevel: threeTierSeveritySchema.optional(),
    externalRequestId: z.string().optional(),
    toolInput: z.string().optional(),
    granted: z.boolean().optional(),
    reason: z.string().optional(),
    timedOut: z.boolean().optional(),
    aborted: z.boolean().optional(),
  })
  .catchall(z.unknown());
export type PermissionPayload = z.infer<typeof permissionPayloadSchema>;

export const clarificationPayloadSchema = z
  .object({
    question: z.string(),
    context: z.string().optional(),
    options: z.array(z.string()).readonly().optional(),
    answer: z.string().optional(),
  })
  .catchall(z.unknown());
export type ClarificationPayload = z.infer<typeof clarificationPayloadSchema>;

export const sessionPendingRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    requestId: z.string(),
    kind: z.literal('permission'),
    createdAt: z.string(),
    payload: permissionPayloadSchema,
  }),
  z.object({
    requestId: z.string(),
    kind: z.literal('clarification'),
    createdAt: z.string(),
    payload: clarificationPayloadSchema,
  }),
]);
export type SessionPendingRequest = z.infer<typeof sessionPendingRequestSchema>;

export const stdioReconnectMetaSchema = z.object({
  type: z.literal('stdio'),
  pid: z.number(),
  socketPath: z.string().optional(),
});
export type StdioReconnectMeta = z.infer<typeof stdioReconnectMetaSchema>;

export const remoteReconnectMetaSchema = z.object({
  type: z.literal('remote'),
  remoteSessionId: z.string(),
  reconnectUrl: z.string(),
  websocketUrl: z.string().optional(),
  leaseExpiresAt: z.string().optional(),
  heartbeatIntervalMs: z.number().optional(),
  authHeader: z.string().optional(),
});
export type RemoteReconnectMeta = z.infer<typeof remoteReconnectMetaSchema>;

export const reconnectMetaSchema = z.discriminatedUnion('type', [
  stdioReconnectMetaSchema,
  remoteReconnectMetaSchema,
]);
export type ReconnectMeta = z.infer<typeof reconnectMetaSchema>;

export const agentSessionSnapshotSchema = z.object({
  ref: agentSessionRefSchema,
  state: agentSessionStateSchema,
  pendingRequests: z.array(sessionPendingRequestSchema).readonly(),
  lastProtocolTimestamp: z.string(),
  reconnect: reconnectMetaSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().optional(),
  workerId: z.string().optional(),
  error: z.string().optional(),
});
export type AgentSessionSnapshot = z.infer<typeof agentSessionSnapshotSchema>;

export const agentSessionHandleSchema = z.object({
  ref: agentSessionRefSchema,
  state: agentSessionStateSchema,
  pendingRequests: z.array(sessionPendingRequestSchema).readonly(),
});
export type AgentSessionHandle = z.infer<typeof agentSessionHandleSchema>;

export const sessionDispatchOutcomeSchema = z.enum([
  'completed',
  'awaiting_human',
  'session_active',
]);
export type SessionDispatchOutcome = z.infer<typeof sessionDispatchOutcomeSchema>;

// ---------------------------------------------------------------------------
// Main runner-system types
// ---------------------------------------------------------------------------

export const resolvedArtifactSchema = z.object({
  ref: artifactRefSchema,
  content: z.string(),
});
export type ResolvedArtifact = z.infer<typeof resolvedArtifactSchema>;

export const workerOutputFormatSchema = outputFormatSchema;
export type WorkerOutputFormat = z.infer<typeof workerOutputFormatSchema>;

export const workerConstraintsSchema = z.object({
  maxOutputTokens: z.number(),
  timeout: z.number(),
  requiredOutputType: artifactTypeSchema,
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  outputFormat: workerOutputFormatSchema.optional(),
});
export type WorkerConstraints = z.infer<typeof workerConstraintsSchema>;

export type StreamEventCallback = (event: {
  timestamp: string;
  type: AgentStreamEventType;
  content: string;
  structuredData?: Record<string, unknown>;
  requestMessageId?: string;
}) => void;

export const dispatchOverridesSchema = z.object({
  model: modelAssignmentSchema.optional(),
  timeout: z.number().optional(),
  maxRetries: z.number().optional(),
});
export type DispatchOverrides = z.infer<typeof dispatchOverridesSchema>;

export const dispatchRequestSchema = z.object({
  runId: runIdSchema,
  stateId: z.string(),
  role: roleIdSchema,
  inputArtifacts: z.array(artifactRefSchema).readonly(),
  overrides: dispatchOverridesSchema.optional(),
  humanFeedback: z.string().optional(),
  userPrompt: z.string().optional(),
  previousReviewContent: z.string().optional(),
  structuredFindings: z.array(findingSchema).readonly().optional(),
  iterationCount: z.number().optional(),
  variableOverrides: z.record(z.string(), z.string()).optional(),
});
export type DispatchRequest = z.infer<typeof dispatchRequestSchema>;

export const workerErrorTypeSchema = z.enum([
  'agent_error',
  'timeout',
  'invalid_output',
  'schema_violation',
  'ownership_violation',
  'cancelled',
]);
export type WorkerErrorType = z.infer<typeof workerErrorTypeSchema>;

export const workerErrorSchema = z.object({
  type: workerErrorTypeSchema,
  message: z.string(),
  retryable: z.boolean(),
});
export type WorkerError = z.infer<typeof workerErrorSchema>;

export const workerMetricsSchema = z.object({
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  retryCount: z.number(),
  modelUsed: z.string(),
});
export type WorkerMetrics = z.infer<typeof workerMetricsSchema>;

export const dispatchStatusSchema = z.enum(['success', 'failure', 'timeout', 'cancelled']);
export type DispatchStatus = z.infer<typeof dispatchStatusSchema>;

export const dispatchResultSchema = z.object({
  workerId: z.string(),
  role: roleIdSchema,
  status: dispatchStatusSchema,
  outputArtifacts: z.array(artifactRefSchema).readonly(),
  error: workerErrorSchema.optional(),
  metrics: workerMetricsSchema,
  sessionOutcome: sessionDispatchOutcomeSchema.optional(),
  sessionRef: agentSessionRefSchema.optional(),
  pendingRequest: sessionPendingRequestSchema.optional(),
});
export type DispatchResult = z.infer<typeof dispatchResultSchema>;

export const workerStatusSchema = z.object({
  workerId: z.string(),
  role: roleIdSchema,
  state: z.enum(['pending', 'running', 'completed', 'failed', 'timed-out']),
  startedAt: z.string(),
  elapsedMs: z.number(),
});
export type WorkerStatus = z.infer<typeof workerStatusSchema>;

export const workerContextSchema = z.object({
  role: roleContractSchema,
  prompt: z.string(),
  inputArtifacts: z.array(resolvedArtifactSchema).readonly(),
  modelAssignment: modelAssignmentSchema,
  constraints: workerConstraintsSchema,
});
export type WorkerContext = z.infer<typeof workerContextSchema>;

export const workerInvocationRecordSchema = z.object({
  timestamp: z.string(),
  runId: runIdSchema,
  workerId: z.string(),
  stateId: z.string(),
  role: roleIdSchema,
  model: z.string(),
  inputArtifacts: z.array(artifactRefSchema).readonly(),
  outputArtifacts: z.array(artifactRefSchema).readonly(),
  status: dispatchStatusSchema,
  metrics: workerMetricsSchema,
  error: workerErrorSchema.optional(),
});
export type WorkerInvocationRecord = z.infer<typeof workerInvocationRecordSchema>;

export const retryPolicySchema = z.object({
  maxRetries: z.number(),
  initialDelayMs: z.number(),
  maxDelayMs: z.number(),
  backoffMultiplier: z.number(),
});
export type RetryPolicy = z.infer<typeof retryPolicySchema>;

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

export const agentConstraintsSchema = z.object({
  timeout: z.number(),
  requiredOutputType: artifactTypeSchema,
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  outputFormat: workerOutputFormatSchema.optional(),
});
export type AgentConstraints = z.infer<typeof agentConstraintsSchema>;

export const agentTaskSchema = z.object({
  taskId: z.string(),
  runId: z.string(),
  stateId: z.string(),
  role: roleIdSchema,
  description: z.string(),
  inputArtifacts: z.array(resolvedArtifactSchema).readonly(),
  repoRoot: z.string(),
  runDir: z.string(),
  outputArtifactPath: z.string(),
  constraints: agentConstraintsSchema,
  instructions: z.string().optional(),
  rolePrompt: z.string().optional(),
  agentConfig: agentConfigSchema.optional(),
  modelHint: z.string().optional(),
  humanFeedback: z.string().optional(),
  userPrompt: z.string().optional(),
  previousFindings: z.string().optional(),
  iterationCount: z.number().optional(),
});
export type AgentTask = z.infer<typeof agentTaskSchema>;

export const agentTokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
});
export type AgentTokenUsage = z.infer<typeof agentTokenUsageSchema>;

export const agentResultSchema = z.object({
  taskId: z.string(),
  status: z.enum(['success', 'failure', 'timeout']),
  artifactContent: z.string().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
  tokenUsage: agentTokenUsageSchema.optional(),
});
export type AgentResult = z.infer<typeof agentResultSchema>;

// ---------------------------------------------------------------------------
// Live response payload schemas (for human-in-the-loop responses)
// ---------------------------------------------------------------------------

export const livePermissionResponsePayloadSchema = z
  .object({
    granted: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .loose();
export type LivePermissionResponsePayload = z.infer<typeof livePermissionResponsePayloadSchema>;

export const liveClarificationResponsePayloadSchema = z
  .object({
    answer: z.string().optional(),
  })
  .loose();
export type LiveClarificationResponsePayload = z.infer<
  typeof liveClarificationResponsePayloadSchema
>;

// ---------------------------------------------------------------------------
// HTTP agent runner response schemas
// ---------------------------------------------------------------------------

export const submitResponseSchema = z.object({ taskId: z.string() }).loose();
export type SubmitResponse = z.infer<typeof submitResponseSchema>;

export const pollResponseSchema = z
  .object({
    status: z.enum(['running', 'completed', 'failed']),
    result: agentResultSchema.optional(),
    error: z.string().optional(),
  })
  .loose();
export type PollResponse = z.infer<typeof pollResponseSchema>;
