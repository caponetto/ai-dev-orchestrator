import { BUILT_IN_CODING_RUNNER_ID } from '@ai-orchestrator/schemas';

import type { AgentAdapterCapabilities, CapabilityProbeResult } from './adapter-types';

export interface CodexProbeResult extends CapabilityProbeResult {
  readonly authenticated: boolean | null;
}

interface CodexProbeOptions {
  readonly command?: string;
  readonly execFn?: (cmd: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>;
}

export async function probeCodexCliCapabilities(
  options: CodexProbeOptions = {},
): Promise<CodexProbeResult> {
  const command = options.command ?? 'codex';
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
      adapterName: BUILT_IN_CODING_RUNNER_ID.CODEX,
      probedAt: new Date().toISOString(),
      capabilities,
      rawVersion,
      authenticated,
      notes,
    };
  }
  try {
    const help = await exec(command, ['exec', '--help']);
    if (help.stdout.includes('--json')) {
      capabilities = { ...capabilities, structuredIO: true };
      notes.push('JSONL event output available');
    }
    if (help.stdout.includes('--sandbox')) {
      notes.push('Sandbox controls available');
    }
    if (help.stdout.includes('--model') || help.stdout.includes('-m,')) {
      notes.push('Model selection available');
    }
  } catch {
    notes.push('Help command failed; capability detection incomplete');
  }
  try {
    const login = await exec(command, ['login', 'status']);
    authenticated = login.exitCode === 0;
    notes.push(authenticated ? 'Authentication verified' : 'Not authenticated');
  } catch {
    notes.push('Authentication check failed');
  }
  return {
    adapterName: BUILT_IN_CODING_RUNNER_ID.CODEX,
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
    return { stdout: result.stdout, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; code?: number | string };
    return {
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

export function normalizeCodexProbeResult(result: CodexProbeResult): {
  mode: 'streaming' | 'text-only' | 'unavailable' | 'unauthenticated';
  summary: string;
} {
  if (result.authenticated === false) {
    return {
      mode: 'unauthenticated',
      summary: "Codex CLI detected but not authenticated — run 'codex login'",
    };
  }
  if (result.capabilities.structuredIO) {
    return { mode: 'streaming', summary: 'Codex CLI detected with JSONL event output support' };
  }
  if (result.rawVersion) {
    return {
      mode: 'text-only',
      summary: 'Codex CLI detected but JSONL event output not confirmed',
    };
  }
  return { mode: 'unavailable', summary: 'Codex CLI not detected or not executable' };
}
