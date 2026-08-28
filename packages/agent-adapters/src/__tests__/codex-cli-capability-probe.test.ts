import { describe, expect, it } from 'vitest';

import {
  normalizeCodexProbeResult,
  probeCodexCliCapabilities,
} from '../codex-cli-capability-probe';

function mockExec(responses: Record<string, { stdout: string; exitCode: number }>) {
  return (_command: string, args: string[]) =>
    Promise.resolve(responses[args.join(' ')] ?? { stdout: '', exitCode: 1 });
}

describe('probeCodexCliCapabilities', () => {
  it('detects JSONL support and authentication', async () => {
    const result = await probeCodexCliCapabilities({
      execFn: mockExec({
        '--version': { stdout: 'codex-cli 0.146.0\n', exitCode: 0 },
        'exec --help': { stdout: '--json --sandbox --model -m, --model', exitCode: 0 },
        'login status': { stdout: 'Logged in', exitCode: 0 },
      }),
    });
    expect(result.adapterName).toBe('codex');
    expect(result.rawVersion).toBe('codex-cli 0.146.0');
    expect(result.authenticated).toBe(true);
    expect(result.capabilities.structuredIO).toBe(true);
    expect(normalizeCodexProbeResult(result)).toMatchObject({ mode: 'streaming' });
  });

  it('reports unavailable when Codex cannot be executed', async () => {
    const result = await probeCodexCliCapabilities({
      execFn: () => Promise.reject(new Error('ENOENT')),
    });
    expect(result.rawVersion).toBeNull();
    expect(normalizeCodexProbeResult(result)).toMatchObject({ mode: 'unavailable' });
  });

  it('reports an unauthenticated CLI distinctly', async () => {
    const result = await probeCodexCliCapabilities({
      execFn: mockExec({
        '--version': { stdout: 'codex-cli 0.146.0', exitCode: 0 },
        'exec --help': { stdout: '--json', exitCode: 0 },
        'login status': { stdout: 'Not logged in', exitCode: 1 },
      }),
    });
    expect(normalizeCodexProbeResult(result)).toMatchObject({ mode: 'unauthenticated' });
  });
});
