import { z } from 'zod/v4';

import type {
  AgreementProducedData,
  ArtifactInvalidatedData,
  ArtifactStoredData,
  ArtifactVerifiedData,
  CheckpointRestoredData,
  CheckpointSavedData,
  EscalationTriggeredData,
  FindingAcceptedData,
  FindingAddressedData,
  FindingEscalatedData,
  FindingRaisedData,
  FindingRejectedData,
  GovernanceDecisionData,
  HumanApprovalDeniedData,
  HumanApprovalGrantedData,
  HumanClarificationAnsweredData,
  HumanClarificationRequestedData,
  HumanInputReceivedData,
  HumanInputRequestedData,
  HumanPermissionRequestedData,
  HumanPermissionResolvedData,
  HumanTimeoutData,
  PolicyDeniedData,
  PolicyEscalatedData,
  PolicyEvaluatedData,
  RunAbortedData,
  RunCompletedData,
  RunPausedData,
  RunResumedData,
  RunStartedData,
  StateEnteredData,
  StateExitedData,
  SystemErrorData,
  SystemWarningData,
  TransitionCompletedData,
  TransitionDeniedData,
  TransitionRequestedData,
  WorkerCancelledData,
  WorkerCompletedData,
  WorkerDispatchedData,
  WorkerFailedData,
  WorkerRetriedData,
  WorkerTimeoutData,
} from './event-payloads';
import {
  agreementProducedDataSchema,
  artifactInvalidatedDataSchema,
  artifactStoredDataSchema,
  artifactVerifiedDataSchema,
  checkpointRestoredDataSchema,
  checkpointSavedDataSchema,
  escalationTriggeredDataSchema,
  findingAcceptedDataSchema,
  findingAddressedDataSchema,
  findingEscalatedDataSchema,
  findingRaisedDataSchema,
  findingRejectedDataSchema,
  governanceDecisionDataSchema,
  humanApprovalDeniedDataSchema,
  humanApprovalGrantedDataSchema,
  humanClarificationAnsweredDataSchema,
  humanClarificationRequestedDataSchema,
  humanInputReceivedDataSchema,
  humanInputRequestedDataSchema,
  humanPermissionRequestedDataSchema,
  humanPermissionResolvedDataSchema,
  humanTimeoutDataSchema,
  policyDeniedDataSchema,
  policyEscalatedDataSchema,
  policyEvaluatedDataSchema,
  runAbortedDataSchema,
  runCompletedDataSchema,
  runPausedDataSchema,
  runResumedDataSchema,
  runStartedDataSchema,
  stateEnteredDataSchema,
  stateExitedDataSchema,
  systemErrorDataSchema,
  systemWarningDataSchema,
  transitionCompletedDataSchema,
  transitionDeniedDataSchema,
  transitionRequestedDataSchema,
  workerCancelledDataSchema,
  workerCompletedDataSchema,
  workerDispatchedDataSchema,
  workerFailedDataSchema,
  workerRetriedDataSchema,
  workerTimeoutDataSchema,
} from './event-payloads';
import type { EventType } from './event-types';
import { eventSourceSchema } from './event-types';

export * from './event-bus-config';
export * from './event-payloads';
export * from './event-types';

// ---------------------------------------------------------------------------
// Event input schema (discriminated union on `type`)
// ---------------------------------------------------------------------------

const eventInputBase = {
  source: eventSourceSchema,
  correlationId: z.string().optional(),
};

