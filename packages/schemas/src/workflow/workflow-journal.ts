import { z } from 'zod/v4';

import { artifactRefSchema } from '../artifacts/artifact-system';
import { escalationReasonSchema, governanceOutcomeSchema } from '../governance/governance';

import { transitionTriggerSchema } from './workflow-engine';

export const JOURNAL_EVENT_TYPES = [
  'run_started',
  'run_completed',
  'run_failed',
  'run_aborted',
  'run_resumed',
  'state_transition',
  'worker_dispatched',
  'worker_completed',
  'worker_failed',
  'worker_retried',
  'script_started',
  'script_completed',
  'artifact_stored',
  'artifact_staleness_detected',
  'governance_decision',
  'agreement_produced',
  'escalation',
  'finding_raised',
  'finding_resolved',
  'human_input_requested',
  'human_input_received',
  'human_approval',
  'human_rejection',
  'error',
  'model_escalation',
] as const;

export const journalEventTypeSchema = z.enum(JOURNAL_EVENT_TYPES);
export type JournalEventType = z.infer<typeof journalEventTypeSchema>;

export const runLifecycleDataSchema = z.object({
  kind: z.literal('run_lifecycle'),
  workflowName: z.string(),
  workflowVersion: z.string(),
  status: z.string().optional(),
  reason: z.string().optional(),
  finalState: z.string().optional(),
});
export type RunLifecycleData = z.infer<typeof runLifecycleDataSchema>;

export const stateTransitionDataSchema = z.object({
  kind: z.literal('state_transition'),
  from: z.string(),
  to: z.string(),
  trigger: transitionTriggerSchema,
  durationMs: z.number(),
  guardsEvaluated: z.number(),
  guardsPassed: z.number(),
  governanceRequired: z.boolean(),
  governanceOutcome: governanceOutcomeSchema.optional(),
  contractId: z.string().optional(),
});
export type StateTransitionData = z.infer<typeof stateTransitionDataSchema>;

export const workerEventDataSchema = z.object({
  kind: z.literal('worker'),
  workerId: z.string(),
  role: z.string(),
  stateId: z.string(),
  status: z.string(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  retryCount: z.number().optional(),
  outputArtifacts: z.array(artifactRefSchema).readonly().optional(),
});
export type WorkerEventData = z.infer<typeof workerEventDataSchema>;

export const artifactEventDataSchema = z.object({
  kind: z.literal('artifact'),
  artifactRef: artifactRefSchema,
  producedBy: z.string(),
  sizeBytes: z.number(),
});
export type ArtifactEventData = z.infer<typeof artifactEventDataSchema>;

export const governanceEventDataSchema = z.object({
  kind: z.literal('governance'),
  outcome: governanceOutcomeSchema,
  reason: z.string(),
  transitionFrom: z.string().optional(),
  transitionTo: z.string().optional(),
  policiesEvaluated: z.number().optional(),
  agreementType: z.string().optional(),
  escalationReason: escalationReasonSchema.optional(),
});
export type GovernanceEventData = z.infer<typeof governanceEventDataSchema>;

export const findingEventDataSchema = z.object({
  kind: z.literal('finding'),
  findingId: z.string(),
  severity: z.string(),
  status: z.string(),
  title: z.string(),
  blocking: z.string(),
  resolvedBy: z.string().optional(),
});
export type FindingEventData = z.infer<typeof findingEventDataSchema>;

export const humanEventDataSchema = z.object({
  kind: z.literal('human'),
  action: z.string(),
  stateId: z.string(),
  reason: z.string().optional(),
  inputType: z.string().optional(),
  approvedBy: z.string().optional(),
  sessionId: z.string().optional(),
});
export type HumanEventData = z.infer<typeof humanEventDataSchema>;

export const errorDataSchema = z.object({
  kind: z.literal('error'),
  errorCode: z.string(),
  message: z.string(),
  stateId: z.string().optional(),
  recoverable: z.boolean(),
});
export type ErrorData = z.infer<typeof errorDataSchema>;

export const artifactStalenessDataSchema = z.object({
  kind: z.literal('artifact_staleness'),
  trigger: z.string(),
  staleCount: z.number(),
  rebuildOrder: z.array(z.string()).readonly(),
});
export type ArtifactStalenessData = z.infer<typeof artifactStalenessDataSchema>;

export const modelEscalationDataSchema = z.object({
  kind: z.literal('model_escalation'),
  fromModel: z.string(),
  toModel: z.string(),
  roleId: z.string(),
  confidenceScore: z.number().min(0).max(1),
  heuristicScore: z.number().min(0).max(1),
  finalScore: z.number().min(0).max(1),
});
export type ModelEscalationData = z.infer<typeof modelEscalationDataSchema>;

export const scriptEventDataSchema = z.object({
  kind: z.literal('script'),
  script: z.string(),
  stateId: z.string(),
  exitCode: z.number().optional(),
  durationMs: z.number().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  success: z.boolean().optional(),
});
export type ScriptEventData = z.infer<typeof scriptEventDataSchema>;

export const journalEventDataSchema = z.discriminatedUnion('kind', [
  runLifecycleDataSchema,
  stateTransitionDataSchema,
  workerEventDataSchema,
  artifactEventDataSchema,
  governanceEventDataSchema,
  findingEventDataSchema,
  humanEventDataSchema,
  errorDataSchema,
  artifactStalenessDataSchema,
  scriptEventDataSchema,
  modelEscalationDataSchema,
]);
export type JournalEventData = z.infer<typeof journalEventDataSchema>;

/** Mapped type -- cannot be expressed as Zod schema. */
export interface JournalEventMap {
  run_started: RunLifecycleData;
  run_completed: RunLifecycleData;
  run_failed: RunLifecycleData;
  run_aborted: RunLifecycleData;
  run_resumed: RunLifecycleData;
  state_transition: StateTransitionData;
  worker_dispatched: WorkerEventData;
  worker_completed: WorkerEventData;
  worker_failed: WorkerEventData;
  worker_retried: WorkerEventData;
  script_started: ScriptEventData;
  script_completed: ScriptEventData;
  artifact_stored: ArtifactEventData;
  artifact_staleness_detected: ArtifactStalenessData;
  governance_decision: GovernanceEventData;
  agreement_produced: GovernanceEventData;
  escalation: GovernanceEventData;
  finding_raised: FindingEventData;
  finding_resolved: FindingEventData;
  human_input_requested: HumanEventData;
  human_input_received: HumanEventData;
  human_approval: HumanEventData;
  human_rejection: HumanEventData;
  error: ErrorData;
  model_escalation: ModelEscalationData;
}

/** Mapped type -- cannot be expressed as Zod schema. */
export type JournalEvent = {
  [K in JournalEventType]: {
    readonly timestamp: string;
    readonly runId: string;
    readonly sequence: number;
    readonly type: K;
    readonly data: JournalEventMap[K];
  };
}[JournalEventType];

export const journalFilterSchema = z.object({
  eventType: journalEventTypeSchema.optional(),
  stateId: z.string().optional(),
  role: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
});
export type JournalFilter = z.infer<typeof journalFilterSchema>;
