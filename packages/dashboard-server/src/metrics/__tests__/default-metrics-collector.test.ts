import { describe, expect, it } from 'vitest';

import { DefaultMetricsCollector } from '../default-metrics-collector';

function createCollector(): DefaultMetricsCollector {
  return new DefaultMetricsCollector({ clock: () => '2025-01-15T10:00:00Z' });
}

describe('DefaultMetricsCollector', () => {
  it('records a metric entry', () => {
    const collector = createCollector();
    collector.record('requests', 'counter', 1);
    const entries = collector.getEntries('requests');
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('requests');
    expect(entries[0].value).toBe(1);
  });

  it('increments a counter', () => {
    const collector = createCollector();
    collector.increment('requests');
    collector.increment('requests', 5);
    const entries = collector.getEntries('requests');
    expect(entries).toHaveLength(2);
    expect(entries[0].value).toBe(1);
    expect(entries[1].value).toBe(5);
  });

  it('records timing metrics', () => {
    const collector = createCollector();
    collector.timing({
      operation: 'dispatch',
      subsystem: 'runner-system',
      durationMs: 150,
      startedAt: '2025-01-15T10:00:00Z',
      completedAt: '2025-01-15T10:00:00.150Z',
      labels: { role: 'implementer' },
    });

    const entries = collector.getEntries('runner-system.dispatch.duration');
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe(150);
  });

  it('produces a snapshot with summaries', () => {
    const collector = createCollector();
    collector.record('latency', 'histogram', 100);
    collector.record('latency', 'histogram', 200);
    collector.record('latency', 'histogram', 300);

    const snap = collector.snapshot();
    expect(snap.metrics).toHaveLength(1);
    const summary = snap.metrics[0];
    expect(summary.name).toBe('latency');
    expect(summary.count).toBe(3);
    expect(summary.min).toBe(100);
    expect(summary.max).toBe(300);
    expect(summary.mean).toBe(200);
    expect(summary.total).toBe(600);
  });

  it('produces a performance snapshot', () => {
    const collector = createCollector();
    collector.timing({
      operation: 'transition',
      subsystem: 'workflow-engine',
      durationMs: 50,
      startedAt: '2025-01-15T10:00:00Z',
      completedAt: '2025-01-15T10:00:00.050Z',
      labels: { stage: 'PLANNING' },
    });
    collector.timing({
      operation: 'transition',
      subsystem: 'workflow-engine',
      durationMs: 200,
      startedAt: '2025-01-15T10:00:00Z',
      completedAt: '2025-01-15T10:00:00.200Z',
      labels: { stage: 'CODING' },
    });

    const perf = collector.performanceSnapshot();
    expect(perf.workflowLatencyMs).toBe(250);
    expect(perf.stageLatencies['PLANNING']).toBe(50);
    expect(perf.stageLatencies['CODING']).toBe(200);
  });

  it('returns empty entries for unknown metric', () => {
    const collector = createCollector();
    expect(collector.getEntries('unknown')).toEqual([]);
  });

  it('resets all metrics', () => {
    const collector = createCollector();
    collector.increment('requests', 5);
    collector.timing({
      operation: 'op',
      subsystem: 'sys',
      durationMs: 10,
      startedAt: '',
      completedAt: '',
      labels: {},
    });

    collector.reset();
    expect(collector.getEntries('requests')).toEqual([]);
    expect(collector.snapshot().metrics).toHaveLength(0);
    expect(collector.performanceSnapshot().timings).toHaveLength(0);
  });

  it('records labels correctly', () => {
    const collector = createCollector();
    collector.record('requests', 'counter', 1, { method: 'POST' });
    const entries = collector.getEntries('requests');
    expect(entries[0].labels).toEqual({ method: 'POST' });
  });

  it('includes timestamp in entries', () => {
    const collector = createCollector();
    collector.increment('x');
    expect(collector.getEntries('x')[0].timestamp).toBe('2025-01-15T10:00:00Z');
  });
});