export const eventInputSchema = z.discriminatedUnion('type', [
  z.object({ ...eventInputBase, type: z.literal('run.started'), data: runStartedDataSchema }),
  z.object({ ...eventInputBase, type: z.literal('run.completed'), data: runCompletedDataSchema }),
  z.object({ ...eventInputBase, type: z.literal('run.aborted'), data: runAbortedDataSchema }),
  z.object({ ...eventInputBase, type: z.literal('run.resumed'), data: runResumedDataSchema }),
  z.object({ ...eventInputBase, type: z.literal('run.paused'), data: runPausedDataSchema }),
  z.object({
    ...eventInputBase,
    type: z.literal('state.entered'),
    data: stateEnteredDataSchema,
  }),
  z.object({ ...eventInputBase, type: z.literal('state.exited'), data: stateExitedDataSchema }),
  z.object({
    ...eventInputBase,
    type: z.literal('transition.requested'),
    data: transitionRequestedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('transition.completed'),
    data: transitionCompletedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('transition.denied'),
    data: transitionDeniedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('worker.dispatched'),
    data: workerDispatchedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('worker.completed'),
    data: workerCompletedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('worker.failed'),
    data: workerFailedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('worker.retried'),
    data: workerRetriedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('worker.cancelled'),
    data: workerCancelledDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('worker.timeout'),
    data: workerTimeoutDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('artifact.stored'),
    data: artifactStoredDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('artifact.verified'),
    data: artifactVerifiedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('artifact.invalidated'),
    data: artifactInvalidatedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('governance.decision'),
    data: governanceDecisionDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('governance.agreement_produced'),
    data: agreementProducedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('governance.escalation_triggered'),
    data: escalationTriggeredDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('policy.evaluated'),
    data: policyEvaluatedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('policy.denied'),
    data: policyDeniedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('policy.escalated'),
    data: policyEscalatedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('finding.raised'),
    data: findingRaisedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('finding.addressed'),
    data: findingAddressedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('finding.accepted'),
    data: findingAcceptedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('finding.rejected'),
    data: findingRejectedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('finding.escalated'),
    data: findingEscalatedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('human.input_requested'),
    data: humanInputRequestedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('human.input_received'),
    data: humanInputReceivedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('human.approval_granted'),
    data: humanApprovalGrantedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('human.approval_denied'),
    data: humanApprovalDeniedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('human.timeout'),
    data: humanTimeoutDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('human.permission_requested'),
    data: humanPermissionRequestedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('human.permission_granted'),
    data: humanPermissionResolvedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('human.permission_denied'),
    data: humanPermissionResolvedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('human.clarification_requested'),
    data: humanClarificationRequestedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('human.clarification_answered'),
    data: humanClarificationAnsweredDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('checkpoint.saved'),
    data: checkpointSavedDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('checkpoint.restored'),
    data: checkpointRestoredDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('system.error'),
    data: systemErrorDataSchema,
  }),
  z.object({
    ...eventInputBase,
    type: z.literal('system.warning'),
    data: systemWarningDataSchema,
  }),
]);
export type EventInput = z.infer<typeof eventInputSchema>;

// ---------------------------------------------------------------------------
// Full event schema (discriminated union on `type`)
// ---------------------------------------------------------------------------

const eventEnvelopeBase = {
  source: eventSourceSchema,
  correlationId: z.string().optional(),
  id: z.string(),
  runId: z.string(),
  sequence: z.number(),
  timestamp: z.string(),
};

export const eventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventEnvelopeBase, type: z.literal('run.started'), data: runStartedDataSchema }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('run.completed'),
    data: runCompletedDataSchema,
  }),
  z.object({ ...eventEnvelopeBase, type: z.literal('run.aborted'), data: runAbortedDataSchema }),
  z.object({ ...eventEnvelopeBase, type: z.literal('run.resumed'), data: runResumedDataSchema }),
  z.object({ ...eventEnvelopeBase, type: z.literal('run.paused'), data: runPausedDataSchema }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('state.entered'),
    data: stateEnteredDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('state.exited'),
    data: stateExitedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('transition.requested'),
    data: transitionRequestedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('transition.completed'),
    data: transitionCompletedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('transition.denied'),
    data: transitionDeniedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('worker.dispatched'),
    data: workerDispatchedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('worker.completed'),
    data: workerCompletedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('worker.failed'),
    data: workerFailedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('worker.retried'),
    data: workerRetriedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('worker.cancelled'),
    data: workerCancelledDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('worker.timeout'),
    data: workerTimeoutDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('artifact.stored'),
    data: artifactStoredDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('artifact.verified'),
    data: artifactVerifiedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('artifact.invalidated'),
    data: artifactInvalidatedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('governance.decision'),
    data: governanceDecisionDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('governance.agreement_produced'),
    data: agreementProducedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('governance.escalation_triggered'),
    data: escalationTriggeredDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('policy.evaluated'),
    data: policyEvaluatedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('policy.denied'),
    data: policyDeniedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('policy.escalated'),
    data: policyEscalatedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('finding.raised'),
    data: findingRaisedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('finding.addressed'),
    data: findingAddressedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('finding.accepted'),
    data: findingAcceptedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('finding.rejected'),
    data: findingRejectedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('finding.escalated'),
    data: findingEscalatedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('human.input_requested'),
    data: humanInputRequestedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('human.input_received'),
    data: humanInputReceivedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('human.approval_granted'),
    data: humanApprovalGrantedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('human.approval_denied'),
    data: humanApprovalDeniedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('human.timeout'),
    data: humanTimeoutDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('human.permission_requested'),
    data: humanPermissionRequestedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('human.permission_granted'),
    data: humanPermissionResolvedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('human.permission_denied'),
    data: humanPermissionResolvedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('human.clarification_requested'),
    data: humanClarificationRequestedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('human.clarification_answered'),
    data: humanClarificationAnsweredDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('checkpoint.saved'),
    data: checkpointSavedDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('checkpoint.restored'),
    data: checkpointRestoredDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('system.error'),
    data: systemErrorDataSchema,
  }),
  z.object({
    ...eventEnvelopeBase,
    type: z.literal('system.warning'),
    data: systemWarningDataSchema,
  }),
]);
export type Event = z.infer<typeof eventSchema>;

