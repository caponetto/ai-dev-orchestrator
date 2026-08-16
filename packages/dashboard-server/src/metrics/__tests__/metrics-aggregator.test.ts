import type { MetricEntry } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { aggregateEntries, groupByLabel, percentile } from '../metrics-aggregator';

function entry(value: number, labels: Record<string, string> = {}): MetricEntry {
  return {
    name: 'test',
    type: 'histogram',
    value,
    timestamp: '2025-01-15T10:00:00Z',
    labels,
  };
}

describe('aggregateEntries', () => {
  it('returns null for empty entries', () => {
    expect(aggregateEntries([])).toBeNull();
  });

  it('computes summary for single entry', () => {
    const summary = aggregateEntries([entry(100)]);
    expect(summary).not.toBeNull();
    expect(summary?.count).toBe(1);
    expect(summary?.min).toBe(100);
    expect(summary?.max).toBe(100);
    expect(summary?.mean).toBe(100);
    expect(summary?.total).toBe(100);
  });

  it('computes summary for multiple entries', () => {
    const summary = aggregateEntries([entry(100), entry(200), entry(300)]);
    expect(summary?.count).toBe(3);
    expect(summary?.min).toBe(100);
    expect(summary?.max).toBe(300);
    expect(summary?.mean).toBe(200);
    expect(summary?.total).toBe(600);
  });
});

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('computes p50', () => {
    const values = [10, 20, 30, 40, 50];
    expect(percentile(values, 50)).toBe(30);
  });

  it('computes p99', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 99)).toBe(99);
  });
});

describe('groupByLabel', () => {
  it('groups entries by label', () => {
    const entries = [
      entry(1, { role: 'planner' }),
      entry(2, { role: 'implementer' }),
      entry(3, { role: 'planner' }),
    ];

    const groups = groupByLabel(entries, 'role');
    expect(groups.get('planner')).toHaveLength(2);
    expect(groups.get('implementer')).toHaveLength(1);
  });

  it('uses unknown for missing label', () => {
    const entries = [entry(1)];
    const groups = groupByLabel(entries, 'role');
    expect(groups.get('unknown')).toHaveLength(1);
  });
});
