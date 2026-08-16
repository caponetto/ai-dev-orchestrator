import { describe, expect, it } from 'vitest';

import { scriptDirectivesSchema, scriptOutputSchema, scriptResultSchema } from '../workflow-engine';

describe('scriptDirectivesSchema', () => {
  it('accepts empty object', () => {
    expect(scriptDirectivesSchema.safeParse({}).success).toBe(true);
  });

  it('accepts repoRoot string', () => {
    const result = scriptDirectivesSchema.safeParse({ repoRoot: '/tmp/repo' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repoRoot).toBe('/tmp/repo');
    }
  });
});

describe('scriptOutputSchema', () => {
  it('accepts message-only payload (backward compat)', () => {
    const result = scriptOutputSchema.safeParse({ message: 'Published to gist' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('Published to gist');
      expect(result.data.directives).toBeUndefined();
    }
  });

  it('accepts message with directives.repoRoot', () => {
    const result = scriptOutputSchema.safeParse({
      message: 'Cloned repo',
      directives: { repoRoot: '/tmp/pr-review-abc' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('Cloned repo');
      expect(result.data.directives?.repoRoot).toBe('/tmp/pr-review-abc');
    }
  });

  it('accepts empty object (no message, no directives)', () => {
    expect(scriptOutputSchema.safeParse({}).success).toBe(true);
  });

  it('rejects message with empty string', () => {
    expect(scriptOutputSchema.safeParse({ message: '' }).success).toBe(false);
  });
});

describe('scriptResultSchema output field', () => {
  it('accepts result with output field', () => {
    const result = scriptResultSchema.safeParse({
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 100,
      output: { message: 'Done', directives: { repoRoot: '/tmp/x' } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.output?.directives?.repoRoot).toBe('/tmp/x');
    }
  });

  it('accepts result without output field', () => {
    const result = scriptResultSchema.safeParse({
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 100,
    });
    expect(result.success).toBe(true);
  });
});
