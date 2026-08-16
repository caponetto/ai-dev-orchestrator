import { describe, expect, it } from 'vitest';

import { DefaultMetricsCollector } from '../default-metrics-collector';
import { PerformanceInstrumenter } from '../performance-instrumenter';

describe('PerformanceInstrumenter', () => {
  it('instruments an async operation', async () => {
    const collector = new DefaultMetricsCollector();
    const instrumenter = new PerformanceInstrumenter(collector);

    const result = await instrumenter.instrument('test', 'compute', () => {
      return Promise.resolve(42);
    });

    expect(result).toBe(42);
    const entries = collector.getEntries('test.compute.duration');
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBeGreaterThanOrEqual(0);
  });

  it('instruments a sync operation', () => {
    const collector = new DefaultMetricsCollector();
    const instrumenter = new PerformanceInstrumenter(collector);

    const result = instrumenter.instrumentSync('test', 'add', () => 1 + 2);

    expect(result).toBe(3);
    const entries = collector.getEntries('test.add.duration');
    expect(entries).toHaveLength(1);
  });

  it('records timing on error and rethrows', async () => {
    const collector = new DefaultMetricsCollector();
    const instrumenter = new PerformanceInstrumenter(collector);

    await expect(
      instrumenter.instrument('test', 'fail', () => {
        return Promise.reject(new Error('boom'));
      }),
    ).rejects.toThrow('boom');

    const entries = collector.getEntries('test.fail.duration');
    expect(entries).toHaveLength(1);
    expect(entries[0].labels['error']).toBe('true');
  });

  it('records timing on sync error and rethrows', () => {
    const collector = new DefaultMetricsCollector();
    const instrumenter = new PerformanceInstrumenter(collector);

    expect(() =>
      instrumenter.instrumentSync('test', 'fail', () => {
        throw new Error('sync boom');
      }),
    ).toThrow('sync boom');

    const entries = collector.getEntries('test.fail.duration');
    expect(entries).toHaveLength(1);
    expect(entries[0].labels['error']).toBe('true');
  });

  it('passes custom labels', async () => {
    const collector = new DefaultMetricsCollector();
    const instrumenter = new PerformanceInstrumenter(collector);

    await instrumenter.instrument('test', 'op', () => Promise.resolve('ok'), { role: 'planner' });

    const entries = collector.getEntries('test.op.duration');
    expect(entries[0].labels['role']).toBe('planner');
  });
});
