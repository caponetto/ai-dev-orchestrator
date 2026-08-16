import { describe, expect, it } from 'vitest';

import {
  budgetConfigSchema,
  customRoleDefinitionSchema,
  governanceConfigSchema,
  iterationLimitConfigSchema,
  iterationLimitDefaultsSchema,
  logLevelSchema,
  mergedConfigurationSchema,
  permissionPolicySchema,
  permissionRuleSchema,
  qualityGateConfigSchema,
  roleAssignmentSchema,
  rolesConfigSchema,
  runtimeConfigSchema,
  specificationReadinessGateSchema,
  workflowConfigSchema,
} from '../configuration';

describe('logLevelSchema', () => {
  it.each(['debug', 'info', 'warn', 'error'])('accepts "%s"', (level) => {
    expect(logLevelSchema.safeParse(level).success).toBe(true);
  });

  it('rejects invalid level', () => {
    expect(logLevelSchema.safeParse('verbose').success).toBe(false);
  });
});

describe('runtimeConfigSchema', () => {
  it('validates minimal config', () => {
    expect(runtimeConfigSchema.safeParse({ logLevel: 'info' }).success).toBe(true);
  });

  it('validates with optional reportOutputPath', () => {
    const data = { logLevel: 'debug', reportOutputPath: '/tmp/report.json' };
    expect(runtimeConfigSchema.safeParse(data).success).toBe(true);
  });
});

describe('specificationReadinessGateSchema', () => {
  it('validates a gate config', () => {
    expect(specificationReadinessGateSchema.safeParse({ minCompletenessScore: 0.8 }).success).toBe(
      true,
    );
  });
});

describe('qualityGateConfigSchema', () => {
  it('validates a quality gate config', () => {
    const data = {
      specificationReadiness: { minCompletenessScore: 0.8 },
      implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
    };
    expect(qualityGateConfigSchema.safeParse(data).success).toBe(true);
  });
});

describe('iterationLimitDefaultsSchema', () => {
  it('validates defaults', () => {
    const data = {
      maxReviewIterations: 3,
      maxJudgeArbitrations: 2,
      maxClarificationRounds: 3,
      maxAcceptanceIterations: 2,
    };
    expect(iterationLimitDefaultsSchema.safeParse(data).success).toBe(true);
  });
});

describe('iterationLimitConfigSchema', () => {
  it('validates config with defaults', () => {
    const data = {
      defaults: {
        maxReviewIterations: 3,
        maxJudgeArbitrations: 2,
        maxClarificationRounds: 3,
        maxAcceptanceIterations: 2,
      },
    };
    expect(iterationLimitConfigSchema.safeParse(data).success).toBe(true);
  });
});

describe('budgetConfigSchema', () => {
  it('validates empty budget (all optional)', () => {
    expect(budgetConfigSchema.safeParse({}).success).toBe(true);
  });

  it('validates with max tokens and thresholds', () => {
    const data = { maxTokensPerRun: 100000, alertThresholds: [0.5, 0.8, 0.95] };
    expect(budgetConfigSchema.safeParse(data).success).toBe(true);
  });
});

describe('governanceConfigSchema', () => {
  it('validates a full governance config', () => {
    const data = {
      iterationLimits: {
        defaults: {
          maxReviewIterations: 3,
          maxJudgeArbitrations: 2,
          maxClarificationRounds: 3,
          maxAcceptanceIterations: 2,
        },
      },
      qualityGates: {
        specificationReadiness: { minCompletenessScore: 0.8 },
        implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
      },
    };
    expect(governanceConfigSchema.safeParse(data).success).toBe(true);
  });
});

describe('roleAssignmentSchema', () => {
  it('validates minimal assignment', () => {
    expect(roleAssignmentSchema.safeParse({ model: 'gpt-4' }).success).toBe(true);
  });

  it('validates with agent dispatch', () => {
    const data = {
      model: 'claude-3',
      dispatchType: 'agent' as const,
      runner: 'codex',
      agentConfig: { instructions: 'Do the thing' },
    };
    expect(roleAssignmentSchema.safeParse(data).success).toBe(true);
  });
});

describe('customRoleDefinitionSchema', () => {
  it('validates a custom role', () => {
    const data = {
      description: 'Custom reviewer',
      ownedArtifacts: ['static_review'],
      readableArtifacts: ['implementation'],
      forbiddenArtifacts: [],
      requiredCapabilities: ['code_review'],
    };
    expect(customRoleDefinitionSchema.safeParse(data).success).toBe(true);
  });
});

describe('permissionRuleSchema', () => {
  it('validates a grant rule', () => {
    const data = { action: 'file_read', decision: 'grant' };
    expect(permissionRuleSchema.safeParse(data).success).toBe(true);
  });

  it('validates a deny rule with scope', () => {
    const data = { action: 'shell_execute', decision: 'deny', scope: 'global', pattern: 'rm *' };
    expect(permissionRuleSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid decision', () => {
    expect(permissionRuleSchema.safeParse({ action: 'x', decision: 'maybe' }).success).toBe(false);
  });
});

describe('permissionPolicySchema', () => {
  it('validates an empty policy (all optional)', () => {
    expect(permissionPolicySchema.safeParse({}).success).toBe(true);
  });

  it('validates a full policy', () => {
    const data = {
      defaultAction: 'deny',
      rules: [{ action: 'file_read', decision: 'grant' }],
      roleTrust: { architect: 'high' },
      safeCommands: ['ls', 'cat'],
    };
    expect(permissionPolicySchema.safeParse(data).success).toBe(true);
  });
});

describe('rolesConfigSchema', () => {
  it('validates a roles config', () => {
    const data = {
      assignments: { architect: { model: 'gpt-4' } },
    };
    expect(rolesConfigSchema.safeParse(data).success).toBe(true);
  });
});

describe('workflowConfigSchema', () => {
  it('validates a workflow config', () => {
    const data = { name: 'default', version: '1.0.0' };
    expect(workflowConfigSchema.safeParse(data).success).toBe(true);
  });

  it('rejects empty name', () => {
    expect(workflowConfigSchema.safeParse({ name: '', version: '1.0' }).success).toBe(false);
  });
});

describe('mergedConfigurationSchema', () => {
  it('validates a full merged configuration', () => {
    const data = {
      workflow: { name: 'default', version: '1.0.0' },
      roles: { assignments: { architect: { model: 'gpt-4' } } },
      governance: {
        iterationLimits: {
          defaults: {
            maxReviewIterations: 3,
            maxJudgeArbitrations: 2,
            maxClarificationRounds: 3,
            maxAcceptanceIterations: 2,
          },
        },
        qualityGates: {
          specificationReadiness: { minCompletenessScore: 0.8 },
          implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
        },
      },
      runtime: { logLevel: 'info' },
    };
    expect(mergedConfigurationSchema.safeParse(data).success).toBe(true);
  });
});
