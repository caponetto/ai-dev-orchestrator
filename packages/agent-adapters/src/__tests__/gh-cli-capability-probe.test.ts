import { describe, expect, it } from 'vitest';

import type { CapabilityProbeResult } from '../adapter-types';
import { probeGhCliCapabilities, normalizeGhCliProbeResult } from '../gh-cli-capability-probe';

function mockExec(responses: Record<string, { stdout: string; exitCode: number }>) {
  return (_cmd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> => {
    const key = args.join(' ');
    return Promise.resolve(responses[key] ?? { stdout: '', exitCode: 1 });
  };
}

describe('probeGhCliCapabilities', () => {
  it('detects authenticated gh CLI', async () => {
    const exec = mockExec({
      '--version': { stdout: 'gh version 2.50.0 (2026-05-01)\n', exitCode: 0 },
      'auth status': {
        stdout: 'Logged in to github.com account user (keyring)',
        exitCode: 0,
      },
    });

    const result = await probeGhCliCapabilities({ execFn: exec });
    expect(result.adapterName).toBe('gh-cli');
    expect(result.rawVersion).toBe('gh version 2.50.0 (2026-05-01)');
    expect(result.notes).toContain('Authentication verified — logged in to GitHub');
  });

  it('detects installed but unauthenticated gh CLI', async () => {
    const exec = mockExec({
      '--version': { stdout: 'gh version 2.50.0 (2026-05-01)\n', exitCode: 0 },
      'auth status': {
        stdout: 'You are not logged in to any GitHub hosts. Run gh auth login to authenticate.',
        exitCode: 1,
      },
    });

    const result = await probeGhCliCapabilities({ execFn: exec });
    expect(result.adapterName).toBe('gh-cli');
    expect(result.rawVersion).toBe('gh version 2.50.0 (2026-05-01)');
    expect(result.notes).toContain('Not authenticated — gh auth login required');
  });

  it('returns unavailable when command not found', async () => {
    const exec = () => Promise.reject(new Error('ENOENT'));

    const result = await probeGhCliCapabilities({ execFn: exec });
    expect(result.adapterName).toBe('gh-cli');
    expect(result.rawVersion).toBeNull();
    expect(result.notes).toContain("Command 'gh' not found or not executable");
  });

  it('handles version check failure gracefully', async () => {
    const exec = mockExec({
      '--version': { stdout: '', exitCode: 127 },
      'auth status': { stdout: 'Logged in', exitCode: 0 },
    });

    const result = await probeGhCliCapabilities({ execFn: exec });
    expect(result.rawVersion).toBeNull();
    expect(result.notes).toContain('Version check exited with code 127');
  });

  it('handles auth status command failure gracefully', async () => {
    const exec = mockExec({
      '--version': { stdout: 'gh version 2.50.0\n', exitCode: 0 },
    });
    const failingExec = (cmd: string, args: string[]) => {
      if (args[0] === 'auth') {
        return Promise.reject(new Error('auth failed'));
      }
      return exec(cmd, args);
    };

    const result = await probeGhCliCapabilities({ execFn: failingExec });
    expect(result.rawVersion).toBe('gh version 2.50.0');
    expect(result.notes).toContain('Auth status check failed');
  });

  it('detects no-token output as unauthenticated', async () => {
    const exec = mockExec({
      '--version': { stdout: 'gh version 2.50.0\n', exitCode: 0 },
      'auth status': {
        stdout: 'no token found for github.com',
        exitCode: 1,
      },
    });

    const result = await probeGhCliCapabilities({ execFn: exec });
    expect(result.notes).toContain('Not authenticated — gh auth login required');
  });

  it('uses custom command when specified', async () => {
    let capturedCmd: string | null = null;
    const exec = (cmd: string, _args: string[]) => {
      capturedCmd = cmd;
      return Promise.resolve({ stdout: 'gh version 2.50.0\n', exitCode: 0 });
    };

    await probeGhCliCapabilities({ command: 'custom-gh', execFn: exec });
    expect(capturedCmd).toBe('custom-gh');
  });

  it('handles non-zero auth exit with unknown output', async () => {
    const exec = mockExec({
      '--version': { stdout: 'gh version 2.50.0\n', exitCode: 0 },
      'auth status': { stdout: 'something unexpected', exitCode: 4 },
    });

    const result = await probeGhCliCapabilities({ execFn: exec });
    expect(result.notes).toContain('Auth status check exited with code 4');
  });
});

describe('normalizeGhCliProbeResult', () => {
  const base: CapabilityProbeResult = {
    adapterName: 'gh-cli',
    probedAt: '2026-01-01T00:00:00Z',
    rawVersion: null,
    notes: [],
    capabilities: {
      structuredIO: false,
      permissionEvents: false,
      clarificationEvents: false,
      stdinResponses: false,
    },
  };

  it('returns authenticated when login verified', () => {
    const result = normalizeGhCliProbeResult({
      ...base,
      rawVersion: 'gh version 2.50.0',
      notes: ['Authentication verified — logged in to GitHub'],
    });
    expect(result.mode).toBe('authenticated');
    expect(result.summary).toContain('authenticated');
  });

  it('returns installed when version detected but not authenticated', () => {
    const result = normalizeGhCliProbeResult({
      ...base,
      rawVersion: 'gh version 2.50.0',
      notes: ['Not authenticated — gh auth login required'],
    });
    expect(result.mode).toBe('installed');
    expect(result.summary).toContain('not authenticated');
  });

  it('returns unavailable when nothing detected', () => {
    const result = normalizeGhCliProbeResult(base);
    expect(result.mode).toBe('unavailable');
    expect(result.summary).toContain('not detected');
  });
});
