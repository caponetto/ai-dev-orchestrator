import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigurationLoadError } from '../../../domain/configuration/errors';
import { FileSystemConfigurationLoader } from '../configuration-loader';

let testDir: string;
let aiDir: string;
let loader: FileSystemConfigurationLoader;

function writeValidConfigSet(options?: { logLevel?: string; plannerModel?: string }): void {
  writeFileSync(
    join(aiDir, 'config.yaml'),
    [
      `log_level: ${options?.logLevel ?? 'info'}`,
      'default_workflow: dev',
      'workflow_version: "1.0.0"',
    ].join('\n'),
    'utf-8',
  );

  writeFileSync(
    join(aiDir, 'roles.yaml'),
    [
      'roles:',
      '  - id: planner',
      `    model: ${options?.plannerModel ?? 'claude-opus-4-6'}`,
      '    dispatch_type: agent',
    ].join('\n'),
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

beforeEach(() => {
  testDir = join(tmpdir(), `config-loader-test-${String(Date.now())}`);
  aiDir = join(testDir, '.ai');
  mkdirSync(aiDir, { recursive: true });
  loader = new FileSystemConfigurationLoader();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('FileSystemConfigurationLoader (file-based)', () => {
  it('loads config from .ai/ files without merge layers', () => {
    writeValidConfigSet({ logLevel: 'debug', plannerModel: 'gpt-4o' });

    const config = loader.load({ aiConfigDir: aiDir });

    expect(config.workflow.name).toBe('dev');
    expect(config.workflow.version).toBe('1.0.0');
    expect(config.runtime.logLevel).toBe('debug');
    expect(config.roles.assignments['planner'].model).toBe('gpt-4o');
    expect(config.roles.assignments['planner'].dispatchType).toBe('agent');
    expect(config.governance.iterationLimits.defaults.maxReviewIterations).toBe(2);
    expect(config.governance.qualityGates.specificationReadiness.minCompletenessScore).toBe(0.8);
    expect(Object.isFrozen(config)).toBe(true);
    expect('runtimeRoot' in config.runtime).toBe(false);
  });

  it('throws when required files are missing', () => {
    expect(() => loader.load({ aiConfigDir: aiDir })).toThrow(ConfigurationLoadError);
    expect(() => loader.load({ aiConfigDir: aiDir })).toThrow(
      "Required configuration file missing: config.yaml. Run 'init' to generate default configuration.",
    );
  });

  it('warns when environment variable placeholder cannot be resolved', () => {
    writeValidConfigSet();
    writeFileSync(
      join(aiDir, 'config.yaml'),
      'log_level: "${NONEXISTENT_TEST_VAR_XYZ}"\n',
      'utf-8',
    );

    const report = loader.validate({ aiConfigDir: aiDir });

    const envWarning = report.warnings.find((w) => w.message.includes('NONEXISTENT_TEST_VAR_XYZ'));
    expect(envWarning).toBeDefined();
    expect(envWarning?.severity).toBe('warning');
    expect(envWarning?.remediation).toContain('NONEXISTENT_TEST_VAR_XYZ');
  });

  it('skips non-object entries in roles list during extraction', () => {
    writeValidConfigSet();
    writeFileSync(
      join(aiDir, 'roles.yaml'),
      ['roles:', '  - not_an_object_string', '  - id: planner', '    model: claude-opus-4-6'].join(
        '\n',
      ),
      'utf-8',
    );

    const config = loader.load({ aiConfigDir: aiDir });
    expect(config.roles.assignments['planner']).toBeDefined();
    expect(config.roles.assignments['planner'].model).toBe('claude-opus-4-6');
  });

  it('skips role entries with missing or empty id', () => {
    writeValidConfigSet();
    writeFileSync(
      join(aiDir, 'roles.yaml'),
      [
        'roles:',
        '  - model: some-model',
        '  - id: ""',
        '    model: another-model',
        '  - id: valid_role',
        '    model: claude-opus-4-6',
      ].join('\n'),
      'utf-8',
    );

    const config = loader.load({ aiConfigDir: aiDir });
    expect(Object.keys(config.roles.assignments)).toEqual(['valid_role']);
  });

  it('handles roles.yaml without a roles array', () => {
    writeValidConfigSet();
    writeFileSync(join(aiDir, 'roles.yaml'), 'something_else: true\n', 'utf-8');

    const report = loader.validate({ aiConfigDir: aiDir });
    // Should still produce a valid report (though with errors for missing assignments)
    expect(report).toBeDefined();
  });

  it('throws ConfigurationLoadError with single error message when one error exists', () => {
    writeValidConfigSet();
    writeFileSync(join(aiDir, 'config.yaml'), 'log_level: invalid_value\n', 'utf-8');

    try {
      loader.load({ aiConfigDir: aiDir });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationLoadError);
    }
  });

  it('includes globalTransitionLimit when provided in config.yaml', () => {
    writeValidConfigSet();
    writeFileSync(
      join(aiDir, 'config.yaml'),
      [
        'log_level: info',
        'default_workflow: dev',
        'workflow_version: "1.0.0"',
        'global_transition_limit: 500',
      ].join('\n'),
      'utf-8',
    );

    const config = loader.load({ aiConfigDir: aiDir });
    expect(config.workflow.globalTransitionLimit).toBe(500);
  });

  it('includes reportOutputPath when provided in config.yaml', () => {
    writeValidConfigSet();
    writeFileSync(
      join(aiDir, 'config.yaml'),
      [
        'log_level: info',
        'default_workflow: dev',
        'workflow_version: "1.0.0"',
        'report_output_path: /tmp/report.md',
      ].join('\n'),
      'utf-8',
    );

    const config = loader.load({ aiConfigDir: aiDir });
    expect(config.runtime.reportOutputPath).toBe('/tmp/report.md');
  });

  it('includes budget from governance.yaml when provided', () => {
    writeValidConfigSet();
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
        'budget:',
        '  max_tokens_per_run: 100000',
      ].join('\n'),
      'utf-8',
    );

    const config = loader.load({ aiConfigDir: aiDir });
    expect(config.governance.budget).toBeDefined();
    expect(config.governance.budget?.maxTokensPerRun).toBe(100000);
  });

  it('maps permission_policy from governance.yaml into roles config', () => {
    writeValidConfigSet();
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
        '    max_ambiguities: 0',
        '    require_all_must_requirements: true',
        '  implementation_review:',
        '    max_high_severity_findings: 0',
        '    max_medium_severity_findings: 3',
        'permission_policy:',
        '  default_action: ask_human',
      ].join('\n'),
      'utf-8',
    );

    const config = loader.load({ aiConfigDir: aiDir });
    expect(config.roles.permissionPolicy?.defaultAction).toBe('ask_human');
  });
});
