import { describe, expect, it } from 'vitest';

import { configSnapshotSchema, configSnapshotWorkflowSchema } from '../config-snapshot';

describe('configSnapshotWorkflowSchema', () => {
  it('validates an empty object (all optional)', () => {
    expect(configSnapshotWorkflowSchema.safeParse({}).success).toBe(true);
  });

  it('validates with all fields', () => {
    const data = { name: 'default', version: '1.0.0', globalTransitionLimit: 50 };
    expect(configSnapshotWorkflowSchema.safeParse(data).success).toBe(true);
  });

  it('validates with partial fields', () => {
    expect(configSnapshotWorkflowSchema.safeParse({ name: 'custom' }).success).toBe(true);
    expect(configSnapshotWorkflowSchema.safeParse({ globalTransitionLimit: 10 }).success).toBe(
      true,
    );
  });

  it('rejects invalid globalTransitionLimit type', () => {
    expect(configSnapshotWorkflowSchema.safeParse({ globalTransitionLimit: 'ten' }).success).toBe(
      false,
    );
  });
});

describe('configSnapshotSchema', () => {
  it('validates an empty object (all optional)', () => {
    expect(configSnapshotSchema.safeParse({}).success).toBe(true);
  });

  it('validates a full config snapshot', () => {
    const data = {
      repoRoot: '/home/user/project',
      sources: ['config.yaml', 'overrides.yaml'],
      workflow: { name: 'default', version: '2.0.0', globalTransitionLimit: 100 },
      roles: { planner: { model: 'gpt-4' } },
      governance: { maxIterations: 3 },
      runtime: { timeoutMs: 60000 },
    };
    expect(configSnapshotSchema.safeParse(data).success).toBe(true);
  });

  it('validates with only repoRoot', () => {
    expect(configSnapshotSchema.safeParse({ repoRoot: '/tmp/repo' }).success).toBe(true);
  });

  it('validates with only sources', () => {
    expect(configSnapshotSchema.safeParse({ sources: ['a.yaml'] }).success).toBe(true);
  });

  it('validates with empty sources array', () => {
    expect(configSnapshotSchema.safeParse({ sources: [] }).success).toBe(true);
  });

  it('validates with nested workflow', () => {
    const data = { workflow: { name: 'ci', version: '1.0.0' } };
    expect(configSnapshotSchema.safeParse(data).success).toBe(true);
  });

  it('validates with empty record fields', () => {
    const data = { roles: {}, governance: {}, runtime: {} };
    expect(configSnapshotSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid sources type', () => {
    expect(configSnapshotSchema.safeParse({ sources: 'single-string' }).success).toBe(false);
  });

  it('rejects invalid repoRoot type', () => {
    expect(configSnapshotSchema.safeParse({ repoRoot: 123 }).success).toBe(false);
  });

  it('rejects invalid workflow type', () => {
    expect(configSnapshotSchema.safeParse({ workflow: 'not-an-object' }).success).toBe(false);
  });
});
