import { PassThrough } from 'node:stream';

import type { AgentAdapter } from '@ai-dev-orchestrator/agent-adapters';
import type { AgentTask } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import {
  buildInvocationArgs,
  configureCliSubprocessStdin,
  resolveCliSubprocessStdinOption,
} from '../cli-invocation';

const task: AgentTask = {
  taskId: 'task',
  runId: 'run',
  stateId: 'WORK',
  role: 'planner',
  description: 'Plan the task',
  inputArtifacts: [],
  repoRoot: '/repo',
  runDir: '/run',
  outputArtifactPath: '/run/plan.json',
  constraints: { timeout: 1000, requiredOutputType: 'plan' },
  modelHint: 'suggested',
};

describe('CLI invocation construction', () => {
  it('closes an existing pipe for argv-prompt adapters', () => {
    const adapter: AgentAdapter = { name: 'codex', command: 'agent', args: [] };
    const stdin = new PassThrough();
    configureCliSubprocessStdin(stdin, [], adapter, task, '/run/task.json');
    expect(stdin.writableEnded).toBe(true);
    expect(resolveCliSubprocessStdinOption(adapter, [])).toBe('ignore');
    stdin.destroy();
  });
  it('preserves explicit model arguments and passes task files to a protocol adapter', () => {
    const base = Object.freeze(['--model', 'configured']);
    expect(buildInvocationArgs(task, '/run/task.json', base)).toEqual([
      '--model',
      'configured',
      '--allowedTools=Read,Write,Edit',
      '--task-file',
      '/run/task.json',
    ]);
    expect(base).toEqual(['--model', 'configured']);
  });

  it('sends the task prompt through stdin without adding prompt or tool flags to argv', () => {
    const adapter: AgentAdapter = {
      name: 'claude-code',
      command: 'agent',
      args: [],
      promptViaStdin: true,
      sendPrompt: (prompt) => JSON.stringify({ prompt }),
    };
    const args = buildInvocationArgs(task, '/run/task.json', [], adapter);
    expect(args).toEqual(['--model', 'suggested']);
    expect(resolveCliSubprocessStdinOption(adapter, args)).toBe('pipe');
    const stdin = new PassThrough();
    configureCliSubprocessStdin(stdin, args, adapter, task, '/run/task.json');
    const message = stdin.read() as Buffer;
    expect(message.toString()).toContain('Task file: /run/task.json');
    expect(stdin.writableEnded).toBe(false);
    stdin.destroy();
  });

  it('closes stdin for print-mode invocations even when an adapter supports stdin prompts', () => {
    const adapter: AgentAdapter = {
      name: 'custom',
      command: 'agent',
      args: [],
      promptViaStdin: true,
      sendPrompt: () => 'unused',
    };
    const stdin = new PassThrough();
    configureCliSubprocessStdin(stdin, ['--print'], adapter, task, '/run/task.json');
    expect(resolveCliSubprocessStdinOption(adapter, ['--print'])).toBe('ignore');
    expect(stdin.writableEnded).toBe(true);
    expect(stdin.read()).toBeNull();
    stdin.destroy();
  });
});
