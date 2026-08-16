import { describe, expect, it } from 'vitest';

import type { RawEvent } from '../event-aggregator';
import { aggregateEvents, countByType, latestByType, toDashboardEvent } from '../event-aggregator';

function raw(type: string, runId = 'run-1', timestamp = '2025-01-15T10:00:00Z'): RawEvent {
  return { type, timestamp, runId, payload: { detail: 'test' } };
}

describe('toDashboardEvent', () => {
  it('maps known event types', () => {
    const event = toDashboardEvent(raw('state.entered'));
    expect(event).not.toBeNull();
    expect(event?.type).toBe('state_changed');
  });

  it('returns null for unknown event types', () => {
    expect(toDashboardEvent(raw('custom.unknown'))).toBeNull();
  });

  it('preserves timestamp and runId', () => {
    const event = toDashboardEvent(raw('artifact.stored', 'run-2', '2025-01-15T11:00:00Z'));
    expect(event?.runId).toBe('run-2');
    expect(event?.timestamp).toBe('2025-01-15T11:00:00Z');
  });
});

describe('aggregateEvents', () => {
  it('filters and converts raw events', () => {
    const events = [raw('state.entered'), raw('custom.unknown'), raw('artifact.stored')];
    const result = aggregateEvents(events);
    expect(result).toHaveLength(2);
  });

  it('filters by runId', () => {
    const events = [raw('state.entered', 'run-1'), raw('state.entered', 'run-2')];
    const result = aggregateEvents(events, { runId: 'run-1' });
    expect(result).toHaveLength(1);
    expect(result[0].runId).toBe('run-1');
  });

  it('filters by dashboard event type', () => {
    const events = [raw('state.entered'), raw('artifact.stored'), raw('worker.dispatched')];
    const result = aggregateEvents(events, { types: ['state_changed'] });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('state_changed');
  });
});

describe('budget threshold event mapping removed', () => {
  it('does not map budget.threshold_crossed after cost removal', () => {
    const event = toDashboardEvent(raw('budget.threshold_crossed'));
    expect(event).toBeNull();
  });
});

describe('countByType', () => {
  it('counts events by type', () => {
    const events = aggregateEvents([
      raw('state.entered'),
      raw('transition.completed'),
      raw('artifact.stored'),
    ]);
    const counts = countByType(events);
    expect(counts['state_changed']).toBe(2);
    expect(counts['artifact_produced']).toBe(1);
  });
});

describe('latestByType', () => {
  it('returns the latest event per type', () => {
    const events = aggregateEvents([
      raw('state.entered', 'run-1', '2025-01-15T10:00:00Z'),
      raw('state.entered', 'run-1', '2025-01-15T10:05:00Z'),
      raw('artifact.stored', 'run-1', '2025-01-15T10:03:00Z'),
    ]);
    const latest = latestByType(events);
    expect(latest['state_changed'].timestamp).toBe('2025-01-15T10:05:00Z');
    expect(latest['artifact_produced'].timestamp).toBe('2025-01-15T10:03:00Z');
  });
});
