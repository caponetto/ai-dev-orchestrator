import type { MetricsCollector } from '@ai-orchestrator/ports';
import type {
  MetricEntry,
  MetricSummary,
  MetricType,
  MetricsSnapshot,
  PerformanceSnapshot,
  TimingMetric,
} from '@ai-orchestrator/schemas';

interface MetricsCollectorConfig {
  readonly clock?: () => string;
}

export class DefaultMetricsCollector implements MetricsCollector {
  private readonly entries = new Map<string, MetricEntry[]>();
  private readonly timings: TimingMetric[] = [];
  private readonly clock: () => string;

  constructor(config?: MetricsCollectorConfig) {
    this.clock = config?.clock ?? (() => new Date().toISOString());
  }

  record(
    name: string,
    type: MetricType,
    value: number,
    labels: Readonly<Record<string, string>> = {},
  ): void {
    const entry: MetricEntry = {
      name,
      type,
      value,
      timestamp: this.clock(),
      labels,
    };

    if (!this.entries.has(name)) {
      this.entries.set(name, []);
    }
    this.entries.get(name)?.push(entry);
  }

  increment(name: string, amount = 1, labels: Readonly<Record<string, string>> = {}): void {
    this.record(name, 'counter', amount, labels);
  }

  timing(metric: TimingMetric): void {
    this.timings.push(metric);
    this.record(`${metric.subsystem}.${metric.operation}.duration`, 'timer', metric.durationMs, {
      subsystem: metric.subsystem,
      operation: metric.operation,
      ...metric.labels,
    });
  }

  snapshot(): MetricsSnapshot {
    const metrics: MetricSummary[] = [];

    for (const [name, entries] of this.entries) {
      if (entries.length === 0) {
        continue;
      }

      let total = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const e of entries) {
        total += e.value;
        if (e.value < min) {
          min = e.value;
        }
        if (e.value > max) {
          max = e.value;
        }
      }

      metrics.push({
        name,
        type: entries[0].type,
        count: entries.length,
        total,
        min,
        max,
        mean: total / entries.length,
        labels: entries[0].labels,
      });
    }

    return {
      timestamp: this.clock(),
      metrics,
      subsystemHealth: [],
    };
  }

  performanceSnapshot(): PerformanceSnapshot {
    const stageLatencies: Record<string, number> = {};

    for (const t of this.timings) {
      if (t.subsystem === 'workflow-engine') {
        const stage = t.labels['stage'] ?? t.operation;
        stageLatencies[stage] = (stageLatencies[stage] ?? 0) + t.durationMs;
      }
    }

    const workflowTimings = this.timings.filter((t) => t.subsystem === 'workflow-engine');
    const workflowLatencyMs =
      workflowTimings.length > 0 ? workflowTimings.reduce((a, t) => a + t.durationMs, 0) : null;

    return {
      timestamp: this.clock(),
      timings: [...this.timings],
      workflowLatencyMs,
      stageLatencies,
      eventThroughput: this.getEntries('event.published').length,
      memoryUsageBytes: null,
    };
  }

  getEntries(name: string): readonly MetricEntry[] {
    return this.entries.get(name) ?? [];
  }

  reset(): void {
    this.entries.clear();
    this.timings.length = 0;
  }
}
