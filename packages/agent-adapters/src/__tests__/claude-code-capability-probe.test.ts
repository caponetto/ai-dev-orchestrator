import { describe, expect, it } from 'vitest';

import type { CapabilityProbeResult } from '../adapter-types';
import { probeClaudeCodeCapabilities, normalizeProbeResult } from '../claude-code-capability-probe';

function mockExec(responses: Record<string, { stdout: string; exitCode: number }>) {
  return (_cmd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> => {
    const key = args[0] ?? '';
    return Promise.resolve(responses[key] ?? { stdout: '', exitCode: 1 });
  };
}

describe('probeClaudeCodeCapabilities', () => {
  it('detects native mode when stream-json flags present in help', async () => {
    const exec = mockExec({
      '--version': { stdout: 'claude 1.2.3\n', exitCode: 0 },
      '--help': {
        stdout: '--output-format stream-json --input-format stream-json --allowedTools',
        exitCode: 0,
      },
    });

    const result = await probeClaudeCodeCapabilities({ execFn: exec });
    expect(result.capabilities.structuredIO).toBe(true);
    expect(result.capabilities.stdinResponses).toBe(true);
    expect(result.capabilities.permissionEvents).toBe(true);
    expect(result.capabilities.clarificationEvents).toBe(false);
    expect(result.rawVersion).toBe('claude 1.2.3');
  });

  it('detects text-only mode when only output-format present', async () => {
    const exec = mockExec({
      '--version': { stdout: 'claude 1.0.0\n', exitCode: 0 },
      '--help': {
        stdout: '--output-format stream-json --print',
        exitCode: 0,
      },
    });

    const result = await probeClaudeCodeCapabilities({ execFn: exec });
    expect(result.capabilities.structuredIO).toBe(true);
    expect(result.capabilities.stdinResponses).toBe(false);
  });

  it('returns unavailable when command not found', async () => {
    const exec = () => {
      return Promise.reject(new Error('ENOENT'));
    };

    const result = await probeClaudeCodeCapabilities({ execFn: exec });
    expect(result.capabilities.structuredIO).toBe(false);
    expect(result.rawVersion).toBeNull();
    expect(result.notes).toContain("Command 'claude' not found or not executable");
  });

  it('does not infer clarificationEvents even when all other capabilities are detected', async () => {
    const exec = mockExec({
      '--version': { stdout: 'claude 2.0.0\n', exitCode: 0 },
      '--help': {
        stdout: '--output-format stream-json --input-format stream-json --allowedTools',
        exitCode: 0,
      },
    });

    const result = await probeClaudeCodeCapabilities({ execFn: exec });
    expect(result.capabilities.structuredIO).toBe(true);
    expect(result.capabilities.stdinResponses).toBe(true);
    expect(result.capabilities.permissionEvents).toBe(true);
    expect(result.capabilities.clarificationEvents).toBe(false);
  });

  it('handles help command failure gracefully', async () => {
    const exec = mockExec({
      '--version': { stdout: 'claude 1.0.0\n', exitCode: 0 },
    });
    const failingExec = (cmd: string, args: string[]) => {
      if (args[0] === '--help') {
        return Promise.reject(new Error('help failed'));
      }
      return exec(cmd, args);
    };

    const result = await probeClaudeCodeCapabilities({ execFn: failingExec });
    expect(result.rawVersion).toBe('claude 1.0.0');
    expect(result.capabilities.structuredIO).toBe(false);
    expect(result.notes).toContain('Help command failed; capability detection incomplete');
  });

  it('detects output-format without stream-json', async () => {
    const exec = mockExec({
      '--version': { stdout: 'claude 1.0.0\n', exitCode: 0 },
      '--help': {
        stdout: '--output-format json --print',
        exitCode: 0,
      },
    });

    const result = await probeClaudeCodeCapabilities({ execFn: exec });
    expect(result.capabilities.structuredIO).toBe(false);
    expect(result.notes).toContain('Flag --output-format detected in help');
  });

  it('detects input-format flag presence even without stream-json', async () => {
    const exec = mockExec({
      '--version': { stdout: 'claude 1.0.0\n', exitCode: 0 },
      '--help': {
        stdout: '--input-format json --print',
        exitCode: 0,
      },
    });

    const result = await probeClaudeCodeCapabilities({ execFn: exec });
    expect(result.capabilities.structuredIO).toBe(false);
    expect(result.capabilities.stdinResponses).toBe(false);
    expect(result.notes).toContain('Flag --input-format detected in help');
  });

  it('detects permission via permission keyword', async () => {
    const exec = mockExec({
      '--version': { stdout: 'claude 1.0.0\n', exitCode: 0 },
      '--help': {
        stdout: '--permission --output-format stream-json',
        exitCode: 0,
      },
    });

    const result = await probeClaudeCodeCapabilities({ execFn: exec });
    expect(result.capabilities.permissionEvents).toBe(true);
    expect(result.notes).toContain('Permission-related flags detected');
  });

  it('uses custom command when specified', async () => {
    let capturedCmd: string | null = null;
    const exec = (cmd: string, _args: string[]) => {
      capturedCmd = cmd;
      return Promise.resolve({ stdout: 'custom 1.0.0\n', exitCode: 0 });
    };

    await probeClaudeCodeCapabilities({ command: 'custom-claude', execFn: exec });
    expect(capturedCmd).toBe('custom-claude');
  });

  it('handles version check failure gracefully', async () => {
    const exec = mockExec({
      '--version': { stdout: '', exitCode: 127 },
      '--help': { stdout: '--output-format stream-json', exitCode: 0 },
    });

    const result = await probeClaudeCodeCapabilities({ execFn: exec });
    expect(result.rawVersion).toBeNull();
    expect(result.capabilities.structuredIO).toBe(true);
  });
});

describe('normalizeProbeResult', () => {
  const base: CapabilityProbeResult = {
    adapterName: 'claude-code',
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

  it('returns native when all four capabilities are verified', () => {
    const result = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 1.2.3',
      capabilities: {
        structuredIO: true,
        stdinResponses: true,
        permissionEvents: true,
        clarificationEvents: true,
      },
    });
    expect(result.mode).toBe('native');
    expect(result.summary).toContain('all interactive capabilities verified');
  });

  it('returns native when structuredIO, stdinResponses, and permissionEvents are verified (no clarification)', () => {
    const result = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 1.2.3',
      capabilities: {
        structuredIO: true,
        stdinResponses: true,
        permissionEvents: true,
        clarificationEvents: false,
      },
    });
    expect(result.mode).toBe('native');
    expect(result.summary).toContain('permission flow verified');
  });

  it('returns experimental when stdinResponses are missing but permission events are available', () => {
    const result = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 1.0.0',
      capabilities: {
        structuredIO: true,
        stdinResponses: false,
        permissionEvents: true,
        clarificationEvents: false,
      },
    });
    expect(result.mode).toBe('experimental');
    expect(result.summary).toContain('experimental mode');
  });

  it('returns experimental when permission events are available even without native stdin', () => {
    const result = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 1.0.0',
      capabilities: {
        structuredIO: true,
        stdinResponses: false,
        permissionEvents: true,
        clarificationEvents: true,
      },
    });
    expect(result.mode).toBe('experimental');
    expect(result.summary).toContain('experimental mode');
  });

  it('returns experimental with clarification caveat when stdinResponses true but clarification false', () => {
    const result = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 1.0.0',
      capabilities: {
        structuredIO: true,
        stdinResponses: true,
        permissionEvents: true,
        clarificationEvents: false,
      },
    });
    expect(result.mode).toBe('native');
    expect(result.summary).toContain('clarification events not detected');
  });

  it('returns experimental when structuredIO but no permissionEvents', () => {
    const result = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 1.0.0',
      capabilities: {
        structuredIO: true,
        stdinResponses: false,
        permissionEvents: false,
        clarificationEvents: false,
      },
    });
    expect(result.mode).toBe('experimental');
    expect(result.summary).toContain('interactive events not confirmed');
  });

  it('returns text-only when version detected but no structured IO', () => {
    const result = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 0.9.0',
    });
    expect(result.mode).toBe('text-only');
    expect(result.summary).toContain('--print text-only');
  });

  it('returns unavailable when nothing detected', () => {
    const result = normalizeProbeResult(base);
    expect(result.mode).toBe('unavailable');
    expect(result.summary).toContain('not detected');
  });

  it('returns native, experimental, and text-only as registration-safe modes', () => {
    const registrationSafeModes = new Set(['native', 'experimental', 'text-only']);

    const allFour = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 2.0.0',
      capabilities: {
        structuredIO: true,
        stdinResponses: true,
        permissionEvents: true,
        clarificationEvents: true,
      },
    });
    expect(registrationSafeModes.has(allFour.mode)).toBe(true);

    const missingStdinResponses = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 1.0.0',
      capabilities: {
        structuredIO: true,
        stdinResponses: false,
        permissionEvents: true,
        clarificationEvents: true,
      },
    });
    expect(registrationSafeModes.has(missingStdinResponses.mode)).toBe(true);

    const missingClarification = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 1.0.0',
      capabilities: {
        structuredIO: true,
        stdinResponses: true,
        permissionEvents: true,
        clarificationEvents: false,
      },
    });
    expect(registrationSafeModes.has(missingClarification.mode)).toBe(true);

    const structuredIOOnly = normalizeProbeResult({
      ...base,
      rawVersion: 'claude 1.0.0',
      capabilities: {
        structuredIO: true,
        stdinResponses: false,
        permissionEvents: false,
        clarificationEvents: false,
      },
    });
    expect(registrationSafeModes.has(structuredIOOnly.mode)).toBe(true);

    const notInstalled = normalizeProbeResult(base);
    expect(registrationSafeModes.has(notInstalled.mode)).toBe(false);
  });
});
