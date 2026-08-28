import { describe, expect, it } from 'vitest';

import { TEST_BUILT_IN_DEFAULTS } from '../../../../test/fixtures/test-defaults';
import { validateConfiguration } from '../schema-validator';

describe('validateConfiguration', () => {
  it('validates built-in defaults successfully', () => {
    const report = validateConfiguration(TEST_BUILT_IN_DEFAULTS);
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it('reports missing workflow section', () => {
    const config = { ...TEST_BUILT_IN_DEFAULTS, workflow: undefined };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.path === 'workflow')).toBe(true);
  });

  it('reports missing roles section', () => {
    const config = { ...TEST_BUILT_IN_DEFAULTS, roles: undefined };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.path === 'roles')).toBe(true);
  });

  it('reports missing role assignment fields', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      roles: { assignments: { planner: {} } },
    };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.path === 'roles.assignments.planner.model')).toBe(true);
  });

  it('reports invalid globalTransitionLimit', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      workflow: { ...TEST_BUILT_IN_DEFAULTS.workflow, globalTransitionLimit: -1 },
    };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.path === 'workflow.globalTransitionLimit')).toBe(true);
  });

  it('reports invalid log level', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      runtime: { ...TEST_BUILT_IN_DEFAULTS.runtime, logLevel: 'verbose' },
    };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.path === 'runtime.logLevel')).toBe(true);
  });

  it('reports multiple errors at once', () => {
    const config = {} as Record<string, unknown>;
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(1);
  });

  it('includes remediation in every error', () => {
    const config = {} as Record<string, unknown>;
    const report = validateConfiguration(config);
    for (const error of report.errors) {
      expect(error.remediation).toBeTruthy();
    }
  });

  it('rejects unknown role in exclude_roles', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      workflow: {
        ...TEST_BUILT_IN_DEFAULTS.workflow,
        variants: {
          hotfix: {
            states: {
              CODE_REVIEW: { exclude_roles: ['nonexistent_reviewer'] },
            },
          },
        },
      },
    };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
    expect(
      report.errors.some(
        (e) => e.message.includes('nonexistent_reviewer') && e.message.includes('Unknown role'),
      ),
    ).toBe(true);
  });

  it('accepts valid exclude_roles with known roles', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      workflow: {
        ...TEST_BUILT_IN_DEFAULTS.workflow,
        variants: {
          hotfix: {
            states: {
              CODE_REVIEW: { exclude_roles: ['performance_reviewer'] },
            },
          },
        },
      },
    };
    const report = validateConfiguration(config);
    expect(report.errors.filter((e) => e.path.includes('exclude_roles'))).toHaveLength(0);
  });

  it('accepts valid budget config', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      governance: {
        ...TEST_BUILT_IN_DEFAULTS.governance,
        budget: {
          maxTokensPerRun: 500000,
          alertThresholds: [0.5, 0.75, 0.9],
        },
      },
    };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(true);
  });

  it('rejects non-integer maxTokensPerRun', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      governance: {
        ...TEST_BUILT_IN_DEFAULTS.governance,
        budget: { maxTokensPerRun: 1.5 },
      },
    };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
  });

  it('rejects alertThresholds outside 0-1 range', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      governance: {
        ...TEST_BUILT_IN_DEFAULTS.governance,
        budget: { alertThresholds: [0.5, 1.5] },
      },
    };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
  });

  it('warns on duplicate alertThresholds', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      governance: {
        ...TEST_BUILT_IN_DEFAULTS.governance,
        budget: { alertThresholds: [0.5, 0.5, 0.75] },
      },
    };
    const report = validateConfiguration(config);
    expect(report.warnings.some((w) => w.path.includes('alertThresholds'))).toBe(true);
  });

  it('accepts valid reportOutputPath', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      runtime: { ...TEST_BUILT_IN_DEFAULTS.runtime, reportOutputPath: '/tmp/report.md' },
    };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(true);
  });

  it('rejects empty reportOutputPath', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      runtime: { ...TEST_BUILT_IN_DEFAULTS.runtime, reportOutputPath: '' },
    };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
  });

  it('warns on excessive review iterations', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      governance: {
        ...TEST_BUILT_IN_DEFAULTS.governance,
        iterationLimits: {
          defaults: {
            ...TEST_BUILT_IN_DEFAULTS.governance.iterationLimits.defaults,
            maxReviewIterations: 15,
          },
        },
      },
    };
    const report = validateConfiguration(config);
    expect(report.warnings.some((w) => w.path.includes('maxReviewIterations'))).toBe(true);
  });

  it('warns on excessive acceptance iterations', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      governance: {
        ...TEST_BUILT_IN_DEFAULTS.governance,
        iterationLimits: {
          defaults: {
            ...TEST_BUILT_IN_DEFAULTS.governance.iterationLimits.defaults,
            maxAcceptanceIterations: 15,
          },
        },
      },
    };
    const report = validateConfiguration(config);
    expect(report.warnings.some((w) => w.path.includes('maxAcceptanceIterations'))).toBe(true);
  });

  it('reports unknown runner for agent-dispatched roles', () => {
    const runners = [{ id: 'claude-code', name: 'Claude Code', models: ['claude-opus-4-8'] }];
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      roles: {
        assignments: {
          ...TEST_BUILT_IN_DEFAULTS.roles.assignments,
          planner: {
            model: 'claude-opus-4-8',
            dispatchType: 'agent',
            runner: 'nonexistent-runner',
          },
        },
      },
    };
    const report = validateConfiguration(config, '<merged>', runners);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.path === 'roles.assignments.planner.runner')).toBe(true);
  });

  it('reports model not available for the assigned runner', () => {
    const runners = [{ id: 'claude-code', name: 'Claude Code', models: ['claude-opus-4-8'] }];
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      roles: {
        assignments: {
          ...TEST_BUILT_IN_DEFAULTS.roles.assignments,
          planner: {
            model: 'gpt-4o',
            dispatchType: 'agent',
            runner: 'claude-code',
          },
        },
      },
    };
    const report = validateConfiguration(config, '<merged>', runners);
    expect(report.valid).toBe(false);
    expect(
      report.errors.some(
        (e) =>
          e.path === 'roles.assignments.planner.model' &&
          e.message.includes('not available for runner'),
      ),
    ).toBe(true);
  });

  it('reports role assignment as non-object when given a scalar', () => {
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      roles: {
        assignments: {
          planner: 'not-an-object' as unknown,
        },
      },
    };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
    expect(
      report.errors.some(
        (e) => e.path === 'roles.assignments.planner' && e.message.includes('object'),
      ),
    ).toBe(true);
  });

  it('skips non-object role definitions during runner validation', () => {
    const runners = [{ id: 'claude-code', name: 'Claude Code', models: ['claude-opus-4-8'] }];
    const config = {
      ...TEST_BUILT_IN_DEFAULTS,
      roles: {
        assignments: {
          planner: 'bad-scalar' as unknown,
          implementer: { model: 'claude-opus-4-8', runner: 'claude-code' },
        },
      },
    };
    const report = validateConfiguration(config, '<merged>', runners);
    // planner error comes from Zod, not runner validation
    const runnerErrors = report.errors.filter((e) => e.path.includes('.runner'));
    expect(runnerErrors).toHaveLength(0);
  });

  it('reports missing governance section', () => {
    const config = { ...TEST_BUILT_IN_DEFAULTS, governance: undefined };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.path === 'governance')).toBe(true);
  });

  it('reports missing runtime section', () => {
    const config = { ...TEST_BUILT_IN_DEFAULTS, runtime: undefined };
    const report = validateConfiguration(config);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.path === 'runtime')).toBe(true);
  });
});
