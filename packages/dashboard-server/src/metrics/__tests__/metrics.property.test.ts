import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DefaultMetricsCollector } from '../default-metrics-collector';
import { aggregateEntries, percentile } from '../metrics-aggregator';

describe('Metrics property-based tests', () => {
  it('metric recording never loses data (record N values, count equals N)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (count) => {
        const collector = new DefaultMetricsCollector();

        for (let i = 0; i < count; i++) {
          collector.record('test-metric', 'counter', i);
        }

        const entries = collector.getEntries('test-metric');
        expect(entries.length).toBe(count);
      }),
      { numRuns: 500 },
    );
  });

  it('timer durations are non-negative when recorded as non-negative', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 100000, noNaN: true }), {
          minLength: 1,
          maxLength: 20,
        }),
        (durations) => {
          const collector = new DefaultMetricsCollector();

          for (const durationMs of durations) {
            collector.timing({
              subsystem: 'test',
              operation: 'op',
              durationMs,
              startedAt: '2026-01-01T00:00:00.000Z',
              completedAt: '2026-01-01T00:00:01.000Z',
              labels: {},
            });
          }

          const snapshot = collector.performanceSnapshot();
          for (const timing of snapshot.timings) {
            expect(timing.durationMs).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('counter values are monotonically non-decreasing', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 100, noNaN: true }), {
          minLength: 2,
          maxLength: 30,
        }),
        (increments) => {
          const collector = new DefaultMetricsCollector();
          let prevTotal = 0;

          for (const amount of increments) {
            collector.increment('test-counter', amount);
            const entries = collector.getEntries('test-counter');
            const currentTotal = entries.reduce((sum, e) => sum + e.value, 0);
            expect(currentTotal).toBeGreaterThanOrEqual(prevTotal - Number.EPSILON);
            prevTotal = currentTotal;
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('aggregateEntries summary matches recorded values', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        (values) => {
          const collector = new DefaultMetricsCollector();

          for (const v of values) {
            collector.record('agg-test', 'gauge', v);
          }

          const entries = collector.getEntries('agg-test');
          const summary = aggregateEntries(entries);

          expect(summary).not.toBeNull();
          if (summary) {
            expect(summary.count).toBe(values.length);
            expect(summary.min).toBe(Math.min(...values));
            expect(summary.max).toBe(Math.max(...values));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('percentile returns a value within the range of the input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        fc.integer({ min: 0, max: 100 }),
        (values, p) => {
          const result = percentile(values, p);
          expect(result).toBeGreaterThanOrEqual(Math.min(...values));
          expect(result).toBeLessThanOrEqual(Math.max(...values));
        },
      ),
      { numRuns: 200 },
    );
  });
});
