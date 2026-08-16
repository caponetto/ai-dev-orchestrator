import { describe, expect, it } from 'vitest';

import {
  agentConfigSchema,
  agreementParticipationSchema,
  modelAssignmentSchema,
  modelCapabilitySchema,
  roleContractSchema,
  roleIdSchema,
  roleValidationErrorSchema,
  roleValidationResultSchema,
  roleValidationWarningSchema,
} from '../role-system';

describe('roleIdSchema', () => {
  it('accepts task-breakdown role IDs', () => {
    expect(roleIdSchema.safeParse('breakdown_analyst').success).toBe(true);
    expect(roleIdSchema.safeParse('decomposer').success).toBe(true);
    expect(roleIdSchema.safeParse('decomposition_reviewer').success).toBe(true);
    expect(roleIdSchema.safeParse('task_spec_writer').success).toBe(true);
  });
});

describe('modelCapabilitySchema', () => {
  it.each([
    'code_generation',
    'code_review',
    'reasoning',
    'long_context',
    'structured_output',
    'vision',
    'external_data_fetch',
  ])('accepts "%s"', (val) => {
    expect(modelCapabilitySchema.safeParse(val).success).toBe(true);
  });

  it('rejects invalid capability', () => {
    expect(modelCapabilitySchema.safeParse('translation').success).toBe(false);
  });
});

describe('agentConfigSchema', () => {
  it('validates empty config (all optional)', () => {
    expect(agentConfigSchema.safeParse({}).success).toBe(true);
  });

  it('validates a full agent config', () => {
    const data = {
      model: 'gpt-4',
      timeoutMs: 30000,
      instructions: 'Implement the feature',
      command: 'codex',
      args: ['--model', 'gpt-4'],
      handshakeTimeoutMs: 5000,
      liveRequestTimeoutMs: 60000,
      endpoint: 'https://api.example.com',
      authHeader: 'Bearer token',
      pollIntervalMs: 1000,
      maxTurns: 25,
    };
    expect(agentConfigSchema.safeParse(data).success).toBe(true);
  });

  it('rejects non-positive maxTurns', () => {
    expect(agentConfigSchema.safeParse({ maxTurns: 0 }).success).toBe(false);
    expect(agentConfigSchema.safeParse({ maxTurns: -5 }).success).toBe(false);
  });
});

describe('agreementParticipationSchema', () => {
  it('validates participation', () => {
    const data = { agreementType: 'planning_agreement', action: 'produced' };
    expect(agreementParticipationSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid action', () => {
    const data = { agreementType: 'planning_agreement', action: 'ignored' };
    expect(agreementParticipationSchema.safeParse(data).success).toBe(false);
  });
});

describe('roleContractSchema', () => {
  it('validates a role contract', () => {
    const data = {
      id: 'planner',
      name: 'Planner',
      description: 'Designs the system',
      ownedArtifacts: ['plan'],
      readableArtifacts: ['intake_requirements', 'canonical_specification'],
      forbiddenArtifacts: [],
      reviewedBy: ['plan_reviewer'],
      reviews: [],
      agreementParticipation: [{ agreementType: 'planning_agreement', action: 'produced' }],
      requiredCapabilities: ['reasoning', 'structured_output'],
      dispatchType: 'agent',
    };
    expect(roleContractSchema.safeParse(data).success).toBe(true);
  });

  it('accepts agent dispatch with runner', () => {
    const data = {
      id: 'implementer',
      name: 'Implementer',
      description: 'Implements code',
      ownedArtifacts: ['implementation'],
      readableArtifacts: [],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: ['code_generation'],
      dispatchType: 'agent',
      runner: 'claude-code',
    };
    const result = roleContractSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runner).toBe('claude-code');
    }
  });

  it('rejects invalid dispatchType', () => {
    const data = {
      id: 'planner',
      name: 'Test',
      description: 'Test role',
      ownedArtifacts: [],
      readableArtifacts: [],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: [],
      dispatchType: 'direct',
    };
    expect(roleContractSchema.safeParse(data).success).toBe(false);
  });
});

describe('modelAssignmentSchema', () => {
  it('validates a minimal assignment', () => {
    const data = { roleId: 'planner', model: 'gpt-4' };
    expect(modelAssignmentSchema.safeParse(data).success).toBe(true);
  });

  it('validates with optional fields', () => {
    const data = {
      roleId: 'planner',
      model: 'gpt-4',
      maxTokens: 4096,
      systemPrompt: 'You are an architect',
      parameters: { temperature: 0.7 },
    };
    expect(modelAssignmentSchema.safeParse(data).success).toBe(true);
  });
});

describe('roleValidationErrorSchema', () => {
  it('validates a validation error', () => {
    const data = { roleId: 'planner', field: 'model', message: 'Model not available' };
    expect(roleValidationErrorSchema.safeParse(data).success).toBe(true);
  });
});

describe('roleValidationWarningSchema', () => {
  it('validates a warning', () => {
    const data = { roleId: 'planner', message: 'No explicit timeout set' };
    expect(roleValidationWarningSchema.safeParse(data).success).toBe(true);
  });
});

describe('roleValidationResultSchema', () => {
  it('validates a passing result', () => {
    expect(
      roleValidationResultSchema.safeParse({ valid: true, errors: [], warnings: [] }).success,
    ).toBe(true);
  });

  it('validates a failing result', () => {
    const data = {
      valid: false,
      errors: [{ roleId: 'planner', field: 'model', message: 'Missing' }],
      warnings: [],
    };
    expect(roleValidationResultSchema.safeParse(data).success).toBe(true);
  });
});
