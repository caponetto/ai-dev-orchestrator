import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkRunner,
  parseRunnerModels,
  RUNNERS_FILE,
  writeSummary,
} from '../runner-models/common.ts';
import { checkRolesUseListedModels } from '../runner-models/roles.ts';

let dir: string;
let summaryFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runner-models-'));
  summaryFile = join(dir, 'summary.md');
  vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const summary = (): string => readFileSync(summaryFile, 'utf8');

describe('writeSummary', () => {
  it('appends to the job summary file when running in Actions', () => {
    writeSummary('hello');
    expect(summary()).toBe('hello\n');
  });

  it('prints to stdout when there is no summary file', () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', '');
    writeSummary('hello');
    expect(console.log).toHaveBeenCalledWith('hello');
  });
});

describe('checkRunner', () => {
  const models = parseRunnerModels(readFileSync(RUNNERS_FILE, 'utf8')).get('opencode') ?? [];

  it('passes and reports new models when every listed model is available', () => {
    checkRunner({
      id: 'opencode',
      name: 'OpenCode CLI',
      version: () => '1.0.0',
      listModels: () => [...models, 'opencode/brand-new'].join('\n'),
    });
    expect(process.exitCode).toBeUndefined();
    expect(summary()).toContain('`1.0.0`');
    expect(summary()).toContain('New models available');
    expect(summary()).toContain('opencode/brand-new');
  });

  it('fails and reports removed models when a listed model disappears', () => {
    const [removed, ...rest] = models;
    checkRunner({
      id: 'opencode',
      name: 'OpenCode CLI',
      version: () => '1.0.0',
      listModels: () => rest.join('\n'),
    });
    expect(process.exitCode).toBe(1);
    expect(summary()).toContain('Removed models');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(String(removed)));
  });

  it('fails when the runner is unknown', () => {
    checkRunner({ id: 'nope', name: 'Nope', version: () => '1', listModels: () => '' });
    expect(process.exitCode).toBe(1);
  });

  it('fails when listing models throws', () => {
    checkRunner({
      id: 'opencode',
      name: 'OpenCode CLI',
      version: () => '1',
      listModels: () => {
        throw new Error('boom');
      },
    });
    expect(process.exitCode).toBe(1);
  });
});

describe('checkRolesUseListedModels', () => {
  const runnersFile = (): string => {
    const file = join(dir, 'runners.yaml');
    writeFileSync(
      file,
      'runners:\n  - id: opencode\n    name: O\n    models:\n      - opencode/a\n',
    );
    return file;
  };
  const rolesDir = (...roles: [string, string][]): string => {
    const rolesPath = join(dir, 'roles');
    mkdirSync(rolesPath);
    for (const [name, model] of roles) {
      writeFileSync(
        join(rolesPath, `${name}.yaml`),
        `id: ${name}\nmodel: ${model}\nrunner: opencode\n`,
      );
    }
    return rolesPath;
  };

  it('passes and writes a table when every role uses a listed model', () => {
    checkRolesUseListedModels(rolesDir(['planner', 'opencode/a']), runnersFile());
    expect(process.exitCode).toBeUndefined();
    expect(summary()).toContain('| `planner` | opencode | `opencode/a` | ✅ listed |');
  });

  it('fails when a role uses an unlisted model', () => {
    checkRolesUseListedModels(rolesDir(['planner', 'opencode/zzz']), runnersFile());
    expect(process.exitCode).toBe(1);
    expect(summary()).toContain('❌ not listed');
  });

  it('fails when no roles are found', () => {
    checkRolesUseListedModels(rolesDir(), runnersFile());
    expect(process.exitCode).toBe(1);
  });
});
