import { describe, expect, it } from 'vitest';

import { runCreationParamsToCliArgs } from '../run-creation-args';

describe('runCreationParamsToCliArgs', () => {
  it('produces minimal args with only prompt', () => {
    const args = runCreationParamsToCliArgs({ prompt: 'do the thing' });
    expect(args).toEqual(['run', 'do the thing']);
  });

  it('includes --workflow when provided', () => {
    const args = runCreationParamsToCliArgs({ prompt: 'build it', workflow: 'dev' });
    expect(args).toContain('--workflow');
    expect(args[args.indexOf('--workflow') + 1]).toBe('dev');
  });

  it('includes --repo when repoRoot is provided', () => {
    const args = runCreationParamsToCliArgs({ prompt: 'review', repoRoot: '/tmp/repo' });
    expect(args).toContain('--repo');
    expect(args[args.indexOf('--repo') + 1]).toBe('/tmp/repo');
  });

  it('includes all flags when all options are set', () => {
    const args = runCreationParamsToCliArgs({
      prompt: 'full run',
      workflow: 'pr-review',
      repoRoot: '/home/user/project',
    });
    expect(args[0]).toBe('run');
    expect(args).toContain('--workflow');
    expect(args).toContain('--repo');
    expect(args[args.length - 1]).toBe('full run');
  });

  it('places prompt as the last argument', () => {
    const args = runCreationParamsToCliArgs({
      prompt: 'always last',
      workflow: 'dev',
      repoRoot: '/tmp',
    });
    expect(args[args.length - 1]).toBe('always last');
  });
});
