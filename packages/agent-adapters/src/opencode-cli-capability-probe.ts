import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

import type { AgentAdapterCapabilities, CapabilityProbeResult } from './adapter-types';

export interface OpencodeProbeResult extends CapabilityProbeResult {
  readonly authenticated: boolean | null;
}

interface OpencodeProbeOptions {
  readonly command?: string;
  readonly execFn?: (cmd: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>;
}

export async function probeOpencodeCliCapabilities(
  options: OpencodeProbeOptions = {},
): Promise<OpencodeProbeResult> {
  const command = options.command ?? 'opencode';
  const exec = options.execFn ?? defaultExec;
  const notes: string[] = [];
  let rawVersion: string | null = null;
  let authenticated: boolean | null = null;
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
      adapterName: BUILT_IN_CODING_RUNNER_ID.OPENCODE,
      probedAt: new Date().toISOString(),
      capabilities,
      rawVersion,
      authenticated,
      notes,
    };
  }

  try {
    const help = await exec(command, ['run', '--help']);
    if (help.stdout.includes('--format') || help.stdout.includes('json')) {
      capabilities = { ...capabilities, structuredIO: true };
      notes.push('JSON event output available');
    }
    if (help.stdout.includes('--auto')) {
      notes.push('Auto-approval flag available');
    }
    if (help.stdout.includes('--model') || help.stdout.includes('-m,')) {
      notes.push('Model selection available');
    }
  } catch {
    notes.push('Help command failed; capability detection incomplete');
  }

  try {
    const models = await exec(command, ['models']);
    authenticated = models.exitCode === 0;
    notes.push(
      authenticated ? 'Models available (including free providers)' : 'Models check failed',
    );
  } catch {
    notes.push('Models check failed');
  }

  return {
    adapterName: BUILT_IN_CODING_RUNNER_ID.OPENCODE,
    probedAt: new Date().toISOString(),
    capabilities,
    rawVersion,
    authenticated,
    notes,
  };
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

export function normalizeOpencodeProbeResult(result: OpencodeProbeResult): {
  mode: 'streaming' | 'text-only' | 'unavailable' | 'unauthenticated';
  summary: string;
} {
  if (result.authenticated === false) {
    return {
      mode: 'unauthenticated',
      summary: 'OpenCode CLI detected but models check failed',
    };
  }
  if (result.capabilities.structuredIO) {
    return { mode: 'streaming', summary: 'OpenCode CLI detected with JSON event output support' };
  }
  if (result.rawVersion) {
    return {
      mode: 'text-only',
      summary: 'OpenCode CLI detected but JSON event output not confirmed',
    };
  }
  return { mode: 'unavailable', summary: 'OpenCode CLI not detected or not executable' };
}