// ---------------------------------------------------------------------------
// Event handler / typed event helpers
// ---------------------------------------------------------------------------

export type EventHandler = (event: Event) => void | Promise<void>;

/** Mapped type -- cannot be expressed as Zod schema. */
export interface EventMap {
  'run.started': RunStartedData;
  'run.completed': RunCompletedData;
  'run.aborted': RunAbortedData;
  'run.resumed': RunResumedData;
  'run.paused': RunPausedData;
  'state.entered': StateEnteredData;
  'state.exited': StateExitedData;
  'transition.requested': TransitionRequestedData;
  'transition.completed': TransitionCompletedData;
  'transition.denied': TransitionDeniedData;
  'worker.dispatched': WorkerDispatchedData;
  'worker.completed': WorkerCompletedData;
  'worker.failed': WorkerFailedData;
  'worker.retried': WorkerRetriedData;
  'worker.cancelled': WorkerCancelledData;
  'worker.timeout': WorkerTimeoutData;
  'artifact.stored': ArtifactStoredData;
  'artifact.verified': ArtifactVerifiedData;
  'artifact.invalidated': ArtifactInvalidatedData;
  'governance.decision': GovernanceDecisionData;
  'governance.agreement_produced': AgreementProducedData;
  'governance.escalation_triggered': EscalationTriggeredData;
  'policy.evaluated': PolicyEvaluatedData;
  'policy.denied': PolicyDeniedData;
  'policy.escalated': PolicyEscalatedData;
  'finding.raised': FindingRaisedData;
  'finding.addressed': FindingAddressedData;
  'finding.accepted': FindingAcceptedData;
  'finding.rejected': FindingRejectedData;
  'finding.escalated': FindingEscalatedData;
  'human.input_requested': HumanInputRequestedData;
  'human.input_received': HumanInputReceivedData;
  'human.approval_granted': HumanApprovalGrantedData;
  'human.approval_denied': HumanApprovalDeniedData;
  'human.timeout': HumanTimeoutData;
  'human.permission_requested': HumanPermissionRequestedData;
  'human.permission_granted': HumanPermissionResolvedData;
  'human.permission_denied': HumanPermissionResolvedData;
  'human.clarification_requested': HumanClarificationRequestedData;
  'human.clarification_answered': HumanClarificationAnsweredData;
  'checkpoint.saved': CheckpointSavedData;
  'checkpoint.restored': CheckpointRestoredData;
  'system.error': SystemErrorData;
  'system.warning': SystemWarningData;
}

/** Generic mapped type -- cannot be expressed as Zod schema. */
export type TypedEvent<T extends EventType = EventType> = T extends EventType
  ? Omit<Event, 'type' | 'data'> & { readonly type: T; readonly data: EventMap[T] }
  : never;
