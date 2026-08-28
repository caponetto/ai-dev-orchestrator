import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ValidationReport } from '@ai-orchestrator/ports';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getAiDir } from '../../workspace-paths';
import { emitFormattedValidation, emitJsonValidation, validateCommand } from '../validate';

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

describe('validateCommand', () => {
  let baseDir: string;
  let stdoutChunks: string[];

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-validate-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getAiDir).mockReturnValue(join(baseDir, '.ai'));
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('returns SUCCESS with valid config', () => {
    const aiDir = getAiDir();
    mkdirSync(aiDir, { recursive: true });
    writeFileSync(join(aiDir, 'config.yaml'), 'log_level: info\n');
    writeFileSync(
      join(aiDir, 'roles.yaml'),
      ['roles:', '  - id: planner', '    model: claude-opus-4-8', '    dispatch_type: agent'].join(
        '\n',
      ),
    );
    writeFileSync(
      join(aiDir, 'governance.yaml'),
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
    const code = validateCommand({ json: false, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(stdoutChunks.join('')).toContain('valid');
  });

  it('returns CONFIGURATION_ERROR with invalid config', () => {
    const aiDir = getAiDir();
    mkdirSync(aiDir, { recursive: true });
    writeFileSync(join(aiDir, 'config.yaml'), '{{invalid yaml');

    const formatter = new OutputFormatter({ noColor: true });
    const code = validateCommand({ json: false, verbose: false }, formatter);
    expect(code).toBe(ExitCode.CONFIGURATION_ERROR);
  });

  it('handles missing .ai/ directory gracefully', () => {
    vi.mocked(getAiDir).mockReturnValue(join(baseDir, 'nonexistent'));
    const formatter = new OutputFormatter({ noColor: true });
    const code = validateCommand({ json: false, verbose: false }, formatter);
    expect(code === ExitCode.SUCCESS || code === ExitCode.CONFIGURATION_ERROR).toBe(true);
  });

  it('produces valid JSON in json mode', () => {
    const aiDir = getAiDir();
    mkdirSync(aiDir, { recursive: true });
    writeFileSync(join(aiDir, 'config.yaml'), 'log_level: info\n');
    writeFileSync(
      join(aiDir, 'roles.yaml'),
      ['roles:', '  - id: planner', '    model: claude-opus-4-8', '    dispatch_type: agent'].join(
        '\n',
      ),
    );
    writeFileSync(
      join(aiDir, 'governance.yaml'),
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
    const code = validateCommand({ json: true, verbose: false }, formatter);
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
    expect(parsed).toHaveProperty('valid');
    expect(parsed).toHaveProperty('errors');
    expect(parsed).toHaveProperty('warnings');
  });
});

describe('emitJsonValidation', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('outputs valid JSON with report fields', () => {
    const report: ValidationReport = {
      valid: true,
      errors: [],
      warnings: [],
    };

    emitJsonValidation(report);

    const parsed = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('includes errors and warnings in JSON output', () => {
    const report: ValidationReport = {
      valid: false,
      errors: [
        {
          severity: 'error',
          file: 'config.yaml',
          path: 'log_level',
          message: 'invalid',
          remediation: 'fix it',
        },
      ],
      warnings: [
        {
          severity: 'warning',
          file: 'roles.yaml',
          path: 'roles.0.model',
          message: 'deprecated',
          remediation: 'update',
        },
      ],
    };

    emitJsonValidation(report);

    const parsed = JSON.parse(stdoutChunks[0] ?? '') as ValidationReport;
    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.errors[0].message).toBe('invalid');
  });
});

describe('emitFormattedValidation', () => {
  let stdoutChunks: string[];

  let stderrChunks: string[];

  beforeEach(() => {
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
  });

  it('shows success message for valid config', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const report: ValidationReport = { valid: true, errors: [], warnings: [] };

    emitFormattedValidation(report, { json: false, verbose: false }, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('valid');
  });

  it('shows errors with remediation', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const report: ValidationReport = {
      valid: false,
      errors: [
        {
          severity: 'error',
          file: 'config.yaml',
          path: 'log_level',
          message: 'must be a string',
          remediation: 'Set log_level to info',
        },
      ],
      warnings: [],
    };

    emitFormattedValidation(report, { json: false, verbose: false }, formatter);

    const output = stdoutChunks.join('') + stderrChunks.join('');
    expect(output).toContain('log_level');
    expect(output).toContain('must be a string');
  });

  it('shows warnings only in verbose mode', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const report: ValidationReport = {
      valid: true,
      errors: [],
      warnings: [
        {
          severity: 'warning',
          file: 'roles.yaml',
          path: 'roles.0.model',
          message: 'model deprecated',
          remediation: 'update model',
        },
      ],
    };

    emitFormattedValidation(report, { json: false, verbose: false }, formatter);
    const outputNonVerbose = stdoutChunks.join('');
    expect(outputNonVerbose).not.toContain('model deprecated');

    stdoutChunks = [];
    emitFormattedValidation(report, { json: false, verbose: true }, formatter);
    const outputVerbose = stdoutChunks.join('');
    expect(outputVerbose).toContain('Warnings');
    expect(outputVerbose).toContain('model deprecated');
  });
});
