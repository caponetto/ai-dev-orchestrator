import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

import type { AgentAdapterCapabilities, CapabilityProbeResult } from './adapter-types';

interface ProbeOptions {
  readonly command?: string;
  readonly execFn?: (cmd: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>;
}

export async function probeClaudeCodeCapabilities(
  options: ProbeOptions = {},
): Promise<CapabilityProbeResult> {
  const command = options.command ?? 'claude';
  const exec = options.execFn ?? defaultExec;
  const notes: string[] = [];
  let rawVersion: string | null = null;

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
      adapterName: BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE,
      probedAt: new Date().toISOString(),
      capabilities,
      rawVersion,
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

    if (helpText.includes('--input-format') || helpText.includes('input-format')) {
      notes.push('Flag --input-format detected in help');
      if (helpText.includes('stream-json')) {
        capabilities = { ...capabilities, stdinResponses: true };
        notes.push('stream-json input mode available');
      }
    }

    if (helpText.includes('allowedTools') || helpText.includes('permission')) {
      capabilities = { ...capabilities, permissionEvents: true };
      notes.push('Permission-related flags detected');
    }
  } catch {
    notes.push('Help command failed; capability detection incomplete');
  }

  return {
    adapterName: BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE,
    probedAt: new Date().toISOString(),
    capabilities,
    rawVersion,
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

export function normalizeProbeResult(result: CapabilityProbeResult): {
  mode: 'native' | 'experimental' | 'text-only' | 'unavailable';
  summary: string;
} {
  const { structuredIO, stdinResponses, permissionEvents, clarificationEvents } =
    result.capabilities;

  if (structuredIO && stdinResponses && permissionEvents) {
    return {
      mode: 'native',
      summary: clarificationEvents
        ? 'Native bidirectional protocol — all interactive capabilities verified'
        : 'Native bidirectional protocol — permission flow verified (clarification events not detected)',
    };
  }

  if (structuredIO && permissionEvents) {
    return {
      mode: 'experimental',
      summary:
        stdinResponses && !clarificationEvents
          ? 'Structured I/O and permission events detected, but clarification events not verified; using experimental mode with stream-json output'
          : 'Structured output with permission events detected but full bidirectional protocol not verified; using experimental mode with stream-json output',
    };
  }

  if (structuredIO) {
    return {
      mode: 'experimental',
      summary:
        'Structured I/O available but interactive events not confirmed; using experimental mode with stream-json output',
    };
  }

  if (result.rawVersion) {
    return {
      mode: 'text-only',
      summary:
        'Claude Code detected but structured I/O not confirmed; using --print text-only mode',
    };
  }

  return {
    mode: 'unavailable',
    summary: 'Claude Code not detected or not executable',
  };
}
