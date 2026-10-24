import type { ActionResult } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { ExecutionAccounting } from '../execution-accounting';

function result(inputTokens: number, outputTokens: number): ActionResult {
  return {
    action: { type: 'dispatch_worker', params: { role: 'planner' } },
    success: true,
    usageSnapshot: {
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
      byRole: { planner: { inputTokens, outputTokens, durationMs: 10 } },
    },
  };
}

describe('execution accounting', () => {
  it('combines usage and worker failures without requiring a usage snapshot for failures', () => {
    const accounting = new ExecutionAccounting();
    accounting.record([
      result(10, 5),
      result(7, 3),
      {
        action: { type: 'dispatch_parallel_workers', params: { roles: ['planner'] } },
        success: false,
        workerResults: [{ role: 'planner', model: 'large', success: false, error: 'offline' }],
      },
    ]);
    expect(accounting.cumulativeInputTokens).toBe(17);
    expect(accounting.cumulativeOutputTokens).toBe(8);
    expect(accounting.hasReceivedUsage).toBe(true);
    expect(accounting.workerMetricsByRole['planner']).toEqual({
      inputTokens: 17,
      outputTokens: 8,
      dispatches: 2,
      durationMs: 20,
      artifactsProduced: 0,
    });
    expect(accounting.workerModelByRole['planner']).toBe('large');
    expect(accounting.workerFailuresByRole['planner']).toEqual([
      { error: 'offline', model: 'large' },
    ]);
  });

  it('restores independent metrics and preserves previously fired budget alerts', () => {
    const metrics = {
      planner: {
        inputTokens: 40,
        outputTokens: 10,
        dispatches: 1,
        durationMs: 10,
        artifactsProduced: 0,
      },
    };
    const accounting = new ExecutionAccounting();
    accounting.restore({
      cumulativeInputTokens: 40,
      cumulativeOutputTokens: 10,
      workerMetricsByRole: metrics,
      firedThresholdIndex: 0,
      hasReceivedUsage: true,
    });
    const warn = vi.fn();
    const logger = { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    const config = { budgetMaxTokens: 100, budgetAlertThresholds: [0.9, 0.25, 0.5] };
    accounting.checkAlertThresholds(config, logger);
    accounting.checkAlertThresholds(config, logger);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('50% threshold'));
    expect(accounting.firedThresholdIndex).toBe(1);
    accounting.record([result(2, 1)]);
    expect(metrics.planner.inputTokens).toBe(40);
    expect(accounting.workerMetricsByRole['planner'].inputTokens).toBe(42);
    accounting.reset();
    expect(accounting.cumulativeInputTokens).toBe(0);
    expect(accounting.cumulativeOutputTokens).toBe(0);
    expect(accounting.firedThresholdIndex).toBe(-1);
    expect(accounting.hasReceivedUsage).toBe(false);
    expect(accounting.workerMetricsByRole).toEqual({});
    expect(accounting.workerFailuresByRole).toEqual({});
    expect(accounting.workerModelByRole).toEqual({});
  });

  it('handles legacy missing accounting fields and disabled alerts', () => {
    const accounting = new ExecutionAccounting();
    accounting.restore({});
    const logger = { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    accounting.checkAlertThresholds(null, logger);
    accounting.checkAlertThresholds({ budgetMaxTokens: 100 }, logger);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(accounting.hasReceivedUsage).toBe(false);
  });
});
