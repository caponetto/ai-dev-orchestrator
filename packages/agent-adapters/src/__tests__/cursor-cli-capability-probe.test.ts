import { describe, expect, it } from 'vitest';

import type { CursorProbeResult } from '../cursor-cli-capability-probe';
import {
  probeCursorCliCapabilities,
  normalizeCursorProbeResult,
} from '../cursor-cli-capability-probe';

function mockExec(responses: Record<string, { stdout: string; exitCode: number }>) {
  return (_cmd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> => {
    const key = args[0] ?? '';
    return Promise.resolve(responses[key] ?? { stdout: '', exitCode: 1 });
  };
}

describe('probeCursorCliCapabilities', () => {
  it('detects streaming mode when stream-json present in help', async () => {
    const exec = mockExec({
      '--version': { stdout: 'cursor 1.0.0\n', exitCode: 0 },
      '--help': {
        stdout:
          '--output-format stream-json --force --stream-partial-output --print --approve-mcps',
        exitCode: 0,
      },
      status: { stdout: 'Logged in as user@example.com', exitCode: 0 },
    });

    const result = await probeCursorCliCapabilities({ execFn: exec });
    expect(result.adapterName).toBe('cursor');
    expect(result.capabilities.structuredIO).toBe(true);
    expect(result.rawVersion).toBe('cursor 1.0.0');
    expect(result.authenticated).toBe(true);
    expect(result.notes).toContain('stream-json output mode available');
    expect(result.notes).toContain('File modification flags (--force / --yolo) detected');
    expect(result.notes).toContain('Partial output streaming available');
    expect(result.notes).toContain('MCP auto-approval flag available');
    expect(result.notes).toContain('Authentication verified');
  });

  it('detects text-only when no stream-json in help', async () => {
    const exec = mockExec({
      '--version': { stdout: 'cursor 0.9.0\n', exitCode: 0 },
      '--help': { stdout: '--print --force', exitCode: 0 },
      status: { stdout: 'Logged in as user@example.com', exitCode: 0 },
    });

    const result = await probeCursorCliCapabilities({ execFn: exec });
    expect(result.capabilities.structuredIO).toBe(false);
    expect(result.rawVersion).toBe('cursor 0.9.0');
    expect(result.authenticated).toBe(true);
  });

  it('returns unavailable when command not found', async () => {
    const exec = () => Promise.reject(new Error('ENOENT'));

    const result = await probeCursorCliCapabilities({ execFn: exec });
    expect(result.capabilities.structuredIO).toBe(false);
    expect(result.rawVersion).toBeNull();
    expect(result.authenticated).toBeNull();
    expect(result.notes).toContain("Command 'agent' not found or not executable");
  });

  it('handles version check failure gracefully', async () => {
    const exec = mockExec({
      '--version': { stdout: '', exitCode: 127 },
      '--help': { stdout: '--output-format stream-json', exitCode: 0 },
      status: { stdout: 'Logged in as user@example.com', exitCode: 0 },
    });

    const result = await probeCursorCliCapabilities({ execFn: exec });
    expect(result.rawVersion).toBeNull();
    expect(result.capabilities.structuredIO).toBe(true);
    expect(result.authenticated).toBe(true);
  });

  it('handles help command failure gracefully', async () => {
    const exec = mockExec({
      '--version': { stdout: 'cursor 1.0.0\n', exitCode: 0 },
      status: { stdout: 'Logged in as user@example.com', exitCode: 0 },
    });
    const failingExec = (cmd: string, args: string[]) => {
      if (args[0] === '--help') {
        return Promise.reject(new Error('help failed'));
      }
      return exec(cmd, args);
    };

    const result = await probeCursorCliCapabilities({ execFn: failingExec });
    expect(result.rawVersion).toBe('cursor 1.0.0');
    expect(result.capabilities.structuredIO).toBe(false);
    expect(result.notes).toContain('Help command failed; capability detection incomplete');
  });

  it('detects unauthenticated when status exits non-zero', async () => {
    const exec = mockExec({
      '--version': { stdout: 'cursor 1.0.0\n', exitCode: 0 },
      '--help': {
        stdout: '--output-format stream-json --force --stream-partial-output --print',
        exitCode: 0,
      },
      status: { stdout: 'Not logged in', exitCode: 1 },
    });

    const result = await probeCursorCliCapabilities({ execFn: exec });
    expect(result.authenticated).toBe(false);
    expect(result.capabilities.structuredIO).toBe(true);
    expect(result.notes).toContain('Not authenticated');
  });

  it('handles status command failure gracefully', async () => {
    const exec = mockExec({
      '--version': { stdout: 'cursor 1.0.0\n', exitCode: 0 },
      '--help': { stdout: '--output-format stream-json', exitCode: 0 },
    });
    const failingExec = (cmd: string, args: string[]) => {
      if (args[0] === 'status') {
        return Promise.reject(new Error('status failed'));
      }
      return exec(cmd, args);
    };

    const result = await probeCursorCliCapabilities({ execFn: failingExec });
    expect(result.authenticated).toBeNull();
    expect(result.notes).toContain('Authentication check failed');
  });
});

describe('normalizeCursorProbeResult', () => {
  const base: CursorProbeResult = {
    adapterName: 'cursor',
    probedAt: '2026-01-01T00:00:00Z',
    rawVersion: null,
    authenticated: null,
    notes: [],
    capabilities: {
      structuredIO: false,
      permissionEvents: false,
      clarificationEvents: false,
      stdinResponses: false,
    },
  };

  it('returns streaming when structuredIO is true and authenticated', () => {
    const result = normalizeCursorProbeResult({
      ...base,
      rawVersion: 'cursor 1.0.0',
      authenticated: true,
      capabilities: { ...base.capabilities, structuredIO: true },
    });
    expect(result.mode).toBe('streaming');
    expect(result.summary).toContain('stream-json');
  });

  it('returns text-only when version detected but no structured IO', () => {
    const result = normalizeCursorProbeResult({
      ...base,
      rawVersion: 'cursor 0.9.0',
      authenticated: true,
    });
    expect(result.mode).toBe('text-only');
    expect(result.summary).toContain('text-only');
  });

  it('returns unavailable when nothing detected', () => {
    const result = normalizeCursorProbeResult(base);
    expect(result.mode).toBe('unavailable');
    expect(result.summary).toContain('not detected');
  });

  it('returns unauthenticated when authenticated is false', () => {
    const result = normalizeCursorProbeResult({
      ...base,
      rawVersion: 'cursor 1.0.0',
      authenticated: false,
      capabilities: { ...base.capabilities, structuredIO: true },
    });
    expect(result.mode).toBe('unauthenticated');
    expect(result.summary).toContain('not authenticated');
    expect(result.summary).toContain('agent login');
  });

  it('treats null authenticated as unknown and falls through to capability check', () => {
    const result = normalizeCursorProbeResult({
      ...base,
      rawVersion: 'cursor 1.0.0',
      authenticated: null,
      capabilities: { ...base.capabilities, structuredIO: true },
    });
    expect(result.mode).toBe('streaming');
  });
});
