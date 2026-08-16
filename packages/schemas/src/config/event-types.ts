import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'run.started',
  'run.completed',
  'run.aborted',
  'run.resumed',
  'run.paused',
  'state.entered',
  'state.exited',
  'transition.requested',
  'transition.completed',
  'transition.denied',
  'worker.dispatched',
  'worker.completed',
  'worker.failed',
  'worker.retried',
  'worker.cancelled',
  'worker.timeout',
  'artifact.stored',
  'artifact.verified',
  'artifact.invalidated',
  'governance.decision',
  'governance.agreement_produced',
  'governance.escalation_triggered',
  'policy.evaluated',
  'policy.denied',
  'policy.escalated',
  'finding.raised',
  'finding.addressed',
  'finding.accepted',
  'finding.rejected',
  'finding.escalated',
  'human.input_requested',
  'human.input_received',
  'human.approval_granted',
  'human.approval_denied',
  'human.timeout',
  'human.permission_requested',
  'human.permission_granted',
  'human.permission_denied',
  'human.clarification_requested',
  'human.clarification_answered',
  'checkpoint.saved',
  'checkpoint.restored',
  'system.error',
  'system.warning',
] as const;

export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

// ---------------------------------------------------------------------------
// Event sources
// ---------------------------------------------------------------------------

export const EVENT_SOURCES = [
  'workflow_engine',
  'runner_system',
  'governance',
  'policy_engine',
  'artifact_system',
  'state_persistence',
  'human_interaction',
  'provider',
  'system',
] as const;

export const eventSourceSchema = z.enum(EVENT_SOURCES);
export type EventSource = z.infer<typeof eventSourceSchema>;
