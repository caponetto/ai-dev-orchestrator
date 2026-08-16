/** Computes summaries from raw metric entries. */
import type { MetricEntry, MetricSummary } from '@ai-orchestrator/schemas';
export function aggregateEntries(entries: readonly MetricEntry[]): MetricSummary | null {
  if (entries.length === 0) {
    return null;
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

  return {
    name: entries[0].name,
    type: entries[0].type,
    count: entries.length,
    total,
    min,
    max,
    mean: total / entries.length,
    labels: entries[0].labels,
  };
}

/** Compute percentile from sorted values. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/** Group entries by a label value. */
export function groupByLabel(
  entries: readonly MetricEntry[],
  labelKey: string,
): ReadonlyMap<string, readonly MetricEntry[]> {
  const groups = new Map<string, MetricEntry[]>();
  for (const entry of entries) {
    const key = entry.labels[labelKey] ?? 'unknown';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(entry);
  }
  return groups;
}
