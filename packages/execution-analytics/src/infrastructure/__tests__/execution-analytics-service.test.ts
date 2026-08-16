import type { ProjectContextStore } from '@ai-orchestrator/ports';
import type { ContextDocument } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { ExecutionAnalyticsService } from '../execution-analytics-service';

function createMockStore(): ProjectContextStore {
  const data = new Map<string, ContextDocument>();
  return {
    initialize: vi.fn(),
    read: vi.fn((category: string) => Promise.resolve(data.get(category) ?? null)),
    write: vi.fn((category: string, doc: ContextDocument) => {
      data.set(category, doc);
      return Promise.resolve();
    }),
    query: vi.fn(() => Promise.resolve([])),
    getProjectHash: vi.fn(() => 'test-hash'),
  };
}

describe('ExecutionAnalyticsService', () => {
  it('should record outcomes and build a profile', async () => {
    const store = createMockStore();
    const service = new ExecutionAnalyticsService(store);

    await service.recordOutcomes([
      {
        roleId: 'implementer',
        model: 'claude-sonnet-5',
        inputTokens: 1000,
        outputTokens: 500,
        durationMs: 5000,
        retryCount: 0,
        status: 'success',
        errorType: null,
        confidenceScore: 0.9,
      },
    ]);

    const profile = await service.getProfile('implementer', 'claude-sonnet-5');
    expect(profile).not.toBeNull();
    expect(profile?.sampleSize).toBe(1);
    expect(profile?.reliability.successRate).toBe(1);
  });

  it('should return null profile when no data exists', async () => {
    const store = createMockStore();
    const service = new ExecutionAnalyticsService(store);

    const profile = await service.getProfile('implementer', 'claude-sonnet-5');
    expect(profile).toBeNull();
  });

  it('should return no-recommendation config when no data exists', async () => {
    const store = createMockStore();
    const service = new ExecutionAnalyticsService(store);

    const config = await service.getAdaptiveConfig('implementer', 'claude-sonnet-5', {
      maxOutputTokens: 4096,
      maxRetries: 3,
      timeoutMs: 600000,
      modelMaxTokens: 200000,
    });

    expect(config.recommendedMaxOutputTokens).toBeNull();
    expect(config.recommendedMaxRetries).toBeNull();
    expect(config.recommendedTimeoutMs).toBeNull();
    expect(config.modelEscalation.recommended).toBe(false);
  });

  it('should accumulate across multiple recordOutcomes calls', async () => {
    const store = createMockStore();
    const service = new ExecutionAnalyticsService(store);

    const outcome = {
      roleId: 'implementer',
      model: 'claude-sonnet-5',
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 5000,
      retryCount: 0,
      status: 'success' as const,
      errorType: null,
      confidenceScore: 0.9,
    };

    await service.recordOutcomes([outcome]);
    await service.recordOutcomes([outcome]);
    await service.recordOutcomes([outcome]);

    const profile = await service.getProfile('implementer', 'claude-sonnet-5');
    expect(profile?.sampleSize).toBe(3);
  });

  it('should separate profiles by role+model', async () => {
    const store = createMockStore();
    const service = new ExecutionAnalyticsService(store);

    await service.recordOutcomes([
      {
        roleId: 'implementer',
        model: 'claude-sonnet-5',
        inputTokens: 1000,
        outputTokens: 500,
        durationMs: 5000,
        retryCount: 0,
        status: 'success',
        errorType: null,
        confidenceScore: 0.9,
      },
      {
        roleId: 'reviewer',
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 500,
        outputTokens: 200,
        durationMs: 2000,
        retryCount: 0,
        status: 'success',
        errorType: null,
        confidenceScore: 0.95,
      },
    ]);

    const implProfile = await service.getProfile('implementer', 'claude-sonnet-5');
    const reviewProfile = await service.getProfile('reviewer', 'claude-haiku-4-5-20251001');

    expect(implProfile?.tokenUsage.outputTokens.ema).toBe(500);
    expect(reviewProfile?.tokenUsage.outputTokens.ema).toBe(200);
  });

  it('should not fail on empty outcomes array', async () => {
    const store = createMockStore();
    const service = new ExecutionAnalyticsService(store);

    await service.recordOutcomes([]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(store.write).not.toHaveBeenCalled();
  });
});
