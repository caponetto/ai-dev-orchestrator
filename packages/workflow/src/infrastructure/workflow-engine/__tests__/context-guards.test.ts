import type { ProjectContextStore } from '@ai-dev-orchestrator/ports';
import type { Guard } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import {
  evaluateKnownFailurePatternGuard,
  evaluatePreviousRunPatternGuard,
} from '../context-guards';

function createMockStore(readResult: unknown = null): ProjectContextStore {
  return {
    initialize: vi.fn(),
    read: vi.fn().mockResolvedValue(readResult),
    write: vi.fn(),
    query: vi.fn(),
    getProjectHash: vi.fn().mockReturnValue('abc123'),
  };
}

describe('evaluatePreviousRunPatternGuard', () => {
  const baseGuard: Extract<Guard, { type: 'previous_run_pattern' }> = {
    type: 'previous_run_pattern',
    params: { outcome: 'failed' },
  };

  it('fails when no run history is available', async () => {
    const store = createMockStore(null);
    const result = await evaluatePreviousRunPatternGuard(baseGuard, store);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('No run history');
  });

  it('passes when matching runs meet threshold', async () => {
    const store = createMockStore({
      category: 'run_history',
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        runs: [
          {
            runId: 'r1',
            outcome: 'failed',
            workflowVariant: 'dev',
            taskSummary: 'task1',
            timestamp: '',
            compressed: false,
          },
          {
            runId: 'r2',
            outcome: 'completed',
            workflowVariant: 'dev',
            taskSummary: 'task2',
            timestamp: '',
            compressed: false,
          },
          {
            runId: 'r3',
            outcome: 'failed',
            workflowVariant: 'dev',
            taskSummary: 'task3',
            timestamp: '',
            compressed: false,
          },
        ],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    });

    const result = await evaluatePreviousRunPatternGuard(baseGuard, store);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('2 run(s)');
  });

  it('fails when matching runs below minOccurrences', async () => {
    const store = createMockStore({
      category: 'run_history',
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        runs: [
          {
            runId: 'r1',
            outcome: 'failed',
            workflowVariant: 'dev',
            taskSummary: 'task1',
            timestamp: '',
            compressed: false,
          },
        ],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    });

    const guard: Extract<Guard, { type: 'previous_run_pattern' }> = {
      type: 'previous_run_pattern',
      params: { outcome: 'failed', minOccurrences: 3 },
    };

    const result = await evaluatePreviousRunPatternGuard(guard, store);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('need 3');
  });

  it('filters by workflowVariant when specified', async () => {
    const store = createMockStore({
      category: 'run_history',
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        runs: [
          {
            runId: 'r1',
            outcome: 'failed',
            workflowVariant: 'dev',
            taskSummary: 'task1',
            timestamp: '',
            compressed: false,
          },
          {
            runId: 'r2',
            outcome: 'failed',
            workflowVariant: 'pr-review',
            taskSummary: 'task2',
            timestamp: '',
            compressed: false,
          },
        ],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    });

    const guard: Extract<Guard, { type: 'previous_run_pattern' }> = {
      type: 'previous_run_pattern',
      params: { outcome: 'failed', workflowVariant: 'pr-review' },
    };

    const result = await evaluatePreviousRunPatternGuard(guard, store);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('1 run(s)');
  });

  it('fails when no runs match the outcome', async () => {
    const store = createMockStore({
      category: 'run_history',
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        runs: [
          {
            runId: 'r1',
            outcome: 'completed',
            workflowVariant: 'dev',
            taskSummary: 'task1',
            timestamp: '',
            compressed: false,
          },
        ],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    });

    const result = await evaluatePreviousRunPatternGuard(baseGuard, store);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('0 run(s)');
  });
});

describe('evaluateKnownFailurePatternGuard', () => {
  const baseGuard: Extract<Guard, { type: 'known_failure_pattern' }> = {
    type: 'known_failure_pattern',
    params: { patternSubstring: 'timeout' },
  };

  it('fails when no learned preferences are available', async () => {
    const store = createMockStore(null);
    const result = await evaluateKnownFailurePatternGuard(baseGuard, store);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('No learned preferences');
  });

  it('passes when a matching failure pattern exists', async () => {
    const store = createMockStore({
      category: 'preferences',
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        modelCalibration: [],
        failurePatterns: [
          {
            pattern: 'API timeout on large payloads',
            frequency: 3,
            lastSeen: '2026-08-10T00:00:00Z',
          },
        ],
        projectPreferences: [],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    });

    const result = await evaluateKnownFailurePatternGuard(baseGuard, store);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('API timeout on large payloads');
    expect(result.detail).toContain('3 time(s)');
  });

  it('performs case-insensitive matching', async () => {
    const store = createMockStore({
      category: 'preferences',
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        modelCalibration: [],
        failurePatterns: [
          { pattern: 'TIMEOUT error in CI', frequency: 1, lastSeen: '2026-08-10T00:00:00Z' },
        ],
        projectPreferences: [],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    });

    const result = await evaluateKnownFailurePatternGuard(baseGuard, store);
    expect(result.passed).toBe(true);
  });

  it('fails when no patterns match', async () => {
    const store = createMockStore({
      category: 'preferences',
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        modelCalibration: [],
        failurePatterns: [
          { pattern: 'Memory leak in worker', frequency: 2, lastSeen: '2026-08-10T00:00:00Z' },
        ],
        projectPreferences: [],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    });

    const result = await evaluateKnownFailurePatternGuard(baseGuard, store);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('No known failure pattern matching "timeout"');
  });
});
