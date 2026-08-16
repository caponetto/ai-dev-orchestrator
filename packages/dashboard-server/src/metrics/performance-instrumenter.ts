import type { MetricsCollector } from '@ai-orchestrator/ports';
import type { TimingMetric } from '@ai-orchestrator/schemas';

export class PerformanceInstrumenter {
  constructor(private readonly collector: MetricsCollector) {}

  /** Wrap an async operation with timing instrumentation. */
  async instrument<T>(
    subsystem: string,
    operation: string,
    fn: () => Promise<T>,
    labels: Readonly<Record<string, string>> = {},
  ): Promise<T> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    try {
      const result = await fn();
      this.recordTiming(subsystem, operation, startMs, startedAt, labels);
      return result;
    } catch (e: unknown) {
      this.recordTiming(subsystem, operation, startMs, startedAt, {
        ...labels,
        error: 'true',
      });
      throw e;
    }
  }

  /** Wrap a sync operation with timing instrumentation. */
  instrumentSync<T>(
    subsystem: string,
    operation: string,
    fn: () => T,
    labels: Readonly<Record<string, string>> = {},
  ): T {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    try {
      const result = fn();
      this.recordTiming(subsystem, operation, startMs, startedAt, labels);
      return result;
    } catch (e: unknown) {
      this.recordTiming(subsystem, operation, startMs, startedAt, {
        ...labels,
        error: 'true',
      });
      throw e;
    }
  }

  private recordTiming(
    subsystem: string,
    operation: string,
    startMs: number,
    startedAt: string,
    labels: Readonly<Record<string, string>>,
  ): void {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    const timing: TimingMetric = {
      operation,
      subsystem,
      durationMs,
      startedAt,
      completedAt,
      labels,
    };

    this.collector.timing(timing);
  }
}
