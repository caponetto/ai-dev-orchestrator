import { describe, expect, it } from 'vitest';

import {
  codebaseContextSchema,
  contextCategorySchema,
  learnedPreferencesSchema,
  runHistorySchema,
} from '../project-context';

describe('contextCategorySchema', () => {
  it('accepts valid categories', () => {
    expect(contextCategorySchema.safeParse('codebase').success).toBe(true);
    expect(contextCategorySchema.safeParse('run_history').success).toBe(true);
    expect(contextCategorySchema.safeParse('preferences').success).toBe(true);
  });

  it('rejects invalid categories', () => {
    expect(contextCategorySchema.safeParse('unknown').success).toBe(false);
  });
});

describe('codebaseContextSchema', () => {
  it('accepts a valid codebase context', () => {
    const result = codebaseContextSchema.safeParse({
      projectName: 'ai-dev-orchestrator',
      lastUpdated: '2026-08-11T10:00:00Z',
      lastRunId: 'run-001',
      architecture: {
        summary: 'Hexagonal monorepo',
        modules: [{ name: 'schemas', purpose: 'Shared types', keyAbstractions: ['Zod'] }],
        patterns: [
          { name: 'Ports', description: 'Interface contracts', discoveredInRun: 'run-001' },
        ],
      },
      conventions: [
        { rule: 'Use import type', evidence: 'ESLint rule', discoveredInRun: 'run-001' },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('runHistorySchema', () => {
  it('accepts a valid run history', () => {
    const result = runHistorySchema.safeParse({
      lastUpdated: '2026-08-11T10:00:00Z',
      runs: [
        {
          runId: 'run-001',
          timestamp: '2026-08-11T09:00:00Z',
          workflowVariant: 'dev',
          taskSummary: 'Add login endpoint',
          outcome: 'completed',
          compressed: false,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid outcome values', () => {
    const result = runHistorySchema.safeParse({
      lastUpdated: '2026-08-11T10:00:00Z',
      runs: [
        {
          runId: 'run-001',
          timestamp: '2026-08-11T09:00:00Z',
          workflowVariant: 'dev',
          taskSummary: 'test',
          outcome: 'unknown',
          compressed: false,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('learnedPreferencesSchema', () => {
  it('accepts valid learned preferences', () => {
    const result = learnedPreferencesSchema.safeParse({
      lastUpdated: '2026-08-11T10:00:00Z',
      modelCalibration: [
        {
          roleId: 'implementer',
          model: 'claude-haiku-4-5-20251001',
          successRate: 0.8,
          avgConfidence: 0.75,
          escalationRate: 0.2,
          sampleSize: 10,
        },
      ],
      failurePatterns: [],
      projectPreferences: [],
    });
    expect(result.success).toBe(true);
  });
});
