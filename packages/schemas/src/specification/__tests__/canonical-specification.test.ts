import { describe, expect, it } from 'vitest';

import {
  acceptanceCriterionSchema,
  assumptionSchema,
  canonicalSpecificationSchema,
  COMPLETENESS_WEIGHTS,
  completenessResultSchema,
  constraintSchema,
  dependencySchema,
  functionalRequirementSchema,
  mergeConflictSchema,
  mergeResultSchema,
  mergeStrategySchema,
  nfrCategorySchema,
  nonFunctionalRequirementSchema,
  requirementPrioritySchema,
  riskSchema,
  sourceProvenanceSchema,
  specificationAnalysisSchema,
  specificationIdSchema,
  specificationValidationErrorSchema,
  specificationValidationResultSchema,
  specificationValidationWarningSchema,
  stakeholderSchema,
  verificationMethodSchema,
} from '../canonical-specification';

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

// ---- specificationIdSchema ----

describe('specificationIdSchema', () => {
  it('accepts a string', () => {
    expect(specificationIdSchema.safeParse('spec-001').success).toBe(true);
  });

  it('rejects non-string values', () => {
    expect(specificationIdSchema.safeParse(123).success).toBe(false);
    expect(specificationIdSchema.safeParse(null).success).toBe(false);
    expect(specificationIdSchema.safeParse(undefined).success).toBe(false);
  });
});

// ---- stakeholderSchema ----

