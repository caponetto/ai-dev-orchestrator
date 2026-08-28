import { BUILT_IN_CODING_RUNNER_ID } from '@ai-orchestrator/schemas';

import type { AgentAdapterCapabilities, CapabilityProbeResult } from './adapter-types';

export interface CursorProbeResult extends CapabilityProbeResult {
  readonly authenticated: boolean | null;
}

interface CursorProbeOptions {
  readonly command?: string;
  readonly execFn?: (cmd: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>;
}

export async function probeCursorCliCapabilities(
  options: CursorProbeOptions = {},
): Promise<CursorProbeResult> {
  const command = options.command ?? 'agent';
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
    const versionResult = await exec(command, ['--version']);
    if (versionResult.exitCode === 0 && versionResult.stdout.trim().length > 0) {
      rawVersion = versionResult.stdout.trim().split('\n')[0];
      notes.push(`Detected version: ${rawVersion}`);
    } else {
      notes.push(`Version check exited with code ${String(versionResult.exitCode)}`);
    }
  } catch {
    notes.push(`Command '${command}' not found or not executable`);
    return {
      adapterName: BUILT_IN_CODING_RUNNER_ID.CURSOR,
      probedAt: new Date().toISOString(),
      capabilities,
      rawVersion,
      authenticated,
      notes,
    };
  }

  try {
    const helpResult = await exec(command, ['--help']);
    const helpText = helpResult.stdout;

    if (helpText.includes('--output-format') || helpText.includes('output-format')) {
      notes.push('Flag --output-format detected in help');
      if (helpText.includes('stream-json')) {
        capabilities = { ...capabilities, structuredIO: true };
        notes.push('stream-json output mode available');
      }
    }

    if (helpText.includes('--force') || helpText.includes('--yolo')) {
      notes.push('File modification flags (--force / --yolo) detected');
    }

    if (helpText.includes('--stream-partial-output')) {
      notes.push('Partial output streaming available');
    }

    if (helpText.includes('--approve-mcps')) {
      notes.push('MCP auto-approval flag available');
    }
  } catch {
    notes.push('Help command failed; capability detection incomplete');
  }

  try {
    const statusResult = await exec(command, ['status']);
    authenticated = statusResult.exitCode === 0;
    notes.push(authenticated ? 'Authentication verified' : 'Not authenticated');
  } catch {
    notes.push('Authentication check failed');
  }

  return {
    adapterName: BUILT_IN_CODING_RUNNER_ID.CURSOR,
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
  const execFileAsync = promisify(execFile);
  try {
    const result = await execFileAsync(cmd, args, { timeout: 10_000 });
    return { stdout: result.stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; code?: number | string };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

export function normalizeCursorProbeResult(result: CursorProbeResult): {
  mode: 'streaming' | 'text-only' | 'unavailable' | 'unauthenticated';
  summary: string;
} {
  if (result.authenticated === false) {
    return {
      mode: 'unauthenticated',
      summary:
        "Cursor CLI detected but not authenticated — run 'agent login' or set CURSOR_API_KEY",
    };
  }

  if (result.capabilities.structuredIO) {
    return {
      mode: 'streaming',
      summary: 'Cursor CLI detected with stream-json output support',
    };
  }

  if (result.rawVersion) {
    return {
      mode: 'text-only',
      summary: 'Cursor CLI detected but stream-json not confirmed; using --print text-only mode',
    };
  }

  return {
    mode: 'unavailable',
    summary: 'Cursor CLI not detected or not executable',
  };
}
