import { describe, expect, it } from 'vitest';

import {
  ambiguityResultSchema,
  ambiguitySchema,
  ambiguitySeveritySchema,
  analystConfigSchema,
  analystInputSchema,
  analystOutputSchema,
  clarificationQuestionCategorySchema,
  clarificationQuestionSchema,
  intakeConfigSchema,
  intakeResultSchema,
  intakeVerdictSchema,
  intermediateRequirementsSchema,
  requirementsAnalysisSchema,
  sourceMetadataSchema,
} from '../intake';

// ---- Helpers ----

const minimalCanonicalSpec = {
  id: 'spec-001',
  version: 1,
  title: 'Test Spec',
  businessGoal: 'Automate testing',
  stakeholders: [],
  assumptions: [],
  constraints: [],
  functionalRequirements: [],
  nonFunctionalRequirements: [],
  acceptanceCriteria: [],
  risks: [],
  dependencies: [],
  definitionOfDone: [],
  sources: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const validAnalystConfig = {
  readinessThreshold: 0.8,
  maxAmbiguities: 5,
  requireExplicitAssumptions: true,
};

const validRequirementsAnalysis = {
  completenessScore: 0.7,
  ambiguities: [],
  assumptions: [],
  risks: [],
  constraints: [],
  dependencies: [],
  missingInformation: [],
};

// ---- intakeVerdictSchema ----

describe('intakeVerdictSchema', () => {
  it.each(['Ready', 'NotReady'])('accepts "%s"', (value) => {
    expect(intakeVerdictSchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown verdict', () => {
    expect(intakeVerdictSchema.safeParse('Pending').success).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(intakeVerdictSchema.safeParse(true).success).toBe(false);
    expect(intakeVerdictSchema.safeParse(null).success).toBe(false);
  });
});

// ---- sourceMetadataSchema ----

describe('sourceMetadataSchema', () => {
  it('accepts valid metadata', () => {
    const data = { fetchedAt: '2026-01-01T00:00:00Z', checksum: 'sha256-abc' };
    expect(sourceMetadataSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing fetchedAt', () => {
    expect(sourceMetadataSchema.safeParse({ checksum: 'sha256-abc' }).success).toBe(false);
  });

  it('rejects missing checksum', () => {
    expect(sourceMetadataSchema.safeParse({ fetchedAt: '2026-01-01T00:00:00Z' }).success).toBe(
      false,
    );
  });

  it('rejects empty object', () => {
    expect(sourceMetadataSchema.safeParse({}).success).toBe(false);
  });
});

// ---- intermediateRequirementsSchema ----

describe('intermediateRequirementsSchema', () => {
  it('accepts with only required sourceMetadata', () => {
    const data = {
      sourceMetadata: { fetchedAt: '2026-01-01T00:00:00Z', checksum: 'sha256-abc' },
    };
    expect(intermediateRequirementsSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with all optional fields', () => {
    const data = {
      title: 'My requirements',
      description: 'Detailed description',
      rawFields: { custom: 'data', nested: { key: 1 } },
      sourceMetadata: { fetchedAt: '2026-01-01T00:00:00Z', checksum: 'sha256-abc' },
    };
    expect(intermediateRequirementsSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing sourceMetadata', () => {
    expect(
      intermediateRequirementsSchema.safeParse({ title: 'title', description: 'desc' }).success,
    ).toBe(false);
  });
});

// ---- analystConfigSchema ----

describe('analystConfigSchema', () => {
  it('accepts valid config', () => {
    expect(analystConfigSchema.safeParse(validAnalystConfig).success).toBe(true);
  });

  it('rejects missing readinessThreshold', () => {
    expect(
      analystConfigSchema.safeParse({
        maxAmbiguities: 5,
        requireExplicitAssumptions: true,
      }).success,
    ).toBe(false);
  });

  it('rejects missing maxAmbiguities', () => {
    expect(
      analystConfigSchema.safeParse({
        readinessThreshold: 0.8,
        requireExplicitAssumptions: true,
      }).success,
    ).toBe(false);
  });

  it('rejects missing requireExplicitAssumptions', () => {
    expect(
      analystConfigSchema.safeParse({
        readinessThreshold: 0.8,
        maxAmbiguities: 5,
      }).success,
    ).toBe(false);
  });

  it('rejects non-number readinessThreshold', () => {
    expect(
      analystConfigSchema.safeParse({
        readinessThreshold: '0.8',
        maxAmbiguities: 5,
        requireExplicitAssumptions: true,
      }).success,
    ).toBe(false);
  });

  it('rejects non-boolean requireExplicitAssumptions', () => {
    expect(
      analystConfigSchema.safeParse({
        readinessThreshold: 0.8,
        maxAmbiguities: 5,
        requireExplicitAssumptions: 'yes',
      }).success,
    ).toBe(false);
  });
});

// ---- intakeConfigSchema ----

describe('intakeConfigSchema', () => {
  it('accepts valid config', () => {
    const data = { analyst: validAnalystConfig };
    expect(intakeConfigSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing analyst', () => {
    expect(intakeConfigSchema.safeParse({}).success).toBe(false);
  });
});

// ---- intakeResultSchema ----

describe('intakeResultSchema', () => {
  it('accepts a valid result', () => {
    const data = {
      verdict: 'Ready',
      artifacts: [{ type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' }],
    };
    expect(intakeResultSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with empty artifacts', () => {
    const data = { verdict: 'NotReady', artifacts: [] };
    expect(intakeResultSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid verdict', () => {
    const data = { verdict: 'Pending', artifacts: [] };
    expect(intakeResultSchema.safeParse(data).success).toBe(false);
  });

  it('rejects missing artifacts', () => {
    expect(intakeResultSchema.safeParse({ verdict: 'Ready' }).success).toBe(false);
  });

  it('rejects invalid artifact ref in array', () => {
    const data = {
      verdict: 'Ready',
      artifacts: [{ type: 'invalid_type', name: 'x', version: 1, checksum: 'c' }],
    };
    expect(intakeResultSchema.safeParse(data).success).toBe(false);
  });
});

// ---- ambiguitySeveritySchema ----

describe('ambiguitySeveritySchema', () => {
  it.each(['high', 'medium', 'low'])('accepts "%s"', (value) => {
    expect(ambiguitySeveritySchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown severity', () => {
    expect(ambiguitySeveritySchema.safeParse('critical').success).toBe(false);
  });
});

// ---- ambiguitySchema ----

describe('ambiguitySchema', () => {
  it('accepts a valid ambiguity', () => {
    const data = {
      id: 'amb-1',
      field: 'description',
      description: 'Unclear scope',
      severity: 'high',
    };
    expect(ambiguitySchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing id', () => {
    expect(
      ambiguitySchema.safeParse({
        field: 'description',
        description: 'Unclear',
        severity: 'low',
      }).success,
    ).toBe(false);
  });

  it('rejects missing field', () => {
    expect(
      ambiguitySchema.safeParse({
        id: 'amb-1',
        description: 'Unclear',
        severity: 'low',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid severity', () => {
    const data = { id: 'amb-1', field: 'f', description: 'd', severity: 'extreme' };
    expect(ambiguitySchema.safeParse(data).success).toBe(false);
  });
});

// ---- requirementsAnalysisSchema ----

describe('requirementsAnalysisSchema', () => {
  it('accepts a valid analysis with empty arrays', () => {
    expect(requirementsAnalysisSchema.safeParse(validRequirementsAnalysis).success).toBe(true);
  });

  it('accepts with populated arrays', () => {
    const data = {
      completenessScore: 0.5,
      ambiguities: [{ id: 'amb-1', field: 'f', description: 'd', severity: 'high' }],
      assumptions: [{ id: 'a-1', description: 'd', impact: 'medium', validated: false }],
      risks: [{ id: 'r-1', description: 'd', likelihood: 'low', impact: 'high' }],
      constraints: [{ id: 'c-1', description: 'd', type: 'technical', source: 's' }],
      dependencies: [{ id: 'd-1', description: 'd', type: 'internal', status: 'pending' }],
      missingInformation: ['Error handling strategy', 'Deployment target'],
    };
    expect(requirementsAnalysisSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing completenessScore', () => {
    const { completenessScore: _, ...rest } = validRequirementsAnalysis;
    expect(requirementsAnalysisSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing ambiguities', () => {
    const { ambiguities: _, ...rest } = validRequirementsAnalysis;
    expect(requirementsAnalysisSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing missingInformation', () => {
    const { missingInformation: _, ...rest } = validRequirementsAnalysis;
    expect(requirementsAnalysisSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-number completenessScore', () => {
    expect(
      requirementsAnalysisSchema.safeParse({
        ...validRequirementsAnalysis,
        completenessScore: 'high',
      }).success,
    ).toBe(false);
  });
});

// ---- clarificationQuestionCategorySchema ----

describe('clarificationQuestionCategorySchema', () => {
  it.each(['ambiguity', 'missing', 'assumption', 'risk', 'constraint'])('accepts "%s"', (value) => {
    expect(clarificationQuestionCategorySchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown category', () => {
    expect(clarificationQuestionCategorySchema.safeParse('bug').success).toBe(false);
  });
});

// ---- clarificationQuestionSchema ----

describe('clarificationQuestionSchema', () => {
  it('accepts a valid question', () => {
    const data = {
      id: 'q-1',
      category: 'ambiguity',
      question: 'What is the expected behavior?',
      context: 'Requirements mention "fast" without metrics',
    };
    expect(clarificationQuestionSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with optional suggestedDefault', () => {
    const data = {
      id: 'q-1',
      category: 'missing',
      question: 'What auth provider?',
      context: 'No auth mentioned',
      suggestedDefault: 'OAuth 2.0',
    };
    expect(clarificationQuestionSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing question', () => {
    expect(
      clarificationQuestionSchema.safeParse({
        id: 'q-1',
        category: 'risk',
        context: 'ctx',
      }).success,
    ).toBe(false);
  });

  it('rejects missing context', () => {
    expect(
      clarificationQuestionSchema.safeParse({
        id: 'q-1',
        category: 'risk',
        question: 'q',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid category', () => {
    const data = { id: 'q-1', category: 'feature', question: 'q', context: 'c' };
    expect(clarificationQuestionSchema.safeParse(data).success).toBe(false);
  });
});

// ---- analystInputSchema ----

describe('analystInputSchema', () => {
  it('accepts valid input', () => {
    const data = {
      specification: minimalCanonicalSpec,
      config: validAnalystConfig,
    };
    expect(analystInputSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing specification', () => {
    expect(analystInputSchema.safeParse({ config: validAnalystConfig }).success).toBe(false);
  });

  it('rejects missing config', () => {
    expect(analystInputSchema.safeParse({ specification: minimalCanonicalSpec }).success).toBe(
      false,
    );
  });

  it('rejects invalid specification', () => {
    expect(
      analystInputSchema.safeParse({
        specification: { id: 'x' },
        config: validAnalystConfig,
      }).success,
    ).toBe(false);
  });
});

// ---- analystOutputSchema ----

describe('analystOutputSchema', () => {
  it('accepts a valid output', () => {
    const data = {
      verdict: 'Ready',
      analysis: validRequirementsAnalysis,
    };
    expect(analystOutputSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with optional questions', () => {
    const data = {
      verdict: 'NotReady',
      analysis: validRequirementsAnalysis,
      questions: [{ id: 'q-1', category: 'ambiguity', question: 'q', context: 'c' }],
    };
    expect(analystOutputSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing verdict', () => {
    expect(analystOutputSchema.safeParse({ analysis: validRequirementsAnalysis }).success).toBe(
      false,
    );
  });

  it('rejects missing analysis', () => {
    expect(analystOutputSchema.safeParse({ verdict: 'Ready' }).success).toBe(false);
  });

  it('rejects invalid verdict', () => {
    expect(
      analystOutputSchema.safeParse({
        verdict: 'Maybe',
        analysis: validRequirementsAnalysis,
      }).success,
    ).toBe(false);
  });
});

// ---- ambiguityResultSchema ----

describe('ambiguityResultSchema', () => {
  it('accepts a valid result with empty ambiguities', () => {
    const data = { ambiguities: [], isReady: true };
    expect(ambiguityResultSchema.safeParse(data).success).toBe(true);
  });

  it('accepts a result with ambiguities', () => {
    const data = {
      ambiguities: [{ id: 'amb-1', field: 'f', description: 'd', severity: 'low' }],
      isReady: false,
    };
    expect(ambiguityResultSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing isReady', () => {
    expect(ambiguityResultSchema.safeParse({ ambiguities: [] }).success).toBe(false);
  });

  it('rejects missing ambiguities', () => {
    expect(ambiguityResultSchema.safeParse({ isReady: true }).success).toBe(false);
  });

  it('rejects non-boolean isReady', () => {
    expect(ambiguityResultSchema.safeParse({ ambiguities: [], isReady: 'yes' }).success).toBe(
      false,
    );
  });
});
