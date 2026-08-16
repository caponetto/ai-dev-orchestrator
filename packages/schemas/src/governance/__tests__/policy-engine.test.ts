import { describe, expect, it } from 'vitest';

import {
  mergeLogEntrySchema,
  policyCompositionSchema,
  policyContextSchema,
  policyDecisionSchema,
  policyDefinitionSchema,
  policyFindingRefSchema,
  policyLayerSchema,
  policyOutcomeSchema,
  policyResultOutcomeSchema,
  policyResultSchema,
  policyScopeSchema,
  policySourceSchema,
  policyTypeInfoSchema,
  policyTypeSchema,
  policyValidationResultSchema,
} from '../policy-engine';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('policyLayerSchema', () => {
  it.each(['builtin', 'organization', 'project', 'workflow_variant', 'stage', 'role'])(
    'accepts "%s"',
    (val) => {
      expect(policyLayerSchema.safeParse(val).success).toBe(true);
    },
  );

  it('rejects invalid layer', () => {
    expect(policyLayerSchema.safeParse('global').success).toBe(false);
  });
});

describe('policySourceSchema', () => {
  it('validates a minimal source', () => {
    expect(policySourceSchema.safeParse({ layer: 'builtin' }).success).toBe(true);
  });

  it('validates with file and field paths', () => {
    const data = { layer: 'project', filePath: 'config.yaml', fieldPath: 'governance.policies' };
    expect(policySourceSchema.safeParse(data).success).toBe(true);
  });
});

describe('policyTypeSchema', () => {
  it.each([
    'iteration_limit',
    'quality_gate',
    'specification_readiness',
    'stage_skip',
    'retry_limit',
    'token_budget',
    'model_constraint',
    'ownership',
    'confidence_gate',
    'custom',
  ])('accepts "%s"', (val) => {
    expect(policyTypeSchema.safeParse(val).success).toBe(true);
  });
});

describe('policyCompositionSchema', () => {
  it.each(['conjunctive', 'disjunctive'])('accepts "%s"', (val) => {
    expect(policyCompositionSchema.safeParse(val).success).toBe(true);
  });
});

describe('policyScopeSchema', () => {
  it('validates an empty scope (all optional)', () => {
    expect(policyScopeSchema.safeParse({}).success).toBe(true);
  });

  it('validates a fully scoped policy', () => {
    const data = {
      organization: 'acme',
      project: 'backend',
      workflowVariant: 'fast',
      stages: ['IMPLEMENTATION'],
      roles: ['architect'],
    };
    expect(policyScopeSchema.safeParse(data).success).toBe(true);
  });
});

describe('policyDefinitionSchema (discriminated union)', () => {
  it('validates an iteration_limit policy', () => {
    const data = {
      id: 'p-1',
      type: 'iteration_limit',
      scope: {},
      enabled: true,
      config: {
        maxReviewIterations: 3,
        maxJudgeArbitrations: 2,
        maxClarificationRounds: 3,
        maxAcceptanceIterations: 2,
      },
    };
    expect(policyDefinitionSchema.safeParse(data).success).toBe(true);
  });

  it('validates a quality_gate policy', () => {
    const data = {
      id: 'p-2',
      type: 'quality_gate',
      scope: {},
      enabled: true,
      config: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 5 },
    };
    expect(policyDefinitionSchema.safeParse(data).success).toBe(true);
  });

  it('validates a token_budget policy', () => {
    const data = {
      id: 'p-3',
      type: 'token_budget',
      scope: {},
      enabled: true,
      config: { maxTokens: 100000 },
    };
    expect(policyDefinitionSchema.safeParse(data).success).toBe(true);
  });

  it('validates a custom policy', () => {
    const data = {
      id: 'p-4',
      type: 'custom',
      scope: {},
      enabled: true,
      config: { myCustomField: 'value' },
    };
    expect(policyDefinitionSchema.safeParse(data).success).toBe(true);
  });

  it('validates a stage_skip policy', () => {
    const data = {
      id: 'p-5',
      type: 'stage_skip',
      scope: {},
      enabled: true,
      config: { skipWhen: [{ field: 'metadata.skipTests', equals: true }] },
    };
    expect(policyDefinitionSchema.safeParse(data).success).toBe(true);
  });

  it('validates an ownership policy', () => {
    const data = {
      id: 'p-6',
      type: 'ownership',
      scope: {},
      enabled: true,
      config: { ownershipMap: { architect: ['plan'] }, strict: true },
    };
    expect(policyDefinitionSchema.safeParse(data).success).toBe(true);
  });

  it('validates a confidence_gate policy', () => {
    const data = {
      id: 'p-7',
      type: 'confidence_gate',
      scope: {},
      enabled: true,
      config: {
        modelEscalationThreshold: 0.5,
        humanEscalationThreshold: 0.3,
        heuristicWeight: 0.3,
        heuristicSignals: {
          penalizeHedgingLanguage: true,
          penalizeHighRetryCount: true,
          penalizeUnresolvedFindings: true,
        },
      },
    };
    expect(policyDefinitionSchema.safeParse(data).success).toBe(true);
  });

  it('rejects unknown policy type', () => {
    const data = {
      id: 'p-bad',
      type: 'unknown_policy',
      scope: {},
      enabled: true,
      config: {},
    };
    expect(policyDefinitionSchema.safeParse(data).success).toBe(false);
  });
});

