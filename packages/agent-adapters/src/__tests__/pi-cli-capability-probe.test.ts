import { describe, expect, it } from 'vitest';

import {
  normalizePiProbeResult,
  parseListModelsOutput,
  probePiCliCapabilities,
} from '../pi-cli-capability-probe';

function mockExec(responses: Record<string, { stdout: string; exitCode: number }>) {
  return (_command: string, args: string[]) =>
    Promise.resolve(responses[args.join(' ')] ?? { stdout: '', exitCode: 1 });
}

describe('probePiCliCapabilities', () => {
  it('detects JSON event output support and available models', async () => {
    const result = await probePiCliCapabilities({
      execFn: mockExec({
        '--version': { stdout: '1.5.2\n', exitCode: 0 },
        '--help': {
          stdout: '--mode <mode> --model <pattern> --print\n  text (default), json, or rpc',
          exitCode: 0,
        },
        '--list-models': {
          stdout:
            'provider        model                    context  max-out  thinking  images\n' +
            'anthropic       claude-fable-5           1M       128K     yes       yes\n' +
            'anthropic       claude-haiku-4-5         200K     64K      yes       yes\n',
          exitCode: 0,
        },
      }),
    });
    expect(result.adapterName).toBe('pi');
    expect(result.rawVersion).toBe('1.5.2');
    expect(result.authenticated).toBe(true);
    expect(result.availableModels).toEqual([
      'anthropic/claude-fable-5',
      'anthropic/claude-haiku-4-5',
    ]);
    expect(result.capabilities.structuredIO).toBe(true);
    expect(normalizePiProbeResult(result)).toMatchObject({ mode: 'streaming' });
  });

  it('reports unavailable when pi cannot be executed', async () => {
    const result = await probePiCliCapabilities({
      execFn: () => Promise.reject(new Error('ENOENT')),
    });
    expect(result.rawVersion).toBeNull();
    expect(normalizePiProbeResult(result)).toMatchObject({ mode: 'unavailable' });
  });

  it('reports unauthenticated when models check fails', async () => {
    const result = await probePiCliCapabilities({
      execFn: mockExec({
        '--version': { stdout: '1.5.2', exitCode: 0 },
        '--help': { stdout: '--mode json', exitCode: 0 },
        '--list-models': { stdout: '', exitCode: 1 },
      }),
    });
    expect(result.authenticated).toBe(false);
    expect(normalizePiProbeResult(result)).toMatchObject({ mode: 'unauthenticated' });
  });

  it('reports text-only when JSON mode is not supported', async () => {
    const result = await probePiCliCapabilities({
      execFn: mockExec({
        '--version': { stdout: '1.5.2', exitCode: 0 },
        '--help': { stdout: 'basic help', exitCode: 0 },
        '--list-models': { stdout: '', exitCode: 0 },
      }),
    });
    expect(result.capabilities.structuredIO).toBe(false);
    expect(normalizePiProbeResult(result)).toMatchObject({ mode: 'text-only' });
  });
});

describe('parseListModelsOutput', () => {
  it('skips the header row and non-model rows', () => {
    const models = parseListModelsOutput(
      'provider  model   context  max-out\n' +
        'anthropic claude-fable-5 1M 128K\n' +
        '\n' +
        'some free-form text\n',
    );
    expect(models).toEqual(['anthropic/claude-fable-5']);
  });

  it('deduplicates models offered by multiple providers', () => {
    const models = parseListModelsOutput(
      'anthropic claude-fable-5 1M 128K\nanthropic claude-fable-5 1M 128K\n',
    );
    expect(models).toEqual(['anthropic/claude-fable-5']);
  });
});
