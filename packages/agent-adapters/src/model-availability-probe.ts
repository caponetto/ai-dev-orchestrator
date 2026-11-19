import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentAdapter } from './adapter-types';
import { ClaudeCodeAdapter } from './claude-code-adapter';
import { createCodexCliAdapter } from './codex-cli-adapter';
import { CursorCliAdapter } from './cursor-cli-adapter';
import { createOpencodeCliAdapter } from './opencode-cli-adapter';
import { createPiCliAdapter } from './pi-cli-adapter';
import { isTransientCliError } from './transient-cli-error';

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

const PROBE_TIMEOUT_MS = 60_000;
const PROBE_ATTEMPTS = 2;

/**
 * Check real inference access, rather than relying on a possibly stale model catalog.
 *
 * Provider tail latency and transient service errors can fail an attempt on an
 * otherwise-healthy model (for example large reasoning models served behind shared
 * gateways), so timed-out and recoverable-error attempts are retried once before
 * the model is reported unavailable.
 */
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
    const baseEnv = {
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
    };
    const exec = options.execFn ?? executeProbe;
    let outcome: (ModelAvailabilityResult & { readonly transient?: boolean }) | undefined;
    for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
      try {
        const result = await exec({
          command: config.adapter.command,
          args,
          // A caller-supplied cwd can disappear (for example a rerun whose original
          // checkout was cleaned up); spawning with a nonexistent cwd fails with
          // ENOENT just like a missing command, so fall back to the temp directory.
          cwd: options.cwd !== undefined && existsSync(options.cwd) ? options.cwd : cwd,
          timeoutMs: PROBE_TIMEOUT_MS,
          env: baseEnv,
        });
        outcome = evaluateProbeOutput(config.adapter, result);
      } catch (error: unknown) {
        if (!isTimeoutError(error) || attempt === PROBE_ATTEMPTS) {
          throw error;
        }
        continue;
      }
      if (outcome.available || !outcome.transient || attempt === PROBE_ATTEMPTS) {
        break;
      }
    }
    if (!outcome) {
      throw new Error('Model probe ended without a result.');
    }
    const { transient: _transient, ...result } = outcome;
    return result;
  } catch (error: unknown) {
    return { available: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function evaluateProbeOutput(
  adapter: AgentAdapter,
  result: { stdout: string; stderr: string; exitCode: number },
): ModelAvailabilityResult & { readonly transient?: boolean } {
  let completed = false;
  for (const line of result.stdout.split(/\r?\n/u)) {
    const event = adapter.translateOutput?.(line);
    if (event?.type === 'error') {
      const payload =
        typeof event.payload === 'object' && event.payload !== null ? event.payload : {};
      const message = 'message' in payload ? payload.message : undefined;
      const recoverable = 'recoverable' in payload ? payload.recoverable : undefined;
      return {
        available: false,
        detail: typeof message === 'string' ? message : 'Provider rejected the model check.',
        transient: recoverable === true,
      };
    }
    if (event?.type === 'done') {
      completed = true;
    }
  }
  if (result.exitCode !== 0 || !completed) {
    const detail =
      result.stderr.trim().slice(0, 500) || 'Model check did not complete successfully.';
    return { available: false, detail, transient: isTransientCliError(detail) };
  }
  return { available: true };
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
    case 'pi':
      // --no-session keeps the probe ephemeral; --no-tools and --no-approve keep it
      // side-effect free in an untrusted temporary directory. --thinking off avoids
      // extended reasoning, which alone can exceed the 30s probe timeout on large
      // thinking-first models.
      return {
        adapter: createPiCliAdapter(),
        args: ['--mode', 'json', '--no-session', '--no-tools', '--no-approve', '--thinking', 'off'],
      };
    default:
      return null;
  }
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith('Model check timed out after') &&
    error.message.endsWith('Try again before starting.')
  );
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
          reject(
            new Error(
              `Model check timed out after ${String(Math.round(command.timeoutMs / 1000))} seconds. Try again before starting.`,
            ),
          );
        } else if (error && typeof error.code !== 'number') {
          reject(
            new Error(
              (error as { code?: unknown }).code === 'ENOENT'
                ? `${command.command} CLI not found on this process's PATH. Install it, or restart ` +
                    `the orchestrator/dashboard from a shell where ${command.command} is available.`
                : error.message,
            ),
          );
        } else {
          resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 });
        }
      },
    );
    child.stdin?.end();
  });
}
