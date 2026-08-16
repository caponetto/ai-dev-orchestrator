import type { CapabilityProbeResult } from './adapter-types';

interface GhCliProbeOptions {
  readonly command?: string;
  readonly execFn?: (cmd: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>;
}

export async function probeGhCliCapabilities(
  options: GhCliProbeOptions = {},
): Promise<CapabilityProbeResult> {
  const command = options.command ?? 'gh';
  const exec = options.execFn ?? defaultExec;
  const notes: string[] = [];
  let rawVersion: string | null = null;

  const capabilities = {
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
      adapterName: 'gh-cli',
      probedAt: new Date().toISOString(),
      capabilities,
      rawVersion,
      notes,
    };
  }

  try {
    const authResult = await exec(command, ['auth', 'status']);
    if (authResult.exitCode === 0) {
      notes.push('Authentication verified — logged in to GitHub');
    } else {
      const output = authResult.stdout;
      if (output.includes('not logged in') || output.includes('no token')) {
        notes.push('Not authenticated — gh auth login required');
      } else {
        notes.push(`Auth status check exited with code ${String(authResult.exitCode)}`);
      }
    }
  } catch {
    notes.push('Auth status check failed');
  }

  return {
    adapterName: 'gh-cli',
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
    const e = err as { stdout?: string; stderr?: string; code?: number | string };
    let output = '';
    if (typeof e.stdout === 'string') {
      output = e.stdout;
    } else if (typeof e.stderr === 'string') {
      output = e.stderr;
    }
    return {
      stdout: output,
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

export function normalizeGhCliProbeResult(result: CapabilityProbeResult): {
  mode: 'authenticated' | 'installed' | 'unavailable';
  summary: string;
} {
  if (!result.rawVersion) {
    return {
      mode: 'unavailable',
      summary: 'GitHub CLI (gh) not detected or not executable',
    };
  }

  const isAuthenticated = result.notes.some((n) => n.includes('Authentication verified'));
  if (isAuthenticated) {
    return {
      mode: 'authenticated',
      summary: 'GitHub CLI authenticated — API access available',
    };
  }

  return {
    mode: 'installed',
    summary: 'GitHub CLI detected but not authenticated — run gh auth login',
  };
}
