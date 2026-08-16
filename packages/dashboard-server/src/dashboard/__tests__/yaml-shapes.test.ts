import { describe, expect, it } from 'vitest';

import {
  configYamlShapeSchema,
  governanceYamlShapeSchema,
  rolesYamlShapeSchema,
} from '../yaml-shapes';

describe('rolesYamlShapeSchema', () => {
  it('accepts a valid roles shape', () => {
    const result = rolesYamlShapeSchema.parse({
      roles: [{ id: 'implementer', name: 'Implementer', model: 'gpt-4' }],
    });
    expect(result.roles).toHaveLength(1);
    expect(result.roles?.[0].id).toBe('implementer');
  });

  it('accepts empty roles array', () => {
    const result = rolesYamlShapeSchema.parse({ roles: [] });
    expect(result.roles).toHaveLength(0);
  });

  it('accepts omitted roles field', () => {
    const result = rolesYamlShapeSchema.parse({});
    expect(result.roles).toBeUndefined();
  });

  it('accepts unknown extra keys (loose mode)', () => {
    const result = rolesYamlShapeSchema.parse({ roles: [], customField: 'ok' });
    expect(result).toHaveProperty('customField', 'ok');
  });

  it('accepts role entries with only id', () => {
    const result = rolesYamlShapeSchema.parse({ roles: [{ id: 'reviewer' }] });
    expect(result.roles?.[0].name).toBeUndefined();
    expect(result.roles?.[0].model).toBeUndefined();
  });

  it('rejects role entry without id', () => {
    expect(() => rolesYamlShapeSchema.parse({ roles: [{ name: 'No ID' }] })).toThrow();
  });
});

describe('governanceYamlShapeSchema', () => {
  it('accepts a full governance shape', () => {
    const result = governanceYamlShapeSchema.parse({
      iterationLimits: {
        maxReviewIterations: 3,
        maxJudgeArbitrations: 2,
        maxClarificationRounds: 5,
        defaults: { review: 3 },
      },
      qualityGates: {
        specificationReadiness: { minCompletenessScore: 0.8 },
        implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 5 },
      },
      budget: { maxTokensPerRun: 100000 },
      permissionPolicy: { read: true },
    });
    expect(result.iterationLimits?.maxReviewIterations).toBe(3);
    expect(result.budget?.maxTokensPerRun).toBe(100000);
  });

  it('accepts empty object', () => {
    const result = governanceYamlShapeSchema.parse({});
    expect(result.iterationLimits).toBeUndefined();
  });

  it('accepts null maxTokensPerRun in budget', () => {
    const result = governanceYamlShapeSchema.parse({ budget: { maxTokensPerRun: null } });
    expect(result.budget?.maxTokensPerRun).toBeNull();
  });

  it('accepts unknown extra keys (loose mode)', () => {
    const result = governanceYamlShapeSchema.parse({ extraField: 42 });
    expect(result).toHaveProperty('extraField', 42);
  });
});

describe('configYamlShapeSchema', () => {
  it('accepts a full config shape', () => {
    const result = configYamlShapeSchema.parse({
      logLevel: 'debug',
      defaultWorkflow: 'dev',
      workflowVersion: '1.0.0',
      globalTransitionLimit: 100,
      runtimeRoot: '/tmp/runtime',
      reportOutputPath: '/tmp/report',
    });
    expect(result.logLevel).toBe('debug');
    expect(result.globalTransitionLimit).toBe(100);
  });

  it('accepts empty object', () => {
    const result = configYamlShapeSchema.parse({});
    expect(result.logLevel).toBeUndefined();
  });

  it('accepts unknown extra keys (loose mode)', () => {
    const result = configYamlShapeSchema.parse({ customSetting: true });
    expect(result).toHaveProperty('customSetting', true);
  });

  it('rejects invalid types for known fields', () => {
    expect(() => configYamlShapeSchema.parse({ globalTransitionLimit: 'not-a-number' })).toThrow();
  });
});
