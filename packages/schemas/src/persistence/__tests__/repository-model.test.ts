import { describe, expect, it } from 'vitest';

import {
  discoveredRunStatusSchema,
  discoveryResultSchema,
  runDirectoryInfoSchema,
} from '../repository-model';

describe('discoveredRunStatusSchema', () => {
  it.each(['active', 'completed', 'aborted'])('accepts "%s"', (val) => {
    expect(discoveredRunStatusSchema.safeParse(val).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(discoveredRunStatusSchema.safeParse('failed').success).toBe(false);
  });
});

describe('discoveryResultSchema', () => {
  it('validates a successful discovery', () => {
    const data = {
      found: true,
      repoRoot: '/home/user/project',
      aiConfigDir: '/home/user/.ai',
      gitRoot: '/home/user/project',
    };
    expect(discoveryResultSchema.safeParse(data).success).toBe(true);
  });

  it('validates a failed discovery', () => {
    const data = {
      found: false,
      errors: ['No ~/.ai directory found'],
    };
    expect(discoveryResultSchema.safeParse(data).success).toBe(true);
  });

  it('validates minimal (found only)', () => {
    expect(discoveryResultSchema.safeParse({ found: false }).success).toBe(true);
  });
});

describe('runDirectoryInfoSchema', () => {
  it('validates run directory info', () => {
    const data = {
      runId: 'run-123',
      path: '/home/user/.ai/runs/run-123',
      createdAt: '2026-01-01T00:00:00Z',
      sizeBytes: 1048576,
      status: 'completed',
    };
    expect(runDirectoryInfoSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid status', () => {
    const data = {
      runId: 'run-123',
      path: '/tmp/run',
      createdAt: '2026-01-01T00:00:00Z',
      sizeBytes: 0,
      status: 'running',
    };
    expect(runDirectoryInfoSchema.safeParse(data).success).toBe(false);
  });
});
