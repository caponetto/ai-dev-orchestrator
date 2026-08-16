import { describe, expect, it } from 'vitest';

import { runCreationParamsSchema } from '../run-creation-params';

describe('runCreationParamsSchema', () => {
  it('validates with only prompt', () => {
    expect(runCreationParamsSchema.safeParse({ prompt: 'Build a REST API' }).success).toBe(true);
  });

  it('validates with all fields', () => {
    const data = {
      prompt: 'Implement authentication',
      workflow: 'default',
      repoRoot: '/home/user/project',
    };
    expect(runCreationParamsSchema.safeParse(data).success).toBe(true);
  });

  it('validates with prompt and workflow only', () => {
    const data = { prompt: 'Fix bug #42', workflow: 'hotfix' };
    expect(runCreationParamsSchema.safeParse(data).success).toBe(true);
  });

  it('validates with prompt and repoRoot only', () => {
    const data = { prompt: 'Add tests', repoRoot: '/tmp/repo' };
    expect(runCreationParamsSchema.safeParse(data).success).toBe(true);
  });

  it('rejects empty prompt', () => {
    expect(runCreationParamsSchema.safeParse({ prompt: '' }).success).toBe(false);
  });

  it('rejects missing prompt', () => {
    expect(runCreationParamsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects missing prompt with other fields present', () => {
    expect(
      runCreationParamsSchema.safeParse({ workflow: 'default', repoRoot: '/tmp' }).success,
    ).toBe(false);
  });

  it('rejects non-string prompt', () => {
    expect(runCreationParamsSchema.safeParse({ prompt: 123 }).success).toBe(false);
  });

  it('rejects non-string workflow', () => {
    expect(runCreationParamsSchema.safeParse({ prompt: 'test', workflow: 42 }).success).toBe(false);
  });

  it('rejects non-string repoRoot', () => {
    expect(runCreationParamsSchema.safeParse({ prompt: 'test', repoRoot: true }).success).toBe(
      false,
    );
  });
});
