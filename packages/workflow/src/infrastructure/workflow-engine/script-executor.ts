import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentStreamBus, JournalWriter, Logger } from '@ai-dev-orchestrator/ports';
import { noopLogger } from '@ai-dev-orchestrator/ports';
import type { ActionResult, RunId, ScriptOutput, ScriptResult } from '@ai-dev-orchestrator/schemas';
import { AI_CONFIG_DIR_NAME, scriptOutputSchema } from '@ai-dev-orchestrator/schemas';
import { getErrorMessage } from '@ai-dev-orchestrator/utils';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 1_048_576; // 1 MB
const KILL_GRACE_MS = 5_000;
/** Scripts installed by `ai init` into `~/.ai/scripts`. */
const GLOBAL_SCRIPTS_DIR_NAME = 'scripts';
const NODE_TS_ARGS = ['--experimental-strip-types', '--experimental-detect-module'] as const;
const PATH_SEP = process.platform === 'win32' ? ';' : ':';

function findOrchestratorBinDirs(): string[] {
  const dirs: string[] = [];
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'node_modules', '.bin');
    if (existsSync(candidate)) {
      dirs.push(candidate);
    }
    dir = dirname(dir);
  }
  return dirs;
}

const ORCHESTRATOR_BIN_DIRS = findOrchestratorBinDirs();

export interface ScriptExecutorDeps {
  readonly journalWriter: JournalWriter;
  readonly agentStreamBus?: AgentStreamBus;
  readonly logger?: Logger;
  /** Override for tests; defaults to `~/.ai/scripts`. */
  readonly globalScriptsDir?: string;
}

export interface ScriptActionParams {
  readonly script: string;
  readonly timeout?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ScriptExecutionContext {
  readonly runId: RunId;
  readonly stateId: string;
  readonly repoRoot: string;
  readonly artifactsDir: string;
  readonly dispatchId: string;
  readonly userPrompt?: string;
}

export class ScriptExecutor {
  private readonly journalWriter: JournalWriter;
  private readonly agentStreamBus?: AgentStreamBus;
  private readonly logger: Logger;
  private readonly globalScriptsDir: string;

  constructor(deps: ScriptExecutorDeps) {
    this.journalWriter = deps.journalWriter;
    this.agentStreamBus = deps.agentStreamBus;
    this.logger = deps.logger ?? noopLogger;
    this.globalScriptsDir =
      deps.globalScriptsDir ?? join(homedir(), AI_CONFIG_DIR_NAME, GLOBAL_SCRIPTS_DIR_NAME);
  }

