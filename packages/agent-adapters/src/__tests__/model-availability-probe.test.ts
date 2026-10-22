import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelProbeCommand } from '../model-availability-probe';
import { probeModelAvailability } from '../model-availability-probe';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const success = {
  'claude-code': '{"type":"result","subtype":"success","is_error":false,"result":"OK"}',
  codex: '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
  cursor: '{"type":"result","subtype":"success","is_error":false,"result":"OK"}',
  opencode: '{"type":"step_finish","part":{"reason":"stop"}}',
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('probeModelAvailability', () => {
  it.each(['claude-code', 'codex', 'cursor', 'opencode'] as const)(
    'verifies a successful %s inference in a temporary directory and cleans it up',
    async (runner) => {
      let cwd = '';
      const execFn = vi.fn((command: ModelProbeCommand) => {
        cwd = command.cwd;
        expect(existsSync(cwd)).toBe(true);
        expect(command.timeoutMs).toBe(30_000);
        expect(command.args).toContain('--model');
        expect(command.args).toContain('selected-model');
        expect(command.args).not.toContain('--auto');
        expect(command.args).not.toContain('--force');
        if (runner === 'opencode') {
          expect(command.env['OPENCODE_CONFIG_CONTENT']).toContain('ask');
        }
        return Promise.resolve({ stdout: success[runner], stderr: '', exitCode: 0 });
      });

      expect(await probeModelAvailability(runner, 'selected-model', { execFn })).toEqual({
        available: true,
      });
      expect(existsSync(cwd)).toBe(false);
    },
  );

  it('omits model flags when checking the runner default', async () => {
    const execFn = vi.fn((_command: ModelProbeCommand) =>
      Promise.resolve({ stdout: success.codex, stderr: '', exitCode: 0 }),
    );
    await probeModelAvailability('codex', undefined, { execFn });
    expect(execFn.mock.calls[0]?.[0].args).not.toContain('--model');
  });

  it('uses the repository configuration context when supplied', async () => {
    const execFn = vi.fn((_command: ModelProbeCommand) =>
      Promise.resolve({ stdout: success.codex, stderr: '', exitCode: 0 }),
    );
    await probeModelAvailability('codex', 'model', { cwd: '/repo', execFn });
    expect(execFn.mock.calls[0]?.[0].cwd).toBe('/repo');
  });

  it('preserves OpenCode provider overrides while requiring tool approval', async () => {
    vi.stubEnv('OPENCODE_CONFIG_CONTENT', '{"provider":{"custom":{}},"permission":{"*":"allow"}}');
    const execFn = vi.fn((_command: ModelProbeCommand) =>
      Promise.resolve({ stdout: success.opencode, stderr: '', exitCode: 0 }),
    );
    await probeModelAvailability('opencode', 'custom/model', { execFn });
    expect(execFn.mock.calls[0]?.[0].env['OPENCODE_CONFIG_CONTENT']).toBe(
      '{"provider":{"custom":{}},"permission":{"*":"ask"}}',
    );
  });

  it('keeps tool definitions for OpenCode free-tier checks without auto-approving execution', async () => {
    const execFn = vi.fn((command: ModelProbeCommand) => {
      const config = JSON.parse(command.env['OPENCODE_CONFIG_CONTENT'] ?? '{}') as {
        permission?: Record<string, string>;
      };
      expect(command.args.slice(0, 3)).toEqual(['run', '--format', 'json']);
      expect(command.args).not.toContain('--auto');
      expect(command.args).not.toContain('--interactive');
      expect(config.permission).toEqual({ '*': 'ask' });
      return Promise.resolve({ stdout: success.opencode, stderr: '', exitCode: 0 });
    });

    expect(await probeModelAvailability('opencode', 'opencode/big-pickle', { execFn })).toEqual({
      available: true,
    });
  });

  it.each(['null', '[]', 'invalid'])(
    'fails closed for invalid OpenCode overrides: %s',
    async (content) => {
      vi.stubEnv('OPENCODE_CONFIG_CONTENT', content);
      const execFn = vi.fn();
      const result = await probeModelAvailability('opencode', 'model', { execFn });
      expect(result.available).toBe(false);
      expect(execFn).not.toHaveBeenCalled();
    },
  );

  it('detects provider errors even if the CLI exits with zero', async () => {
    const result = await probeModelAvailability('opencode', 'retired/model', {
      execFn: () =>
        Promise.resolve({
          stdout: '{"type":"error","error":{"data":{"message":"Model retired"}}}',
          stderr: '',
          exitCode: 0,
        }),
    });
    expect(result).toEqual({ available: false, detail: 'Model retired' });
  });

  it('requires successful completion, not just startup or an empty zero exit', async () => {
    expect(
      await probeModelAvailability('codex', 'model', {
        execFn: () =>
          Promise.resolve({
            stdout: '{"type":"thread.started","thread_id":"test"}',
            stderr: '',
            exitCode: 0,
          }),
      }),
    ).toMatchObject({
      available: false,
      detail: expect.stringContaining('did not complete') as unknown,
    });
  });

  it('does not accept a successful turn followed by a process failure', async () => {
    expect(
      await probeModelAvailability('codex', 'model', {
        execFn: () =>
          Promise.resolve({ stdout: success.codex, stderr: 'Not authenticated', exitCode: 1 }),
      }),
    ).toEqual({ available: false, detail: 'Not authenticated' });
  });

  it('returns execution errors and removes the temporary directory', async () => {
    let cwd = '';
    const result = await probeModelAvailability('cursor', 'model', {
      execFn: (command) => {
        cwd = command.cwd;
        return Promise.reject(new Error('ENOENT'));
      },
    });
    expect(result).toEqual({ available: false, detail: 'ENOENT' });
    expect(existsSync(cwd)).toBe(false);
  });

  it('reports unsupported runners without executing anything', async () => {
    expect(await probeModelAvailability('http', 'model')).toMatchObject({
      available: false,
      detail: expect.stringContaining('not supported') as unknown,
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('closes stdin and bounds real subprocess execution', async () => {
    const end = vi.fn();
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as (error: null, stdout: string, stderr: string) => void;
      callback(null, success.codex, '');
      return { stdin: { end } } as unknown as ReturnType<typeof execFile>;
    });
    expect(await probeModelAvailability('codex', 'model')).toEqual({ available: true });
    expect(end).toHaveBeenCalledOnce();
    expect(execFile).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({ timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }),
      expect.any(Function),
    );
  });

  it.each([
    [{ killed: true }, 'timed out'],
    [Object.assign(new Error('Executable missing'), { code: 'ENOENT' }), 'Executable missing'],
    [{ code: 1 }, 'Authentication failed'],
  ])('returns subprocess failures: %j', async (error, detail) => {
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as (err: unknown, stdout: string, stderr: string) => void;
      callback(error, '', 'Authentication failed');
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    });
    expect(await probeModelAvailability('codex', 'model')).toMatchObject({
      available: false,
      detail: expect.stringContaining(detail) as unknown,
    });
  });
});
