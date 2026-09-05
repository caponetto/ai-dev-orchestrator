/** Raw event from the event bus before mapping to dashboard event. */
import type { DashboardEvent, DashboardEventType } from '@ai-dev-orchestrator/schemas';
export interface RawEvent {
  readonly type: string;
  readonly timestamp: string;
  readonly runId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

const EVENT_TYPE_MAP: Readonly<Record<string, DashboardEventType>> = {
  'run.started': 'run_started',
  'state.entered': 'state_changed',
  'state.exited': 'state_changed',
  'transition.completed': 'state_changed',
  'artifact.stored': 'artifact_produced',
  'finding.raised': 'finding_added',
  'finding.accepted': 'finding_resolved',
  'finding.addressed': 'finding_resolved',
  'worker.dispatched': 'worker_dispatched',
  'worker.completed': 'worker_completed',
  'script.started': 'script_started',
  'script.completed': 'script_completed',
  'run.completed': 'run_completed',
  'run.aborted': 'run_aborted',
};

/** Convert a raw event to a dashboard event, filtering unrecognized types. */
export function toDashboardEvent(raw: RawEvent): DashboardEvent | null {
  const dashboardType = EVENT_TYPE_MAP[raw.type] as DashboardEventType | undefined;
  if (!dashboardType) {
    return null;
  }

  return {
    type: dashboardType,
    timestamp: raw.timestamp,
    runId: raw.runId,
    data: raw.payload,
  };
}

/** Filter and transform raw events to dashboard events with optional filtering. */
export function aggregateEvents(
  rawEvents: readonly RawEvent[],
  filter?: { readonly runId?: string; readonly types?: readonly DashboardEventType[] },
): readonly DashboardEvent[] {
  const result: DashboardEvent[] = [];

  for (const raw of rawEvents) {
    const event = toDashboardEvent(raw);
    if (!event) {
      continue;
    }
    if (filter?.runId && event.runId !== filter.runId) {
      continue;
    }
    if (filter?.types && !filter.types.includes(event.type)) {
      continue;
    }
    result.push(event);
  }

  return result;
}

/** Count events by type. */
export function countByType(events: readonly DashboardEvent[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
  }
  return counts;
}

/** Get the most recent event of each type. */
export function latestByType(
  events: readonly DashboardEvent[],
): Readonly<Record<string, DashboardEvent>> {
  const latest: Record<string, DashboardEvent> = {};
  for (const e of events) {
    const existing = latest[e.type] as DashboardEvent | undefined;
    if (!existing || e.timestamp > existing.timestamp) {
      latest[e.type] = e;
    }
  }
  return latest;
}