  async execute(
    params: ScriptActionParams,
    context: ScriptExecutionContext,
  ): Promise<ActionResult> {
    const { script, timeout = DEFAULT_TIMEOUT_MS, env: extraEnv } = params;
    const { runId, stateId, repoRoot, artifactsDir, dispatchId, userPrompt } = context;

    const scriptPath = join(this.globalScriptsDir, script);
    const viaNode = script.endsWith('.ts');

    try {
      await access(scriptPath, constants.F_OK);
    } catch {
      return this.failure(params, `Script not found: ${script} (expected at ${scriptPath})`);
    }

    if (!viaNode) {
      try {
        await access(scriptPath, constants.X_OK);
      } catch {
        return this.failure(params, `Script not executable: ${scriptPath}`);
      }
    }

    this.recordJournalStart(runId, script, stateId);
    this.emitStreamEvent(runId, stateId, dispatchId, 'script_started', script);

    const resultDir = mkdtempSync(join(tmpdir(), 'orchestrator-script-'));
    const resultPath = join(resultDir, 'result.json');

    const startTime = Date.now();
    let result: ScriptResult;

    try {
      result = await this.spawn(scriptPath, {
        timeout,
        env: {
          ...process.env,
          PATH: [...ORCHESTRATOR_BIN_DIRS, process.env.PATH ?? ''].join(PATH_SEP),
          ORCHESTRATOR_RUN_ID: runId,
          ORCHESTRATOR_STATE_ID: stateId,
          ORCHESTRATOR_REPO_ROOT: repoRoot,
          ORCHESTRATOR_ARTIFACTS_DIR: artifactsDir,
          ORCHESTRATOR_SCRIPT_NAME: script,
          ORCHESTRATOR_SCRIPT_RESULT: resultPath,
          ...(userPrompt ? { ORCHESTRATOR_USER_PROMPT: userPrompt } : {}),
          ...extraEnv,
        },
        cwd: existsSync(repoRoot) ? repoRoot : tmpdir(),
        dispatchId,
        runId,
        stateId,
        viaNode,
      });
      result = {
        ...result,
        output: this.readScriptOutput(resultPath),
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const message = getErrorMessage(error);
      this.recordJournalComplete(runId, script, stateId, 1, durationMs, '', message, false);
      this.emitStreamEvent(runId, stateId, dispatchId, 'script_completed', script, 1, durationMs);
      return this.failure(params, message);
    } finally {
      rmSync(resultDir, { recursive: true, force: true });
    }

    const success = result.exitCode === 0;
    this.recordJournalComplete(
      runId,
      script,
      stateId,
      result.exitCode,
      result.durationMs,
      result.stdout,
      result.stderr,
      success,
    );
    this.emitStreamEvent(
      runId,
      stateId,
      dispatchId,
      'script_completed',
      script,
      result.exitCode,
      result.durationMs,
      result.output,
    );

    if (!success) {
      const errorMsg = result.stderr.trim() || `Script exited with code ${String(result.exitCode)}`;
      return {
        action: { type: 'run_script', params },
        success: false,
        error: errorMsg,
        scriptResult: result,
      };
    }

    return {
      action: { type: 'run_script', params },
      success: true,
      scriptResult: result,
    };
  }

  private readScriptOutput(resultPath: string): ScriptOutput | undefined {
    try {
      const raw = readFileSync(resultPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const result = scriptOutputSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.warn(
          `[script-executor] Ignoring invalid ORCHESTRATOR_SCRIPT_RESULT: ${result.error.message}`,
        );
        return undefined;
      }
      return result.data;
    } catch {
      return undefined;
    }
  }

  private spawn(
    scriptPath: string,
    options: {
      timeout: number;
      env: Record<string, string | undefined>;
      cwd: string;
      dispatchId: string;
      runId: string;
      stateId: string;
      viaNode: boolean;
    },
  ): Promise<ScriptResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutSize = 0;
      let stderrSize = 0;
      let killed = false;

      const child = options.viaNode
        ? spawn(process.execPath, [...NODE_TS_ARGS, scriptPath], {
            cwd: options.cwd,
            env: options.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
          })
        : spawn(scriptPath, [], {
            cwd: options.cwd,
            env: options.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
          });

      const timeoutHandle = setTimeout(() => {
        killed = true;
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
        } else {
          child.kill('SIGTERM');
        }
        setTimeout(() => {
          if (!child.killed) {
            if (child.pid) {
              try {
                process.kill(-child.pid, 'SIGKILL');
              } catch {
                child.kill('SIGKILL');
              }
            } else {
              child.kill('SIGKILL');
            }
          }
        }, KILL_GRACE_MS);
      }, options.timeout);

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutSize < MAX_OUTPUT_BYTES) {
          stdoutChunks.push(chunk);
          stdoutSize += chunk.length;
        }
        this.emitOutputEvent(
          options.runId,
          options.stateId,
          options.dispatchId,
          'stdout',
          chunk.toString('utf-8'),
        );
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrSize < MAX_OUTPUT_BYTES) {
          stderrChunks.push(chunk);
          stderrSize += chunk.length;
        }
        this.emitOutputEvent(
          options.runId,
          options.stateId,
          options.dispatchId,
          'stderr',
          chunk.toString('utf-8'),
        );
      });

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        const durationMs = Date.now() - startTime;

        let stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        let stderr = Buffer.concat(stderrChunks).toString('utf-8');

        if (stdoutSize > MAX_OUTPUT_BYTES) {
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + '\n[output truncated]';
        }
        if (stderrSize > MAX_OUTPUT_BYTES) {
          stderr = stderr.slice(0, MAX_OUTPUT_BYTES) + '\n[output truncated]';
        }

        if (killed) {
          resolve({
            exitCode: code ?? 143,
            stdout,
            stderr: stderr || 'Script timed out',
            durationMs,
          });
          return;
        }

        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs,
        });
      });
    });
  }

  private failure(params: ScriptActionParams, error: string): ActionResult {
    return { action: { type: 'run_script', params }, success: false, error };
  }

  private recordJournalStart(runId: string, script: string, stateId: string): void {
    try {
      this.journalWriter.append({
        timestamp: new Date().toISOString(),
        runId,
        sequence: 0,
        type: 'script_started',
        data: { kind: 'script', script, stateId },
      });
    } catch (err: unknown) {
      this.logger.warn(`[script-executor] Failed to write journal start: ${getErrorMessage(err)}`);
    }
  }

  private recordJournalComplete(
    runId: string,
    script: string,
    stateId: string,
    exitCode: number,
    durationMs: number,
    stdout: string,
    stderr: string,
    success: boolean,
  ): void {
    try {
      this.journalWriter.append({
        timestamp: new Date().toISOString(),
        runId,
        sequence: 0,
        type: 'script_completed',
        data: {
          kind: 'script',
          script,
          stateId,
          exitCode,
          durationMs,
          stdout: stdout.slice(0, 2000),
          stderr: stderr.slice(0, 2000),
          success,
        },
      });
    } catch (err: unknown) {
      this.logger.warn(
        `[script-executor] Failed to write journal complete: ${getErrorMessage(err)}`,
      );
    }
  }

  private emitStreamEvent(
    runId: string,
    stateId: string,
    dispatchId: string,
    type: string,
    script: string,
    exitCode?: number,
    durationMs?: number,
    output?: ScriptOutput,
  ): void {
    if (!this.agentStreamBus) {
      return;
    }
    this.agentStreamBus.publish({
      timestamp: new Date().toISOString(),
      type: 'status',
      content: output?.message ?? '',
      runId,
      stateId,
      roleId: 'script',
      dispatchId,
      structuredData: { messageType: type, script, exitCode, durationMs, output },
    });
  }

  private emitOutputEvent(
    runId: string,
    stateId: string,
    dispatchId: string,
    stream: 'stdout' | 'stderr',
    chunk: string,
  ): void {
    if (!this.agentStreamBus) {
      return;
    }
    this.agentStreamBus.publish({
      timestamp: new Date().toISOString(),
      type: stream === 'stdout' ? 'stdout' : 'stderr',
      content: chunk,
      runId,
      stateId,
      roleId: 'script',
      dispatchId,
    });
  }
}