describe('policyOutcomeSchema', () => {
  it.each(['allow', 'deny', 'escalate'])('accepts "%s"', (val) => {
    expect(policyOutcomeSchema.safeParse(val).success).toBe(true);
  });
});

describe('policyResultOutcomeSchema', () => {
  it.each(['pass', 'fail', 'skip', 'warn'])('accepts "%s"', (val) => {
    expect(policyResultOutcomeSchema.safeParse(val).success).toBe(true);
  });
});

describe('policyResultSchema', () => {
  it('validates a policy result', () => {
    const data = {
      policyId: 'p-1',
      policyType: 'iteration_limit',
      outcome: 'pass',
      reason: 'Within limits',
      source: { layer: 'builtin' },
    };
    expect(policyResultSchema.safeParse(data).success).toBe(true);
  });
});

describe('policyFindingRefSchema', () => {
  it('validates a finding ref', () => {
    const data = { id: 'f-1', severity: 'high', blocking: 'must_fix', status: 'open' };
    expect(policyFindingRefSchema.safeParse(data).success).toBe(true);
  });
});

describe('policyContextSchema', () => {
  it('validates a minimal context', () => {
    const data = { runId: 'r-1', currentState: 'IMPL', artifacts: [] };
    expect(policyContextSchema.safeParse(data).success).toBe(true);
  });

  it('validates a full context', () => {
    const data = {
      runId: 'r-1',
      currentState: 'IMPL',
      requestedTransition: { from: 'IMPL', to: 'REVIEW' },
      artifacts: [validRef],
      findings: [{ id: 'f-1', severity: 'high', blocking: 'must_fix', status: 'open' }],
      iterationCount: 2,
      role: 'architect',
      metadata: { completenessScore: 0.9, model: 'gpt-4' },
    };
    expect(policyContextSchema.safeParse(data).success).toBe(true);
  });
});

describe('policyDecisionSchema', () => {
  it('validates an allow decision', () => {
    const data = {
      outcome: 'allow',
      results: [],
      reason: 'All clear',
    };
    expect(policyDecisionSchema.safeParse(data).success).toBe(true);
  });

  it('validates a deny decision with remediations', () => {
    const data = {
      outcome: 'deny',
      results: [
        {
          policyId: 'p-1',
          policyType: 'quality_gate',
          outcome: 'fail',
          reason: 'Too many findings',
          source: { layer: 'builtin' },
        },
      ],
      reason: 'Quality gate failed',
      remediations: ['Fix high-severity findings'],
    };
    expect(policyDecisionSchema.safeParse(data).success).toBe(true);
  });
});

describe('mergeLogEntrySchema', () => {
  it('validates a merge log entry', () => {
    const data = {
      policyId: 'p-1',
      field: 'maxReviewIterations',
      fromLayer: 'builtin',
      toLayer: 'project',
      action: 'override',
      fromValue: 3,
      toValue: 5,
    };
    expect(mergeLogEntrySchema.safeParse(data).success).toBe(true);
  });
});

describe('policyTypeInfoSchema', () => {
  it('validates policy type info', () => {
    const data = {
      type: 'iteration_limit',
      description: 'Controls max iterations',
      configSchema: { maxReviewIterations: 'number' },
      builtIn: true,
    };
    expect(policyTypeInfoSchema.safeParse(data).success).toBe(true);
  });
});

describe('policyValidationResultSchema', () => {
  it('validates a passing result', () => {
    const data = { valid: true, errors: [], warnings: [] };
    expect(policyValidationResultSchema.safeParse(data).success).toBe(true);
  });
});
