import type {
  MetricEntry,
  MetricType,
  MetricsSnapshot,
  PerformanceSnapshot,
  TimingMetric,
} from '@ai-dev-orchestrator/schemas';

/** Collects and aggregates runtime metrics across subsystems. */
export interface MetricsCollector {
  /** Record a metric value. */
  record(
    name: string,
    type: MetricType,
    value: number,
    labels?: Readonly<Record<string, string>>,
  ): void;

  /** Increment a counter metric by the given amount (default 1). */
  increment(name: string, amount?: number, labels?: Readonly<Record<string, string>>): void;

  /** Record a timing measurement. */
  timing(metric: TimingMetric): void;

  /** Get a snapshot of all current metrics. */
  snapshot(): MetricsSnapshot;

  /** Get a performance snapshot with timing summaries. */
  performanceSnapshot(): PerformanceSnapshot;

  /** Get all raw entries for a named metric. */
  getEntries(name: string): readonly MetricEntry[];

  /** Reset all collected metrics. */
  reset(): void;
}
