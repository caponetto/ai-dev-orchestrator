import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { collectVersionInfo, versionCommand } from '../version';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<{ execSync: (...args: unknown[]) => unknown }>();
  return { ...actual, execSync: vi.fn(actual.execSync) };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<{
    existsSync: (...args: unknown[]) => unknown;
    readFileSync: (...args: unknown[]) => unknown;
  }>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

describe('versionCommand', () => {
  let stdout: string;

  beforeEach(() => {
    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns SUCCESS exit code', () => {
    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    const result = versionCommand({ json: false }, formatter);
    expect(result).toBe(ExitCode.SUCCESS);
  });

  it('outputs version info in text mode', () => {
    const formatter = new OutputFormatter({ json: false, noColor: true, verbose: false });
    versionCommand({ json: false }, formatter);
    expect(stdout).toContain('Version:');
    expect(stdout).toContain('Commit:');
    expect(stdout).toContain('Build Date:');
    expect(stdout).toContain('Node:');
    expect(stdout).toContain('Platform:');
  });

  it('outputs valid JSON in json mode', () => {
    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    versionCommand({ json: true }, formatter);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty('name');
    expect(parsed).toHaveProperty('version');
    expect(parsed).toHaveProperty('commitSha');
    expect(parsed).toHaveProperty('buildDate');
    expect(parsed).toHaveProperty('nodeVersion');
    expect(parsed).toHaveProperty('platform');
    expect(parsed).toHaveProperty('arch');
  });

  it('includes node version from process', () => {
    const formatter = new OutputFormatter({ json: true, noColor: true, verbose: false });
    versionCommand({ json: true }, formatter);
    const parsed = JSON.parse(stdout) as Record<string, string>;
    expect(parsed['nodeVersion']).toBe(process.version);
  });
});

describe('collectVersionInfo', () => {
  it('returns all required fields', () => {
    const info = collectVersionInfo();
    expect(info.name).toBeDefined();
    expect(info.version).toBeDefined();
    expect(info.commitSha).toBeDefined();
    expect(info.buildDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(info.nodeVersion).toBe(process.version);
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
  });

  it('commitSha is a short hex or unknown', () => {
    const info = collectVersionInfo();
    expect(info.commitSha).toMatch(/^([0-9a-f]{7,}|unknown)$/);
  });

  it('platform and arch match process values', () => {
    const info = collectVersionInfo();
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
  });
});

describe('collectVersionInfo error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "unknown" commitSha when git is unavailable', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git not found');
    });

    const info = collectVersionInfo();
    expect(info.commitSha).toBe('unknown');
  });

  it('returns default version when package.json contains invalid content', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue('not valid json');

    const info = collectVersionInfo();
    expect(info.name).toBe('ai-dev-orchestrator');
    expect(info.version).toBe('0.0.0');
  });

  it('returns default version when package.json cannot be read', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const info = collectVersionInfo();
    expect(info.name).toBe('ai-dev-orchestrator');
    expect(info.version).toBe('0.0.0');
  });

  it('falls back to grandparent package.json when parent does not exist', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('{"name":"test-app","version":"2.0.0"}');

    const info = collectVersionInfo();
    expect(info.name).toBe('test-app');
    expect(info.version).toBe('2.0.0');
  });

  it('uses default name when package.json has no name field', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue('{"version":"1.0.0"}');

    const info = collectVersionInfo();
    expect(info.name).toBe('ai-dev-orchestrator');
    expect(info.version).toBe('1.0.0');
  });

  it('uses default version when package.json has no version field', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue('{"name":"my-app"}');

    const info = collectVersionInfo();
    expect(info.name).toBe('my-app');
    expect(info.version).toBe('0.0.0');
  });
});
