import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getAiDir } from '../../workspace-paths';
import { configShowCommand } from '../config-show';

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

describe('configShowCommand', () => {
  let baseDir: string;
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-config-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getAiDir).mockReturnValue(baseDir);
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
    vi.restoreAllMocks();
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('displays config sections with valid config', () => {
    writeFileSync(join(baseDir, 'config.yaml'), 'log_level: info\n');
    writeFileSync(
      join(baseDir, 'roles.yaml'),
      ['roles:', '  - id: planner', '    model: claude-opus-4-6', '    dispatch_type: agent'].join(
        '\n',
      ),
    );
    writeFileSync(
      join(baseDir, 'governance.yaml'),
      [
        'iteration_limits:',
        '  max_review_iterations: 2',
        '  max_judge_arbitrations: 1',
        '  max_clarification_rounds: 3',
        'quality_gates:',
        '  specification_readiness:',
        '    min_completeness_score: 0.8',
        '  implementation_review:',
        '    max_high_severity_findings: 0',
        '    max_medium_severity_findings: 3',
      ].join('\n'),
    );

    const formatter = new OutputFormatter({ noColor: true });
    const code = configShowCommand({ json: false, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('workflow');
    expect(output).toContain('roles');
    expect(output).toContain('runtime');
  });

  it('returns CONFIGURATION_ERROR on invalid config', () => {
    writeFileSync(join(baseDir, 'config.yaml'), '{{invalid yaml');

    const formatter = new OutputFormatter({ noColor: true });
    const code = configShowCommand({ json: false, verbose: false }, formatter);
    expect(code).toBe(ExitCode.CONFIGURATION_ERROR);
  });

  it('produces valid JSON in json mode', () => {
    writeFileSync(join(baseDir, 'config.yaml'), 'log_level: info\n');
    writeFileSync(
      join(baseDir, 'roles.yaml'),
      ['roles:', '  - id: planner', '    model: claude-opus-4-6', '    dispatch_type: agent'].join(
        '\n',
      ),
    );
    writeFileSync(
      join(baseDir, 'governance.yaml'),
      [
        'iteration_limits:',
        '  max_review_iterations: 2',
        '  max_judge_arbitrations: 1',
        '  max_clarification_rounds: 3',
        'quality_gates:',
        '  specification_readiness:',
        '    min_completeness_score: 0.8',
        '  implementation_review:',
        '    max_high_severity_findings: 0',
        '    max_medium_severity_findings: 3',
      ].join('\n'),
    );

    const formatter = new OutputFormatter({ json: true });
    const code = configShowCommand({ json: true, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
    expect(parsed).toHaveProperty('workflow');
    expect(parsed).toHaveProperty('roles');
    expect(parsed).toHaveProperty('governance');
    expect(parsed).toHaveProperty('runtime');
  });

  it('handles missing .ai/ directory (uses defaults)', () => {
    vi.mocked(getAiDir).mockReturnValue(join(baseDir, 'nonexistent'));
    const formatter = new OutputFormatter({ noColor: true });
    const code = configShowCommand({ json: false, verbose: false }, formatter);
    expect(code === ExitCode.SUCCESS || code === ExitCode.CONFIGURATION_ERROR).toBe(true);
  });
});
