import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';

import type { AgentAdapter } from '@ai-dev-orchestrator/agent-adapters';
import { AI_CONFIG_DIR_NAME, BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';
import type { AgentTask } from '@ai-dev-orchestrator/schemas';

import { buildAgentTaskPrompt } from './cli-task-prompt';
import { buildCodexPermissionHookArgs } from './codex-permission-hook';

/** Adapters that accept a prompt as the final arg instead of --task-file. */
const PROMPT_BASED_ADAPTERS = new Set<string>([
  BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE,
  BUILT_IN_CODING_RUNNER_ID.CODEX,
  BUILT_IN_CODING_RUNNER_ID.CURSOR,
  BUILT_IN_CODING_RUNNER_ID.OPENCODE,
]);

/**
 * Codex (and similar CLIs) accept the prompt as argv but block on stdin when the pipe
 * stays open. Use `ignore` so Codex does not log "Reading additional input from stdin..."
 * to stderr before we can close the pipe.
 */
export function resolveCliSubprocessStdinOption(
  adapter: AgentAdapter | undefined,
  args: readonly string[],
): 'pipe' | 'ignore' {
  if (args.includes('--print')) {
    return 'ignore';
  }
  if (adapter?.promptViaStdin && adapter.sendPrompt) {
    return 'pipe';
  }
  if (adapter && PROMPT_BASED_ADAPTERS.has(adapter.name) && !adapter.promptViaStdin) {
    return 'ignore';
  }
  return 'pipe';
}

export function configureCliSubprocessStdin(
  stdin: Writable,
  args: readonly string[],
  adapter: AgentAdapter | undefined,
  task: AgentTask,
  taskFilePath: string,
): void {
  if (args.includes('--print')) {
    stdin.end();
    return;
  }

  if (adapter?.promptViaStdin && adapter.sendPrompt) {
    const stdinMsg = adapter.sendPrompt(buildAgentTaskPrompt(task, taskFilePath));
    if (stdinMsg) {
      stdin.write(stdinMsg + '\n');
    }
    return;
  }

  if (adapter && PROMPT_BASED_ADAPTERS.has(adapter.name) && !adapter.promptViaStdin) {
    stdin.end();
  }
}

function buildToolPermissionArgs(): string[] {
  return ['--allowedTools=Read,Write,Edit'];
}

function buildMaxTurnsArgs(task: AgentTask, adapter?: AgentAdapter): string[] {
  if (adapter?.name !== BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE) {
    return [];
  }
  const maxTurns = task.agentConfig?.maxTurns;
  if (!maxTurns) {
    return [];
  }
  return ['--max-turns', String(maxTurns)];
}

/** Grant Codex write access to ~/.ai and route approval prompts through the orchestrator hook. */
function buildCodexRunnerArgs(adapter?: AgentAdapter, hookCommand?: string): string[] {
  if (adapter?.name !== BUILT_IN_CODING_RUNNER_ID.CODEX) {
    return [];
  }
  const args = ['--add-dir', join(homedir(), AI_CONFIG_DIR_NAME)];
  if (hookCommand) {
    args.push(...buildCodexPermissionHookArgs(hookCommand));
  }
  return args;
}

export function buildInvocationArgs(
  task: AgentTask,
  taskFilePath: string,
  baseArgs: readonly string[],
  adapter?: AgentAdapter,
  codexHookCommand?: string,
): string[] {
  const modelArgs = buildModelArgs(task, baseArgs);
  const maxTurnsArgs = buildMaxTurnsArgs(task, adapter);
  const codexRunnerArgs = buildCodexRunnerArgs(adapter, codexHookCommand);

  if (adapter?.promptViaStdin) {
    return [...baseArgs, ...codexRunnerArgs, ...modelArgs, ...maxTurnsArgs];
  }

  const permArgs =
    adapter?.name === BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE || !adapter
      ? buildToolPermissionArgs()
      : [];

  if (adapter && PROMPT_BASED_ADAPTERS.has(adapter.name)) {
    return [
      ...baseArgs,
      ...codexRunnerArgs,
      ...modelArgs,
      ...permArgs,
      ...maxTurnsArgs,
      buildAgentTaskPrompt(task, taskFilePath),
    ];
  }
  return [
    ...baseArgs,
    ...codexRunnerArgs,
    ...modelArgs,
    ...permArgs,
    ...maxTurnsArgs,
    '--task-file',
    taskFilePath,
  ];
}

function buildModelArgs(task: AgentTask, baseArgs: readonly string[]): string[] {
  if (!task.modelHint) {
    return [];
  }
  const alreadyHasModel = baseArgs.some(
    (arg, i) => arg === '--model' || (i > 0 && baseArgs[i - 1] === '--model'),
  );
  if (alreadyHasModel) {
    return [];
  }
  return ['--model', task.modelHint];
}
