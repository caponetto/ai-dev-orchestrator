import type { ActionResult } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { applyScriptDirectives } from '../lifecycle-controller';

describe('applyScriptDirectives', () => {
  it('returns repoRoot when a run_script result has directives.repoRoot', () => {
    const results: readonly ActionResult[] = [
      {
        action: { type: 'run_script', params: { script: 'setup-pr-repo.ts' } },
        success: true,
        scriptResult: {
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 100,
          output: {
            message: 'Cloned repo',
            directives: { repoRoot: '/tmp/pr-review-abc' },
          },
        },
      },
    ];

    const directive = applyScriptDirectives(results);
    expect(directive?.repoRoot).toBe('/tmp/pr-review-abc');
  });

  it('returns undefined when no run_script results have directives', () => {
    const results: readonly ActionResult[] = [
      {
        action: { type: 'dispatch_worker', params: { role: 'context_analyst' } },
        success: true,
      },
    ];

    const directive = applyScriptDirectives(results);
    expect(directive).toBeUndefined();
  });

  it('returns undefined when script result has no output', () => {
    const results: readonly ActionResult[] = [
      {
        action: { type: 'run_script', params: { script: 'some-script.ts' } },
        success: true,
        scriptResult: {
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 50,
        },
      },
    ];

    const directive = applyScriptDirectives(results);
    expect(directive).toBeUndefined();
  });

  it('returns the last directive when multiple scripts set repoRoot', () => {
    const results: readonly ActionResult[] = [
      {
        action: { type: 'run_script', params: { script: 'first.ts' } },
        success: true,
        scriptResult: {
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 50,
          output: { directives: { repoRoot: '/tmp/first' } },
        },
      },
      {
        action: { type: 'run_script', params: { script: 'second.ts' } },
        success: true,
        scriptResult: {
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 50,
          output: { directives: { repoRoot: '/tmp/second' } },
        },
      },
    ];

    const directive = applyScriptDirectives(results);
    expect(directive?.repoRoot).toBe('/tmp/second');
  });
});
