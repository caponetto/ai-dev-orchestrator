import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { ALL_PARTIAL_IDS, ALL_ROLE_IDS } from '@ai-dev-orchestrator/config-templates';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getAiDir } from '../../workspace-paths';
import { initCommand } from '../init';

vi.mock('../../workspace-paths', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getAiDir: vi.fn(),
    getRunsDir: vi.fn(),
    getRunDir: vi.fn(),
    getDashboardLogPath: vi.fn(),
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    homedir: vi.fn((actual as { homedir: () => string }).homedir),
  };
});

const fsRefs = vi.hoisted(() => ({
  existsSync: (_path: string | Buffer | URL): boolean => {
    throw new Error('real existsSync not yet initialized');
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const mod = actual as { existsSync: typeof existsSync };
  fsRefs.existsSync = mod.existsSync;
  return {
    ...(actual as object),
    existsSync: vi.fn(mod.existsSync),
  };
});

describe('initCommand', () => {
  let baseDir: string;
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    vi.mocked(existsSync).mockImplementation((p) => fsRefs.existsSync(p));
    baseDir = join(tmpdir(), `ai-test-init-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getAiDir).mockReturnValue(join(baseDir, '.ai'));
    vi.mocked(homedir).mockReturnValue(baseDir);
    stdoutChunks = [];
    stderrChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    if (fsRefs.existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('creates .ai/ directory with default config files', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = initCommand({ force: false, json: false, verbose: false }, formatter);

    const aiDir = getAiDir();
    expect(code).toBe(ExitCode.SUCCESS);
    expect(existsSync(aiDir)).toBe(true);
    expect(existsSync(join(aiDir, 'config.yaml'))).toBe(true);
    expect(existsSync(join(aiDir, 'roles.yaml'))).toBe(true);
    expect(existsSync(join(aiDir, 'governance.yaml'))).toBe(true);
    expect(existsSync(join(aiDir, 'templates'))).toBe(true);
    expect(existsSync(join(aiDir, 'runs'))).toBe(true);

    const templates = readdirSync(join(aiDir, 'templates'));
    expect(templates).toContain('partials');
    const templateFiles = templates.filter((f) => f.endsWith('.md'));
    expect(templateFiles).toHaveLength(ALL_ROLE_IDS.length);
    for (const roleId of ALL_ROLE_IDS) {
      expect(templateFiles).toContain(`${roleId}.md`);
    }

    const partials = readdirSync(join(aiDir, 'templates', 'partials'));
    expect(partials).toHaveLength(ALL_PARTIAL_IDS.length);
    for (const partialId of ALL_PARTIAL_IDS) {
      expect(partials).toContain(`${partialId}.md`);
    }
  });

  it('writes valid YAML content to config files', () => {
    const formatter = new OutputFormatter({ noColor: true });
    initCommand({ force: false, json: false, verbose: false }, formatter);

    const config = readFileSync(join(getAiDir(), 'config.yaml'), 'utf-8');
    expect(config).toContain('log_level: info');
    expect(config).toContain('default_workflow: dev');
  });

  it('returns CONFIGURATION_ERROR when .ai/ already exists without --force', () => {
    mkdirSync(getAiDir(), { recursive: true });

    const formatter = new OutputFormatter({ noColor: true });
    const code = initCommand({ force: false, json: false, verbose: false }, formatter);

    expect(code).toBe(ExitCode.CONFIGURATION_ERROR);
    expect(stderrChunks.join('')).toContain('already exists');
  });

  it('overwrites existing .ai/ directory with --force', () => {
    const aiDir = getAiDir();
    mkdirSync(aiDir, { recursive: true });
    writeFileSync(join(aiDir, 'config.yaml'), 'old content');

    const formatter = new OutputFormatter({ noColor: true });
    const code = initCommand({ force: true, json: false, verbose: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    const config = readFileSync(join(aiDir, 'config.yaml'), 'utf-8');
    expect(config).toContain('default_workflow: dev');
  });

  it('produces valid JSON in json mode', () => {
    const formatter = new OutputFormatter({ json: true });
    const code = initCommand({ force: false, json: true, verbose: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
    expect(parsed).toHaveProperty('status', 'success');
    expect(parsed).toHaveProperty('directory');
    expect(parsed).toHaveProperty('filesCreated');
  });

  it('lists created files in verbose mode', () => {
    const formatter = new OutputFormatter({ noColor: true });
    initCommand({ force: false, json: false, verbose: true }, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('config.yaml');
    expect(output).toContain('roles.yaml');
    expect(output).toContain('governance.yaml');
    expect(output).toContain('templates/');
    expect(output).toContain('runs/');
  });

  it('skips existing files without force flag (verbose)', () => {
    const aiDir = getAiDir();
    mkdirSync(aiDir, { recursive: true });
    mkdirSync(join(aiDir, 'runs'), { recursive: true });
    writeFileSync(join(aiDir, 'config.yaml'), 'existing content', 'utf-8');

    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p) === aiDir) {
        return false;
      }
      return fsRefs.existsSync(p);
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = initCommand({ force: false, json: false, verbose: true }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('Skipping existing file: config.yaml');
  });

  it('skips existing files without force flag (non-verbose)', () => {
    const aiDir = getAiDir();
    mkdirSync(aiDir, { recursive: true });
    mkdirSync(join(aiDir, 'runs'), { recursive: true });
    writeFileSync(join(aiDir, 'config.yaml'), 'existing content', 'utf-8');

    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p) === aiDir) {
        return false;
      }
      return fsRefs.existsSync(p);
    });

    const formatter = new OutputFormatter({ noColor: true });
    const code = initCommand({ force: false, json: false, verbose: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).not.toContain('Skipping');
  });

  it('overwrites existing files with force flag', () => {
    const formatter = new OutputFormatter({ noColor: true });
    initCommand({ force: true, json: false, verbose: false }, formatter);

    stdoutChunks = [];
    const code = initCommand({ force: true, json: false, verbose: true }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).not.toContain('Skipping');
    expect(output).toContain('config.yaml');
  });
});
