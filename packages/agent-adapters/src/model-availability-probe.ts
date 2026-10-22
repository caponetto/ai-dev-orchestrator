import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentAdapter } from './adapter-types';
import { ClaudeCodeAdapter } from './claude-code-adapter';
import { createCodexCliAdapter } from './codex-cli-adapter';
import { CursorCliAdapter } from './cursor-cli-adapter';
import { createOpencodeCliAdapter } from './opencode-cli-adapter';

export interface ModelProbeCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env: NodeJS.ProcessEnv;
}

export interface ModelAvailabilityResult {
  readonly available: boolean;
  readonly detail?: string;
}

const PROMPT = 'Reply with exactly OK. Do not use tools, read files, or perform any other action.';

/** Check real inference access, rather than relying on a possibly stale model catalog. */
export async function probeModelAvailability(
  runner: string,
  model: string | undefined,
  options: {
    readonly cwd?: string;
    readonly execFn?: (
      command: ModelProbeCommand,
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  } = {},
): Promise<ModelAvailabilityResult> {
  const config = probeConfig(runner);
  if (!config) {
    return { available: false, detail: `Model checks are not supported for runner "${runner}".` };
  }

  const cwd = await mkdtemp(join(tmpdir(), 'ai-model-preflight-'));
  try {
    const args = [...config.args];
    if (model !== undefined) {
      args.push('--model', model);
    }
    args.push('--', PROMPT);
    const result = await (options.execFn ?? executeProbe)({
      command: config.adapter.command,
      args,
      cwd: options.cwd ?? cwd,
      timeoutMs: 30_000,
      env: {
        ...process.env,
        // Keep OpenCode's tool definitions: denying every tool can cause its free-tier
        // gateway to reject genuine CLI requests. Non-interactive `run` rejects `ask`
        // permissions automatically without --auto, so tools still cannot execute.
        ...(runner === 'opencode'
          ? {
              OPENCODE_CONFIG_CONTENT: JSON.stringify({
                ...readOpencodeOverrides(),
                permission: { '*': 'ask' },
              }),
            }
          : {}),
      },
    });
    let completed = false;
    for (const line of result.stdout.split(/\r?\n/u)) {
      const event = config.adapter.translateOutput?.(line);
      if (event?.type === 'error') {
        const message =
          typeof event.payload === 'object' && event.payload !== null && 'message' in event.payload
            ? event.payload.message
            : undefined;
        return {
          available: false,
          detail: typeof message === 'string' ? message : 'Provider rejected the model check.',
        };
      }
      if (event?.type === 'done') {
        completed = true;
      }
    }
    if (result.exitCode !== 0 || !completed) {
      return {
        available: false,
        detail: result.stderr.trim().slice(0, 500) || 'Model check did not complete successfully.',
      };
    }
    return { available: true };
  } catch (error: unknown) {
    return { available: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function readOpencodeOverrides(): Record<string, unknown> {
  const content = process.env['OPENCODE_CONFIG_CONTENT'];
  if (!content) {
    return {};
  }
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('OPENCODE_CONFIG_CONTENT must contain a configuration object.');
  }
  return parsed as Record<string, unknown>;
}

function probeConfig(runner: string): { adapter: AgentAdapter; args: readonly string[] } | null {
  switch (runner) {
    case 'claude-code':
      return {
        adapter: new ClaudeCodeAdapter(),
        args: [
          '--print',
          '--verbose',
          '--output-format',
          'stream-json',
          '--no-session-persistence',
          '--tools',
          '',
          '--strict-mcp-config',
          '--mcp-config',
          '{"mcpServers":{}}',
          '--settings',
          '{"disableAllHooks":true}',
        ],
      };
    case 'codex':
      return {
        adapter: createCodexCliAdapter(),
        args: [
          'exec',
          '--json',
          '--ephemeral',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '-c',
          'features.shell_tool=false',
        ],
      };
    case 'cursor':
      return {
        adapter: new CursorCliAdapter(),
        args: ['--print', '--trust', '--mode', 'ask', '--output-format', 'stream-json'],
      };
    case 'opencode':
      return { adapter: createOpencodeCliAdapter(), args: ['run', '--format', 'json'] };
    default:
      return null;
  }
}

function executeProbe(
  command: ModelProbeCommand,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command.command,
      [...command.args],
      {
        cwd: command.cwd,
        env: command.env,
        timeout: command.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error?.killed) {
          reject(new Error('Model check timed out after 30 seconds. Try again before starting.'));
        } else if (error && typeof error.code !== 'number') {
          reject(new Error(error.message));
        } else {
          resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 });
        }
      },
    );
    child.stdin?.end();
  });
}
