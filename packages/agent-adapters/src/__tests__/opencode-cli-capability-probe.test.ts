import { describe, expect, it } from 'vitest';

import {
  normalizeOpencodeProbeResult,
  probeOpencodeCliCapabilities,
} from '../opencode-cli-capability-probe';

function mockExec(responses: Record<string, { stdout: string; exitCode: number }>) {
  return (_command: string, args: string[]) =>
    Promise.resolve(responses[args.join(' ')] ?? { stdout: '', exitCode: 1 });
}

describe('probeOpencodeCliCapabilities', () => {
  it('detects JSON event output support and available models', async () => {
    const result = await probeOpencodeCliCapabilities({
      execFn: mockExec({
        '--version': { stdout: '1.18.30\n', exitCode: 0 },
        'run --help': { stdout: '--format --auto --model -m, --model', exitCode: 0 },
        models: { stdout: 'opencode/mimo-v2.5-free\n', exitCode: 0 },
      }),
    });
    expect(result.adapterName).toBe('opencode');
    expect(result.rawVersion).toBe('1.18.30');
    expect(result.authenticated).toBe(true);
    expect(result.capabilities.structuredIO).toBe(true);
    expect(normalizeOpencodeProbeResult(result)).toMatchObject({ mode: 'streaming' });
  });

  it('reports unavailable when OpenCode cannot be executed', async () => {
    const result = await probeOpencodeCliCapabilities({
      execFn: () => Promise.reject(new Error('ENOENT')),
    });
    expect(result.rawVersion).toBeNull();
    expect(normalizeOpencodeProbeResult(result)).toMatchObject({ mode: 'unavailable' });
  });

  it('reports unauthenticated when models check fails', async () => {
    const result = await probeOpencodeCliCapabilities({
      execFn: mockExec({
        '--version': { stdout: '1.18.30', exitCode: 0 },
        'run --help': { stdout: '--format --auto', exitCode: 0 },
        models: { stdout: '', exitCode: 1 },
      }),
    });
    expect(result.authenticated).toBe(false);
    expect(normalizeOpencodeProbeResult(result)).toMatchObject({ mode: 'unauthenticated' });
  });

  it('reports text-only when structuredIO is not supported', async () => {
    const result = await probeOpencodeCliCapabilities({
      execFn: mockExec({
        '--version': { stdout: '1.18.30', exitCode: 0 },
        'run --help': { stdout: 'basic help', exitCode: 0 },
        models: { stdout: 'opencode/mimo-v2.5-free', exitCode: 0 },
      }),
    });
    expect(result.capabilities.structuredIO).toBe(false);
    expect(normalizeOpencodeProbeResult(result)).toMatchObject({ mode: 'text-only' });
  });
});
