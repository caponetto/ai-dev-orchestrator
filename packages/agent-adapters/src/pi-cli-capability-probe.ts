import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

import type { AgentAdapterCapabilities, CapabilityProbeResult } from './adapter-types';

export interface PiProbeResult extends CapabilityProbeResult {
  readonly authenticated: boolean | null;
  readonly availableModels?: readonly string[];
}

interface PiProbeOptions {
  readonly command?: string;
  readonly execFn?: (cmd: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>;
}

export async function probePiCliCapabilities(options: PiProbeOptions = {}): Promise<PiProbeResult> {
  const command = options.command ?? 'pi';
  const exec = options.execFn ?? defaultExec;
  const notes: string[] = [];
  let rawVersion: string | null = null;
  let authenticated: boolean | null = null;
  let availableModels: readonly string[] | undefined;
  let capabilities: AgentAdapterCapabilities = {
    structuredIO: false,
    permissionEvents: false,
    clarificationEvents: false,
    stdinResponses: false,
  };

  try {
    const version = await exec(command, ['--version']);
    if (version.exitCode !== 0 || !version.stdout.trim()) {
      notes.push(`Version check exited with code ${String(version.exitCode)}`);
    } else {
      rawVersion = version.stdout.trim().split('\n')[0];
      notes.push(`Detected version: ${rawVersion}`);
    }
  } catch {
    notes.push(`Command '${command}' not found or not executable`);
    return {
      adapterName: BUILT_IN_CODING_RUNNER_ID.PI,
      probedAt: new Date().toISOString(),
      capabilities,
      rawVersion,
      authenticated,
      notes,
    };
  }

  try {
    const help = await exec(command, ['--help']);
    if (help.stdout.includes('--mode') && help.stdout.includes('json')) {
      capabilities = { ...capabilities, structuredIO: true };
      notes.push('JSON event output available');
    }
    if (help.stdout.includes('--model')) {
      notes.push('Model selection available');
    }
  } catch {
    notes.push('Help command failed; capability detection incomplete');
  }

  try {
    const models = await exec(command, ['--list-models']);
    authenticated = models.exitCode === 0;
    if (authenticated) {
      availableModels = parseListModelsOutput(models.stdout);
      notes.push(
        availableModels.length > 0
          ? `Models available (${String(availableModels.length)} found)`
          : 'Models check succeeded but reported no models',
      );
    } else {
      notes.push('Models check failed');
    }
  } catch {
    notes.push('Models check failed');
  }

  return {
    adapterName: BUILT_IN_CODING_RUNNER_ID.PI,
    probedAt: new Date().toISOString(),
    capabilities,
    rawVersion,
    authenticated,
    availableModels,
    notes,
  };
}

/**
 * Parse `pi --list-models` table output. Each row is whitespace-separated with
 * the provider in the first column and the model ID in the second; the returned
 * IDs use pi's `provider/model` form, which `--model` accepts directly.
 */
export function parseListModelsOutput(stdout: string): string[] {
  const models: string[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u);
    // Model rows carry at least provider, model, context, and max-out columns; skip
    // prose and short fragments that cannot be table rows.
    if (columns.length < 4) {
      continue;
    }
    const [provider, model] = columns;
    if (
      !provider ||
      !model ||
      provider === 'provider' ||
      model === 'model' ||
      /[^a-zA-Z0-9._-]/u.test(provider) ||
      /[^a-zA-Z0-9._/*:-]/u.test(model)
    ) {
      continue;
    }
    const id = `${provider}/${model}`;
    if (!models.includes(id)) {
      models.push(id);
    }
  }
  return models;
}

async function defaultExec(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; exitCode: number }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    const result = await promisify(execFile)(cmd, args, { timeout: 10_000 });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return { stdout: output, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; code?: number | string };
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n');
    return {
      stdout: output,
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

export function normalizePiProbeResult(result: PiProbeResult): {
  mode: 'streaming' | 'text-only' | 'unavailable' | 'unauthenticated';
  summary: string;
} {
  if (result.authenticated === false) {
    return { mode: 'unauthenticated', summary: 'Pi CLI detected but models check failed' };
  }
  if (result.capabilities.structuredIO) {
    return { mode: 'streaming', summary: 'Pi CLI detected with JSON event output support' };
  }
  if (result.rawVersion) {
    return { mode: 'text-only', summary: 'Pi CLI detected but JSON event output not confirmed' };
  }
  return { mode: 'unavailable', summary: 'Pi CLI not detected or not executable' };
}
