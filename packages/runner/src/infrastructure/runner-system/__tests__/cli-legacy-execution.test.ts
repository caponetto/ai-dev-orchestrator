import { PassThrough } from 'node:stream';

import type { AgentTask } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { runLegacyMode } from '../cli-legacy-execution';

const task: AgentTask = {
  taskId: 'task',
  runId: 'run',
  stateId: 'WORK',
  role: 'planner',
  description: '',
  inputArtifacts: [],
  repoRoot: '/repo',
  runDir: '/run',
  outputArtifactPath: '/run/output.json',
  constraints: { timeout: 1000, requiredOutputType: 'plan' },
};

function processFixture() {
  let finish = () => {};
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return { process: Object.assign(promise, { stdout, stderr }), stdout, stderr, finish };
}

describe('legacy subprocess output', () => {
  it.each([
    [
      { input_tokens: 100, output_tokens: 40 },
      { inputTokens: 100, outputTokens: 40 },
    ],
    [
      { inputTokens: 100, outputTokens: 40 },
      { inputTokens: 100, outputTokens: 40 },
    ],
  ])('accounts for an unterminated assistant usage event %j', async (usage, expected) => {
    const f = processFixture();
    const readOutput = vi
      .fn()
      .mockResolvedValue({ taskId: 'task', status: 'success', durationMs: 0 });
    const result = runLegacyMode(task, readOutput, f.process, 0);
    f.stdout.write(JSON.stringify({ type: 'assistant', message: { usage } }));
    f.finish();
    await result;
    expect(readOutput).toHaveBeenCalledWith(task, 0, expected, undefined);
    f.stdout.destroy();
    f.stderr.destroy();
  });

  it.each([new Error('early failure'), 'early failure', { unexpected: true }])(
    'reports an early subprocess failure before reading output',
    async (error) => {
      const f = processFixture();
      const readOutput = vi.fn();
      await expect(runLegacyMode(task, readOutput, f.process, 0, undefined, error)).rejects.toThrow(
        error instanceof Error || typeof error === 'string'
          ? 'early failure'
          : 'Unknown process error',
      );
      expect(readOutput).not.toHaveBeenCalled();
      f.finish();
      f.stdout.destroy();
      f.stderr.destroy();
    },
  );
});
