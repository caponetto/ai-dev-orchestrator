import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigurationLoadError } from '../../src/domain/configuration/errors';
import { FileSystemConfigurationLoader } from '../../src/infrastructure/configuration/configuration-loader';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'config-integration-'));
}

function writeValidConfigSet(aiDir: string, plannerModel = 'claude-opus-4-8'): void {
  writeFileSync(
    join(aiDir, 'config.yaml'),
    'log_level: info\ndefault_workflow: dev\nworkflow_version: "1.0.0"\n',
    'utf-8',
  );
  writeFileSync(
    join(aiDir, 'roles.yaml'),
    ['roles:', '  - id: planner', `    model: ${plannerModel}`, '    dispatch_type: agent'].join(
      '\n',
    ),
    'utf-8',
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
    'utf-8',
  );
}

describe('Configuration Load Integration', () => {
  it('loads configuration from required .ai/ files', () => {
    const dir = tempDir();
    const aiDir = join(dir, '.ai');
    mkdirSync(aiDir);
    writeValidConfigSet(aiDir);

    const loader = new FileSystemConfigurationLoader();
    const config = loader.load({ aiConfigDir: aiDir });

    expect(config.workflow.name).toBe('dev');
    expect(config.workflow.version).toBe('1.0.0');
    expect(config.roles.assignments['planner'].model).toBe('claude-opus-4-8');
    expect(config.runtime.logLevel).toBe('info');
  });

  it('reads role assignments from unified roles.yaml entries', () => {
    const dir = tempDir();
    const aiDir = join(dir, '.ai');
    mkdirSync(aiDir);
    writeValidConfigSet(aiDir, 'gpt-4o');

    const loader = new FileSystemConfigurationLoader();
    const config = loader.load({ aiConfigDir: aiDir });

    expect(config.roles.assignments['planner'].model).toBe('gpt-4o');
  });

  it('validation returns errors for invalid config', () => {
    const dir = tempDir();
    const aiDir = join(dir, '.ai');
    mkdirSync(aiDir);
    writeValidConfigSet(aiDir);
    writeFileSync(join(aiDir, 'roles.yaml'), 'roles:\n  - id: planner\n    model: ""\n', 'utf-8');

    const loader = new FileSystemConfigurationLoader();
    const report = loader.validate({ aiConfigDir: aiDir });

    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors.some((e) => e.path.includes('planner'))).toBe(true);
  });

  it('throws ConfigurationLoadError on invalid config', () => {
    const dir = tempDir();
    const aiDir = join(dir, '.ai');
    mkdirSync(aiDir);
    writeValidConfigSet(aiDir);
    writeFileSync(join(aiDir, 'config.yaml'), 'log_level: invalid_level\n', 'utf-8');

    const loader = new FileSystemConfigurationLoader();
    expect(() => loader.load({ aiConfigDir: aiDir })).toThrow(ConfigurationLoadError);
  });

  it('returns frozen configuration', () => {
    const dir = tempDir();
    const aiDir = join(dir, '.ai');
    mkdirSync(aiDir);
    writeValidConfigSet(aiDir);

    const loader = new FileSystemConfigurationLoader();
    const config = loader.load({ aiConfigDir: aiDir });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.workflow)).toBe(true);
    expect(Object.isFrozen(config.roles)).toBe(true);
  });

  it('handles YAML parse error in project config', () => {
    const dir = tempDir();
    const aiDir = join(dir, '.ai');
    mkdirSync(aiDir);
    writeValidConfigSet(aiDir);
    writeFileSync(join(aiDir, 'config.yaml'), 'invalid:\n  yaml: [\n', 'utf-8');

    const loader = new FileSystemConfigurationLoader();
    const report = loader.validate({ aiConfigDir: aiDir });

    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it('reports missing required files', () => {
    const dir = tempDir();
    const aiDir = join(dir, '.ai');
    mkdirSync(aiDir);

    const loader = new FileSystemConfigurationLoader();
    const report = loader.validate({ aiConfigDir: aiDir });

    expect(report.valid).toBe(false);
    expect(report.errors[0].message).toContain("Run 'init' to generate default configuration.");
  });
});