describe('stakeholderSchema', () => {
  it('accepts a valid stakeholder', () => {
    const data = { name: 'Alice', role: 'PM', interest: 'Delivery speed' };
    expect(stakeholderSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing name', () => {
    expect(stakeholderSchema.safeParse({ role: 'PM', interest: 'x' }).success).toBe(false);
  });

  it('rejects missing role', () => {
    expect(stakeholderSchema.safeParse({ name: 'Alice', interest: 'x' }).success).toBe(false);
  });

  it('rejects missing interest', () => {
    expect(stakeholderSchema.safeParse({ name: 'Alice', role: 'PM' }).success).toBe(false);
  });

  it('rejects empty object', () => {
    expect(stakeholderSchema.safeParse({}).success).toBe(false);
  });
});

// ---- assumptionSchema ----

describe('assumptionSchema', () => {
  it('accepts a valid assumption', () => {
    const data = { id: 'a-1', description: 'Users have accounts', impact: 'high', validated: true };
    expect(assumptionSchema.safeParse(data).success).toBe(true);
  });

  it.each(['high', 'medium', 'low'])('accepts impact = "%s"', (impact) => {
    const data = { id: 'a-1', description: 'desc', impact, validated: false };
    expect(assumptionSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid impact value', () => {
    const data = { id: 'a-1', description: 'desc', impact: 'critical', validated: false };
    expect(assumptionSchema.safeParse(data).success).toBe(false);
  });

  it('rejects missing validated field', () => {
    expect(
      assumptionSchema.safeParse({ id: 'a-1', description: 'desc', impact: 'low' }).success,
    ).toBe(false);
  });
});

// ---- constraintSchema ----

describe('constraintSchema', () => {
  it('accepts a valid constraint', () => {
    const data = { id: 'c-1', description: 'Must use Postgres', type: 'technical', source: 'CTO' };
    expect(constraintSchema.safeParse(data).success).toBe(true);
  });

  it.each(['technical', 'business', 'regulatory', 'timeline', 'resource'])(
    'accepts type = "%s"',
    (type) => {
      const data = { id: 'c-1', description: 'desc', type, source: 'src' };
      expect(constraintSchema.safeParse(data).success).toBe(true);
    },
  );

  it('rejects unknown type', () => {
    const data = { id: 'c-1', description: 'desc', type: 'legal', source: 'src' };
    expect(constraintSchema.safeParse(data).success).toBe(false);
  });

  it('rejects missing source', () => {
    expect(
      constraintSchema.safeParse({ id: 'c-1', description: 'desc', type: 'technical' }).success,
    ).toBe(false);
  });
});

// ---- requirementPrioritySchema ----

describe('requirementPrioritySchema', () => {
  it.each(['must', 'should', 'could', 'wont'])('accepts "%s"', (value) => {
    expect(requirementPrioritySchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown priority', () => {
    expect(requirementPrioritySchema.safeParse('critical').success).toBe(false);
  });
});

// ---- functionalRequirementSchema ----

describe('functionalRequirementSchema', () => {
  it('accepts a valid requirement', () => {
    const data = {
      id: 'fr-1',
      title: 'Login',
      description: 'User can log in',
      priority: 'must',
      acceptanceCriteria: ['AC-1'],
    };
    expect(functionalRequirementSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with optional dependencies', () => {
    const data = {
      id: 'fr-1',
      title: 'Login',
      description: 'User can log in',
      priority: 'should',
      acceptanceCriteria: ['AC-1'],
      dependencies: ['fr-0'],
    };
    expect(functionalRequirementSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing acceptanceCriteria', () => {
    const data = { id: 'fr-1', title: 'Login', description: 'desc', priority: 'must' };
    expect(functionalRequirementSchema.safeParse(data).success).toBe(false);
  });

  it('rejects invalid priority', () => {
    const data = {
      id: 'fr-1',
      title: 'Login',
      description: 'desc',
      priority: 'urgent',
      acceptanceCriteria: [],
    };
    expect(functionalRequirementSchema.safeParse(data).success).toBe(false);
  });
});

// ---- nfrCategorySchema ----

describe('nfrCategorySchema', () => {
  it.each([
    'performance',
    'security',
    'reliability',
    'scalability',
    'usability',
    'maintainability',
    'compatibility',
    'other',
  ])('accepts "%s"', (value) => {
    expect(nfrCategorySchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown category', () => {
    expect(nfrCategorySchema.safeParse('availability').success).toBe(false);
  });
});

// ---- nonFunctionalRequirementSchema ----

describe('nonFunctionalRequirementSchema', () => {
  it('accepts a minimal valid NFR', () => {
    const data = {
      id: 'nfr-1',
      title: 'Response time',
      description: 'Under 200ms',
      category: 'performance',
    };
    expect(nonFunctionalRequirementSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with optional metric and threshold', () => {
    const data = {
      id: 'nfr-1',
      title: 'Response time',
      description: 'Under 200ms',
      category: 'performance',
      metric: 'p99 latency',
      threshold: '200ms',
    };
    expect(nonFunctionalRequirementSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing category', () => {
    expect(
      nonFunctionalRequirementSchema.safeParse({
        id: 'nfr-1',
        title: 'T',
        description: 'd',
      }).success,
    ).toBe(false);
  });
});

// ---- verificationMethodSchema ----

describe('verificationMethodSchema', () => {
  it.each(['test', 'review', 'demo', 'analysis'])('accepts "%s"', (value) => {
    expect(verificationMethodSchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown method', () => {
    expect(verificationMethodSchema.safeParse('inspection').success).toBe(false);
  });
});

// ---- acceptanceCriterionSchema ----

describe('acceptanceCriterionSchema', () => {
  it('accepts a valid criterion', () => {
    const data = {
      id: 'ac-1',
      description: 'User sees dashboard',
      verificationMethod: 'test',
      requirementIds: ['fr-1'],
    };
    expect(acceptanceCriterionSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing requirementIds', () => {
    expect(
      acceptanceCriterionSchema.safeParse({
        id: 'ac-1',
        description: 'd',
        verificationMethod: 'test',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid verificationMethod', () => {
    const data = {
      id: 'ac-1',
      description: 'd',
      verificationMethod: 'manual',
      requirementIds: [],
    };
    expect(acceptanceCriterionSchema.safeParse(data).success).toBe(false);
  });
});

// ---- riskSchema ----

describe('riskSchema', () => {
  it('accepts a valid risk', () => {
    const data = { id: 'r-1', description: 'API changes', likelihood: 'medium', impact: 'high' };
    expect(riskSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with optional mitigation', () => {
    const data = {
      id: 'r-1',
      description: 'API changes',
      likelihood: 'low',
      impact: 'low',
      mitigation: 'Pin versions',
    };
    expect(riskSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid likelihood', () => {
    const data = {
      id: 'r-1',
      description: 'API changes',
      likelihood: 'extreme',
      impact: 'high',
    };
    expect(riskSchema.safeParse(data).success).toBe(false);
  });
});

// ---- dependencySchema ----

describe('dependencySchema', () => {
  it('accepts a valid dependency', () => {
    const data = {
      id: 'd-1',
      description: 'Auth service',
      type: 'internal',
      status: 'available',
    };
    expect(dependencySchema.safeParse(data).success).toBe(true);
  });

  it.each(['internal', 'external'])('accepts type = "%s"', (type) => {
    const data = { id: 'd-1', description: 'dep', type, status: 'pending' };
    expect(dependencySchema.safeParse(data).success).toBe(true);
  });

  it.each(['available', 'pending', 'blocked'])('accepts status = "%s"', (status) => {
    const data = { id: 'd-1', description: 'dep', type: 'internal', status };
    expect(dependencySchema.safeParse(data).success).toBe(true);
  });

  it('accepts with optional owner', () => {
    const data = {
      id: 'd-1',
      description: 'dep',
      type: 'external',
      status: 'blocked',
      owner: 'Team A',
    };
    expect(dependencySchema.safeParse(data).success).toBe(true);
  });

  it('rejects unknown type', () => {
    const data = { id: 'd-1', description: 'dep', type: 'shared', status: 'available' };
    expect(dependencySchema.safeParse(data).success).toBe(false);
  });

  it('rejects unknown status', () => {
    const data = { id: 'd-1', description: 'dep', type: 'internal', status: 'resolved' };
    expect(dependencySchema.safeParse(data).success).toBe(false);
  });
});

// ---- sourceProvenanceSchema ----

describe('sourceProvenanceSchema', () => {
  it('accepts a valid source provenance', () => {
    const data = {
      fetchedAt: '2026-01-01T00:00:00Z',
      checksum: 'sha256-abc',
      fieldsMapped: ['title', 'description'],
    };
    expect(sourceProvenanceSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing fieldsMapped', () => {
    expect(
      sourceProvenanceSchema.safeParse({
        fetchedAt: '2026-01-01T00:00:00Z',
        checksum: 'sha256-abc',
      }).success,
    ).toBe(false);
  });
});

// ---- specificationAnalysisSchema ----

describe('specificationAnalysisSchema', () => {
  it('accepts a valid analysis', () => {
    const data = {
      completenessScore: 0.85,
      ambiguityCount: 2,
      riskCount: 1,
      unvalidatedAssumptionCount: 0,
      readinessVerdict: 'Ready',
    };
    expect(specificationAnalysisSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with optional analystNotes', () => {
    const data = {
      completenessScore: 0.5,
      ambiguityCount: 5,
      riskCount: 3,
      unvalidatedAssumptionCount: 2,
      readinessVerdict: 'NotReady',
      analystNotes: 'Needs more detail',
    };
    expect(specificationAnalysisSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid readinessVerdict', () => {
    const data = {
      completenessScore: 0.5,
      ambiguityCount: 0,
      riskCount: 0,
      unvalidatedAssumptionCount: 0,
      readinessVerdict: 'Maybe',
    };
    expect(specificationAnalysisSchema.safeParse(data).success).toBe(false);
  });

  it('rejects missing completenessScore', () => {
    expect(
      specificationAnalysisSchema.safeParse({
        ambiguityCount: 0,
        riskCount: 0,
        unvalidatedAssumptionCount: 0,
        readinessVerdict: 'Ready',
      }).success,
    ).toBe(false);
  });
});

// ---- canonicalSpecificationSchema ----

describe('canonicalSpecificationSchema', () => {
  it('accepts minimal valid data', () => {
    expect(canonicalSpecificationSchema.safeParse(minimalCanonicalSpec).success).toBe(true);
  });

  it('accepts with all optional fields', () => {
    const data = {
      ...minimalCanonicalSpec,
      previousVersion: 'v0',
      extensions: { custom: true },
      analysis: {
        completenessScore: 0.9,
        ambiguityCount: 0,
        riskCount: 0,
        unvalidatedAssumptionCount: 0,
        readinessVerdict: 'Ready',
      },
    };
    expect(canonicalSpecificationSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with populated arrays', () => {
    const data = {
      ...minimalCanonicalSpec,
      stakeholders: [{ name: 'Alice', role: 'PM', interest: 'Speed' }],
      assumptions: [{ id: 'a-1', description: 'd', impact: 'high', validated: true }],
      constraints: [{ id: 'c-1', description: 'd', type: 'technical', source: 's' }],
      functionalRequirements: [
        { id: 'fr-1', title: 't', description: 'd', priority: 'must', acceptanceCriteria: [] },
      ],
      nonFunctionalRequirements: [
        { id: 'nfr-1', title: 't', description: 'd', category: 'security' },
      ],
      acceptanceCriteria: [
        { id: 'ac-1', description: 'd', verificationMethod: 'test', requirementIds: ['fr-1'] },
      ],
      risks: [{ id: 'r-1', description: 'd', likelihood: 'low', impact: 'low' }],
      dependencies: [{ id: 'd-1', description: 'd', type: 'internal', status: 'available' }],
      definitionOfDone: ['All tests pass'],
      sources: [
        { fetchedAt: '2026-01-01T00:00:00Z', checksum: 'sha256-abc', fieldsMapped: ['title'] },
      ],
    };
    expect(canonicalSpecificationSchema.safeParse(data).success).toBe(true);
  });

  it.each([
    'id',
    'version',
    'title',
    'businessGoal',
    'stakeholders',
    'assumptions',
    'constraints',
    'functionalRequirements',
    'nonFunctionalRequirements',
    'acceptanceCriteria',
    'risks',
    'dependencies',
    'definitionOfDone',
    'sources',
    'createdAt',
    'updatedAt',
  ])('rejects when required field "%s" is missing', (field) => {
    const { [field]: _, ...data } = minimalCanonicalSpec as Record<string, unknown>;
    expect(canonicalSpecificationSchema.safeParse(data).success).toBe(false);
  });

  it('rejects empty object', () => {
    expect(canonicalSpecificationSchema.safeParse({}).success).toBe(false);
  });

  it('rejects non-number version', () => {
    expect(
      canonicalSpecificationSchema.safeParse({ ...minimalCanonicalSpec, version: '1' }).success,
    ).toBe(false);
  });
});

// ---- specificationValidationErrorSchema ----

describe('specificationValidationErrorSchema', () => {
  it('accepts a valid error', () => {
    const data = { field: 'title', message: 'Cannot be empty', rule: 'required' };
    expect(specificationValidationErrorSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing field', () => {
    expect(specificationValidationErrorSchema.safeParse({ message: 'm', rule: 'r' }).success).toBe(
      false,
    );
  });
});

// ---- specificationValidationWarningSchema ----

describe('specificationValidationWarningSchema', () => {
  it('accepts a valid warning', () => {
    const data = { field: 'risks', message: 'No risks listed', suggestion: 'Add at least one' };
    expect(specificationValidationWarningSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing suggestion', () => {
    expect(
      specificationValidationWarningSchema.safeParse({ field: 'f', message: 'm' }).success,
    ).toBe(false);
  });
});

// ---- specificationValidationResultSchema ----

describe('specificationValidationResultSchema', () => {
  it('accepts a valid result', () => {
    const data = { valid: true, errors: [], warnings: [] };
    expect(specificationValidationResultSchema.safeParse(data).success).toBe(true);
  });

  it('accepts a result with errors and warnings', () => {
    const data = {
      valid: false,
      errors: [{ field: 'title', message: 'Missing', rule: 'required' }],
      warnings: [{ field: 'risks', message: 'Empty', suggestion: 'Add risks' }],
    };
    expect(specificationValidationResultSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing valid field', () => {
    expect(
      specificationValidationResultSchema.safeParse({ errors: [], warnings: [] }).success,
    ).toBe(false);
  });

  it('rejects missing errors array', () => {
    expect(
      specificationValidationResultSchema.safeParse({ valid: true, warnings: [] }).success,
    ).toBe(false);
  });
});

// ---- completenessResultSchema ----

describe('completenessResultSchema', () => {
  it('accepts a valid completeness result', () => {
    const data = {
      score: 0.75,
      missingFields: ['risks'],
      emptyFields: ['stakeholders'],
      fieldScores: { title: 1, risks: 0 },
    };
    expect(completenessResultSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing score', () => {
    expect(
      completenessResultSchema.safeParse({
        missingFields: [],
        emptyFields: [],
        fieldScores: {},
      }).success,
    ).toBe(false);
  });

  it('rejects missing fieldScores', () => {
    expect(
      completenessResultSchema.safeParse({
        score: 0.5,
        missingFields: [],
        emptyFields: [],
      }).success,
    ).toBe(false);
  });
});

// ---- mergeStrategySchema ----

describe('mergeStrategySchema', () => {
  it('accepts a valid strategy', () => {
    const data = { scalarConflict: 'last-wins', arrayMerge: 'union', deduplication: true };
    expect(mergeStrategySchema.safeParse(data).success).toBe(true);
  });

  it.each(['last-wins', 'first-wins', 'flag-conflict'])(
    'accepts scalarConflict = "%s"',
    (value) => {
      const data = { scalarConflict: value, arrayMerge: 'union', deduplication: false };
      expect(mergeStrategySchema.safeParse(data).success).toBe(true);
    },
  );

  it.each(['union', 'concatenate'])('accepts arrayMerge = "%s"', (value) => {
    const data = { scalarConflict: 'last-wins', arrayMerge: value, deduplication: false };
    expect(mergeStrategySchema.safeParse(data).success).toBe(true);
  });

  it('rejects unknown scalarConflict', () => {
    const data = { scalarConflict: 'merge', arrayMerge: 'union', deduplication: true };
    expect(mergeStrategySchema.safeParse(data).success).toBe(false);
  });

  it('rejects unknown arrayMerge', () => {
    const data = { scalarConflict: 'last-wins', arrayMerge: 'replace', deduplication: true };
    expect(mergeStrategySchema.safeParse(data).success).toBe(false);
  });
});

// ---- mergeConflictSchema ----

describe('mergeConflictSchema', () => {
  it('accepts a valid conflict', () => {
    const data = {
      field: 'title',
      values: [
        { source: 'A', value: 'Title A' },
        { source: 'B', value: 'Title B' },
      ],
      resolution: 'auto-resolved',
      resolvedValue: 'Title A',
    };
    expect(mergeConflictSchema.safeParse(data).success).toBe(true);
  });

  it('accepts without optional resolvedValue', () => {
    const data = {
      field: 'title',
      values: [{ source: 'A', value: 'v' }],
      resolution: 'flagged',
    };
    expect(mergeConflictSchema.safeParse(data).success).toBe(true);
  });

  it.each(['auto-resolved', 'flagged'])('accepts resolution = "%s"', (resolution) => {
    const data = { field: 'f', values: [], resolution };
    expect(mergeConflictSchema.safeParse(data).success).toBe(true);
  });

  it('rejects unknown resolution', () => {
    const data = { field: 'f', values: [], resolution: 'manual' };
    expect(mergeConflictSchema.safeParse(data).success).toBe(false);
  });

  it('rejects missing field', () => {
    expect(mergeConflictSchema.safeParse({ values: [], resolution: 'flagged' }).success).toBe(
      false,
    );
  });
});

// ---- mergeResultSchema ----

describe('mergeResultSchema', () => {
  it('accepts a valid merge result', () => {
    const data = {
      merged: minimalCanonicalSpec,
      conflicts: [],
    };
    expect(mergeResultSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with conflicts', () => {
    const data = {
      merged: minimalCanonicalSpec,
      conflicts: [
        {
          field: 'title',
          values: [{ source: 'A', value: 'v' }],
          resolution: 'flagged' as const,
        },
      ],
    };
    expect(mergeResultSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing merged spec', () => {
    expect(mergeResultSchema.safeParse({ conflicts: [] }).success).toBe(false);
  });

  it('rejects missing conflicts', () => {
    expect(mergeResultSchema.safeParse({ merged: minimalCanonicalSpec }).success).toBe(false);
  });
});

// ---- COMPLETENESS_WEIGHTS ----

describe('COMPLETENESS_WEIGHTS', () => {
  it('contains expected fields', () => {
    expect(COMPLETENESS_WEIGHTS).toHaveProperty('title');
    expect(COMPLETENESS_WEIGHTS).toHaveProperty('businessGoal');
    expect(COMPLETENESS_WEIGHTS).toHaveProperty('functionalRequirements');
    expect(COMPLETENESS_WEIGHTS).toHaveProperty('acceptanceCriteria');
  });

  it('weights sum to approximately 1.0', () => {
    const total = Object.values(COMPLETENESS_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it('has 11 fields', () => {
    expect(Object.keys(COMPLETENESS_WEIGHTS)).toHaveLength(11);
  });
});
