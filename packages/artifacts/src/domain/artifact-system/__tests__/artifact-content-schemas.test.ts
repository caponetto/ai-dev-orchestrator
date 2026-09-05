import type { ArtifactType } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import {
  agreementContentSchema,
  canonicalSpecificationContentSchema,
  clarificationAnswersContentSchema,
  escalationContextContentSchema,
  implementationContentSchema,
  intakeAnalysisContentSchema,
  intakeRequirementsContentSchema,
  judgeDecisionContentSchema,
  planContentSchema,
  releaseSummaryContentSchema,
  reviewContentSchema,
  reviewFindingsContentSchema,
  reviewReportContentSchema,
  runManifestContentSchema,
  testPlanContentSchema,
  validatePlanStructure,
  verificationContentSchema,
} from '../artifact-content-schemas';
import { ARTIFACT_SCHEMA_MAP } from '../artifact-descriptors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validPlan(overrides?: Record<string, unknown>) {
  return {
    version: 1,
    specificationRef: {},
    createdAt: '2025-01-15T10:00:00Z',
    summary: 'Implement auth module',
    tasks: [
      { taskId: 'task-1', description: 'Add login', files: ['src/auth.ts'], dependencies: [] },
    ],
    ...overrides,
  };
}

function validReview(overrides?: Record<string, unknown>) {
  return {
    version: 1,
    approved: true,
    summary: 'Looks good',
    findings: [],
    createdAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

function validVerification(overrides?: Record<string, unknown>) {
  return {
    version: 1,
    passed: true,
    summary: 'All tests pass',
    failures: [],
    createdAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ARTIFACT_SCHEMA_MAP
// ---------------------------------------------------------------------------

describe('ARTIFACT_SCHEMA_MAP', () => {
  it('has a schema for every expected artifact type', () => {
    const expectedTypes = [
      'canonical_specification',
      'plan',
      'plan_review',
      'static_review',
      'security_review',
      'performance_review',
      'review_report',
      'test_plan',
      'implementation',
      'verification',
      'release_summary',
      'planning_agreement',
      'implementation_agreement',
      'verification_agreement',
      'release_agreement',
      'judge_decision',
      'escalation_context',
      'run_manifest',
      'clarification_questions',
      'clarification_answers',
      'intake_requirements',
    ];

    for (const type of expectedTypes) {
      expect(ARTIFACT_SCHEMA_MAP[type as ArtifactType], `missing schema for ${type}`).toBeDefined();
    }
  });

  it('all review types share the same schema', () => {
    const reviewTypes = [
      'plan_review',
      'static_review',
      'security_review',
      'performance_review',
      'adversarial_review',
      'design_review',
      'docs_review',
      'ux_review',
    ];
    const schemas = reviewTypes.map((t) => ARTIFACT_SCHEMA_MAP[t as ArtifactType]);
    expect(new Set(schemas).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// canonicalSpecificationContentSchema
// ---------------------------------------------------------------------------

describe('canonicalSpecificationContentSchema', () => {
  it('accepts valid content', () => {
    const result = canonicalSpecificationContentSchema.safeParse({
      id: 'spec-001',
      version: 1,
      title: 'Auth Module',
      businessGoal: 'Enable user authentication',
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = canonicalSpecificationContentSchema.safeParse({
      id: 'spec-001',
      version: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects version < 1', () => {
    const result = canonicalSpecificationContentSchema.safeParse({
      id: 'spec-001',
      version: 0,
      title: 'T',
      businessGoal: 'G',
      createdAt: '',
      updatedAt: '',
    });
    expect(result.success).toBe(false);
  });

  it('allows extra properties (loose)', () => {
    const result = canonicalSpecificationContentSchema.safeParse({
      id: 'spec-001',
      version: 1,
      title: 'Auth Module',
      businessGoal: 'Enable user authentication',
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T10:00:00Z',
      customField: 'hello',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// planContentSchema — structural + semantic validation
// ---------------------------------------------------------------------------

describe('planContentSchema', () => {
  it('accepts a valid multi-task plan with dependencies', () => {
    const plan = validPlan({
      tasks: [
        { taskId: 'task-1', description: 'Add login', files: ['src/auth.ts'], dependencies: [] },
        {
          taskId: 'task-2',
          description: 'Add middleware',
          files: ['src/middleware.ts'],
          dependencies: ['task-1'],
        },
        {
          taskId: 'task-3',
          description: 'Add tests',
          files: ['src/auth.test.ts'],
          dependencies: ['task-1', 'task-2'],
        },
      ],
    });
    expect(planContentSchema.safeParse(plan).success).toBe(true);
  });

  it('accepts a single-task plan with no dependencies', () => {
    expect(planContentSchema.safeParse(validPlan()).success).toBe(true);
  });

  it('rejects an empty tasks array', () => {
    const result = planContentSchema.safeParse(validPlan({ tasks: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects missing summary', () => {
    const { summary: _, ...noSummary } = validPlan();
    expect(planContentSchema.safeParse(noSummary).success).toBe(false);
  });

  it('rejects duplicate taskIds', () => {
    const result = planContentSchema.safeParse(
      validPlan({
        tasks: [
          { taskId: 'task-1', description: 'First', files: [], dependencies: [] },
          { taskId: 'task-1', description: 'Second', files: [], dependencies: [] },
        ],
      }),
    );
    expect(result.success).toBe(false);
    const error = result.success ? undefined : result.error;
    expect(error?.issues.some((i) => i.message.includes('duplicate taskId'))).toBe(true);
  });

  it('rejects dangling dependency references', () => {
    const result = planContentSchema.safeParse(
      validPlan({
        tasks: [{ taskId: 'task-1', description: 'First', files: [], dependencies: ['task-999'] }],
      }),
    );
    expect(result.success).toBe(false);
    const error = result.success ? undefined : result.error;
    expect(error?.issues.some((i) => i.message.includes('unknown dependency'))).toBe(true);
  });

  it('rejects cyclic dependencies', () => {
    const result = planContentSchema.safeParse(
      validPlan({
        tasks: [
          { taskId: 'a', description: 'A', files: [], dependencies: ['b'] },
          { taskId: 'b', description: 'B', files: [], dependencies: ['c'] },
          { taskId: 'c', description: 'C', files: [], dependencies: ['a'] },
        ],
      }),
    );
    expect(result.success).toBe(false);
    const error = result.success ? undefined : result.error;
    expect(error?.issues.some((i) => i.message.includes('dependency cycle detected'))).toBe(true);
  });

  it('rejects self-referencing dependencies', () => {
    const result = planContentSchema.safeParse(
      validPlan({
        tasks: [{ taskId: 'task-1', description: 'Self', files: [], dependencies: ['task-1'] }],
      }),
    );
    expect(result.success).toBe(false);
    const error = result.success ? undefined : result.error;
    expect(error?.issues.some((i) => i.message.includes('dependency cycle detected'))).toBe(true);
  });

  it('reports multiple errors at once', () => {
    const result = planContentSchema.safeParse(
      validPlan({
        tasks: [
          { taskId: 'task-1', description: 'First', files: [], dependencies: ['missing'] },
          { taskId: 'task-1', description: 'Duplicate', files: [], dependencies: [] },
        ],
      }),
    );
    expect(result.success).toBe(false);
    const error = result.success ? undefined : result.error;
    expect(error?.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('handles a diamond dependency graph without false cycles', () => {
    const result = planContentSchema.safeParse(
      validPlan({
        tasks: [
          { taskId: 'a', description: 'Root', files: [], dependencies: [] },
          { taskId: 'b', description: 'Left', files: [], dependencies: ['a'] },
          { taskId: 'c', description: 'Right', files: [], dependencies: ['a'] },
          { taskId: 'd', description: 'Merge', files: [], dependencies: ['b', 'c'] },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('allows extra properties (loose)', () => {
    const result = planContentSchema.safeParse(validPlan({ extraProp: 42 }));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reviewContentSchema
// ---------------------------------------------------------------------------

describe('reviewContentSchema', () => {
  it('accepts valid review with no findings', () => {
    expect(reviewContentSchema.safeParse(validReview()).success).toBe(true);
  });

  it('accepts valid review with findings', () => {
    const result = reviewContentSchema.safeParse(
      validReview({
        findings: [
          {
            id: 'f-1',
            category: 'security',
            severity: 'critical',
            description: 'SQL injection risk',
            file: 'src/db.ts',
            line: 42,
            suggestion: 'Use parameterized queries',
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts all valid finding categories', () => {
    const categories = [
      'correctness',
      'maintainability',
      'security',
      'performance',
      'api_consistency',
      'readability',
    ];
    for (const category of categories) {
      const result = reviewContentSchema.safeParse(
        validReview({
          findings: [{ id: 'f-1', category, severity: 'minor', description: 'test' }],
        }),
      );
      expect(result.success, `category "${category}" should be accepted`).toBe(true);
    }
  });

  it('rejects missing approved field', () => {
    const { approved: _, ...noApproved } = validReview();
    expect(reviewContentSchema.safeParse(noApproved).success).toBe(false);
  });

  it('accepts non-standard finding category (lenient string validation)', () => {
    const result = reviewContentSchema.safeParse(
      validReview({
        findings: [{ id: 'f-1', category: 'design', severity: 'major', description: 'Issue' }],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts non-standard finding severity (lenient string validation)', () => {
    const result = reviewContentSchema.safeParse(
      validReview({
        findings: [{ id: 'f-1', category: 'security', severity: 'warning', description: 'Issue' }],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts attribution on findings', () => {
    const result = reviewContentSchema.safeParse(
      validReview({
        findings: [
          {
            id: 'f-1',
            category: 'security',
            severity: 'major',
            description: 'Issue',
            attribution: 'introduced',
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reviewReportContentSchema
// ---------------------------------------------------------------------------

describe('reviewReportContentSchema', () => {
  it('accepts valid review report', () => {
    const result = reviewReportContentSchema.safeParse({
      version: 1,
      approved: true,
      summary: 'All clear',
      findings: [],
      verdict: 'approve',
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid verdict', () => {
    const result = reviewReportContentSchema.safeParse({
      version: 1,
      approved: false,
      summary: 'Issues found',
      findings: [],
      verdict: 'deny',
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('accepts attribution on synthesized findings', () => {
    const result = reviewReportContentSchema.safeParse({
      version: 1,
      approved: false,
      summary: 'Issues found',
      findings: [
        {
          id: 'SYN-001',
          category: 'security',
          severity: 'major',
          description: 'SQL injection',
          attribution: 'introduced',
        },
      ],
      verdict: 'request_changes',
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verificationContentSchema
// ---------------------------------------------------------------------------

describe('verificationContentSchema', () => {
  it('accepts valid passing verification', () => {
    expect(verificationContentSchema.safeParse(validVerification()).success).toBe(true);
  });

  it('accepts verification with failures', () => {
    const result = verificationContentSchema.safeParse(
      validVerification({
        passed: false,
        failures: [
          { type: 'test', fixable: true, description: 'Unit test failed', file: 'src/foo.test.ts' },
          { type: 'lint', fixable: false, description: 'Lint error' },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects invalid failure type', () => {
    const result = verificationContentSchema.safeParse(
      validVerification({
        failures: [{ type: 'unknown_type', fixable: true, description: 'Something' }],
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// agreementContentSchema
// ---------------------------------------------------------------------------

describe('agreementContentSchema', () => {
  it('accepts valid agreement', () => {
    const result = agreementContentSchema.safeParse({
      version: 1,
      agreementType: 'planning_agreement',
      runId: 'run-001',
      stageId: 'stage-1',
      createdAt: '2025-01-15T10:00:00Z',
      approvalStatus: 'approved',
      approvalType: 'human',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid agreement type', () => {
    const result = agreementContentSchema.safeParse({
      version: 1,
      agreementType: 'invalid_agreement',
      runId: 'run-001',
      stageId: 'stage-1',
      createdAt: '2025-01-15T10:00:00Z',
      approvalStatus: 'approved',
      approvalType: 'human',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid approval status', () => {
    const result = agreementContentSchema.safeParse({
      version: 1,
      agreementType: 'release_agreement',
      runId: 'run-001',
      stageId: 'stage-1',
      createdAt: '2025-01-15T10:00:00Z',
      approvalStatus: 'pending',
      approvalType: 'automated',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// judgeDecisionContentSchema
// ---------------------------------------------------------------------------

describe('judgeDecisionContentSchema', () => {
  it('accepts valid judge decision', () => {
    const result = judgeDecisionContentSchema.safeParse({
      version: 1,
      approved: true,
      rationale: 'Plan quality is sufficient',
      directives: ['proceed'],
      reviewArtifactsConsidered: ['review-1'],
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts judge decision with planLevelIssue', () => {
    const result = judgeDecisionContentSchema.safeParse({
      version: 1,
      approved: false,
      rationale: 'Plan has structural flaws',
      directives: ['revise plan'],
      reviewArtifactsConsidered: [],
      planLevelIssue: true,
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing rationale', () => {
    const result = judgeDecisionContentSchema.safeParse({
      version: 1,
      approved: true,
      directives: [],
      reviewArtifactsConsidered: [],
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// escalationContextContentSchema
// ---------------------------------------------------------------------------

describe('escalationContextContentSchema', () => {
  it('accepts valid escalation context', () => {
    const result = escalationContextContentSchema.safeParse({
      version: 1,
      runId: 'run-001',
      escalationTrigger: 'iteration_limit_exceeded',
      stateAtEscalation: 'review_gate',
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid escalation trigger', () => {
    const result = escalationContextContentSchema.safeParse({
      version: 1,
      runId: 'run-001',
      escalationTrigger: 'magic_failure',
      stateAtEscalation: 'review_gate',
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runManifestContentSchema
// ---------------------------------------------------------------------------

describe('runManifestContentSchema', () => {
  it('accepts valid run manifest', () => {
    const result = runManifestContentSchema.safeParse({
      runId: '20250115-100000-abc123',
      version: '1.0.0',
      repository: { path: '/repo' },
      workflow: { name: 'default' },
      timing: { startedAt: '2025-01-15T10:00:00Z' },
      status: 'completed',
      finalState: 'released',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid runId format', () => {
    const result = runManifestContentSchema.safeParse({
      runId: 'bad-format',
      version: '1.0.0',
      repository: {},
      workflow: {},
      timing: {},
      status: 'completed',
      finalState: 'released',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = runManifestContentSchema.safeParse({
      runId: '20250115-100000-abc123',
      version: '1.0.0',
      repository: {},
      workflow: {},
      timing: {},
      status: 'running',
      finalState: 'released',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// testPlanContentSchema
// ---------------------------------------------------------------------------

describe('testPlanContentSchema', () => {
  it('accepts valid test plan', () => {
    const result = testPlanContentSchema.safeParse({
      version: 1,
      specificationRef: {},
      planRef: {},
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing planRef', () => {
    const result = testPlanContentSchema.safeParse({
      version: 1,
      specificationRef: {},
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// implementationContentSchema
// ---------------------------------------------------------------------------

describe('implementationContentSchema', () => {
  it('accepts valid implementation', () => {
    const result = implementationContentSchema.safeParse({
      version: 1,
      planRef: {},
      testPlanRef: {},
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts string summary', () => {
    const result = implementationContentSchema.safeParse({
      version: 1,
      planRef: {},
      testPlanRef: {},
      summary: 'All tasks completed successfully',
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts structured summary object', () => {
    const result = implementationContentSchema.safeParse({
      version: 1,
      planRef: {},
      testPlanRef: {},
      summary: {
        filesCreated: 3,
        filesModified: 1,
        filesDeleted: 0,
        totalTestsWritten: 5,
        totalTestsPassed: 5,
        totalTestsFailed: 0,
        deviationsFromPlan: 0,
      },
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts structured summary with extra fields', () => {
    const result = implementationContentSchema.safeParse({
      version: 1,
      planRef: {},
      testPlanRef: {},
      summary: {
        filesCreated: 1,
        customField: 'allowed by loose schema',
      },
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing testPlanRef', () => {
    const result = implementationContentSchema.safeParse({
      version: 1,
      planRef: {},
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// intakeAnalysisContentSchema
// ---------------------------------------------------------------------------

describe('intakeAnalysisContentSchema', () => {
  it('accepts valid intake analysis', () => {
    const result = intakeAnalysisContentSchema.safeParse({
      completenessScore: 0.85,
      readinessVerdict: 'Ready',
    });
    expect(result.success).toBe(true);
  });

  it('rejects completenessScore out of range', () => {
    expect(
      intakeAnalysisContentSchema.safeParse({
        completenessScore: 1.5,
        readinessVerdict: 'Ready',
      }).success,
    ).toBe(false);

    expect(
      intakeAnalysisContentSchema.safeParse({
        completenessScore: -0.1,
        readinessVerdict: 'Ready',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid readiness verdict', () => {
    const result = intakeAnalysisContentSchema.safeParse({
      completenessScore: 0.5,
      readinessVerdict: 'Maybe',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clarificationAnswersContentSchema
// ---------------------------------------------------------------------------

describe('clarificationAnswersContentSchema', () => {
  it('accepts valid clarification answers', () => {
    const result = clarificationAnswersContentSchema.safeParse({
      answers: [
        { questionId: 'CLR-001', question: 'Which DB?', answer: 'PostgreSQL' },
        { answer: 'Yes, use JWT' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all optional)', () => {
    const result = clarificationAnswersContentSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts extra properties (loose)', () => {
    const result = clarificationAnswersContentSchema.safeParse({
      answers: [{ answer: 'yes' }],
      humanNote: 'Provided by product owner',
    });
    expect(result.success).toBe(true);
  });

  it('uses different schema than clarification_questions in ARTIFACT_SCHEMA_MAP', () => {
    const questionsSchema = ARTIFACT_SCHEMA_MAP['clarification_questions'];
    const answersSchema = ARTIFACT_SCHEMA_MAP['clarification_answers'];
    expect(questionsSchema).not.toBe(answersSchema);
  });
});

// ---------------------------------------------------------------------------
// releaseSummaryContentSchema
// ---------------------------------------------------------------------------

describe('releaseSummaryContentSchema', () => {
  it('accepts valid release summary', () => {
    const result = releaseSummaryContentSchema.safeParse({
      version: 1,
      commitMessage: 'feat(auth): add OAuth2 login',
      prDescription: '## Summary\nAdds OAuth2 login flow.',
      humanSummary: '# OAuth2 Login\nWe added OAuth2 login support.',
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing version', () => {
    const result = releaseSummaryContentSchema.safeParse({
      commitMessage: 'feat: something',
      prDescription: 'desc',
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing commitMessage', () => {
    const result = releaseSummaryContentSchema.safeParse({
      version: 1,
      prDescription: 'desc',
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing prDescription', () => {
    const result = releaseSummaryContentSchema.safeParse({
      version: 1,
      commitMessage: 'feat: something',
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// intakeRequirementsContentSchema
// ---------------------------------------------------------------------------

describe('intakeRequirementsContentSchema', () => {
  it('accepts valid intake requirements', () => {
    const result = intakeRequirementsContentSchema.safeParse({
      title: 'Auth Feature',
      description: 'Implement OAuth2 login',
      sourceMetadata: {
        fetchedAt: '2025-01-15T10:00:00Z',
        checksum: 'sha256:abc123',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal intake requirements (all optional)', () => {
    const result = intakeRequirementsContentSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts intake requirements with rawFields', () => {
    const result = intakeRequirementsContentSchema.safeParse({
      rawFields: { priority: 'high', team: 'backend' },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reviewFindingsContentSchema
// ---------------------------------------------------------------------------

describe('reviewFindingsContentSchema', () => {
  it('accepts valid findings with all fields', () => {
    const result = reviewFindingsContentSchema.safeParse({
      version: 1,
      findings: [
        {
          description: 'SQL injection risk',
          file: 'src/db.ts',
          suggestion: 'Use parameterized queries',
          severity: 'critical',
          evidence: 'db.query(`SELECT * FROM ${q}`)',
        },
      ],
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts findings without suggestion (optional)', () => {
    const result = reviewFindingsContentSchema.safeParse({
      version: 1,
      findings: [
        {
          description: 'Missing null check',
          file: 'src/handler.ts',
          severity: 'major',
        },
      ],
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts findings with extra properties (loose items)', () => {
    const result = reviewFindingsContentSchema.safeParse({
      version: 1,
      findings: [
        {
          description: 'Race condition',
          file: 'src/api.ts',
          suggestion: 'Add mutex',
          severity: 'critical',
          id: 'f-1',
          category: 'correctness',
          sources: ['static_reviewer'],
        },
      ],
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts acceptance criteria with addressed and notAddressed', () => {
    const result = reviewFindingsContentSchema.safeParse({
      version: 1,
      findings: [],
      acceptanceCriteria: {
        addressed: [{ criterion: 'Login works', evidence: 'Verified in tests' }],
        notAddressed: [{ criterion: 'Logout missing', note: 'Not implemented' }],
      },
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts acceptance criteria with partiallyAddressed', () => {
    const result = reviewFindingsContentSchema.safeParse({
      version: 1,
      findings: [],
      acceptanceCriteria: {
        addressed: [{ criterion: 'Fully met' }],
        partiallyAddressed: [{ criterion: 'Partially met', note: 'Missing edge case' }],
        notAddressed: [{ criterion: 'Not implemented' }],
      },
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects acceptance criteria with plain strings', () => {
    const result = reviewFindingsContentSchema.safeParse({
      version: 1,
      findings: [],
      acceptanceCriteria: {
        addressed: ['plain string should fail'],
      },
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing createdAt', () => {
    const result = reviewFindingsContentSchema.safeParse({
      version: 1,
      findings: [{ description: 'Issue', file: 'src/a.ts' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required description', () => {
    const result = reviewFindingsContentSchema.safeParse({
      version: 1,
      findings: [{ file: 'src/db.ts' }],
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('accepts findings without file (project-wide concerns)', () => {
    const result = reviewFindingsContentSchema.safeParse({
      version: 1,
      findings: [{ description: 'Deployment skew risk' }],
      createdAt: '2025-01-15T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePlanStructure
// ---------------------------------------------------------------------------

describe('validatePlanStructure', () => {
  it('returns error for empty tasks', () => {
    expect(validatePlanStructure({})).toEqual(['tasks must be non-empty']);
    expect(validatePlanStructure({ tasks: [] })).toEqual(['tasks must be non-empty']);
  });

  it('returns no errors for a valid DAG', () => {
    const errors = validatePlanStructure({
      tasks: [
        { taskId: 'a', dependencies: [] },
        { taskId: 'b', dependencies: ['a'] },
      ],
    });
    expect(errors).toEqual([]);
  });

  it('detects duplicate task IDs', () => {
    const errors = validatePlanStructure({
      tasks: [
        { taskId: 'a', dependencies: [] },
        { taskId: 'a', dependencies: [] },
      ],
    });
    expect(errors).toContainEqual(expect.stringContaining('duplicate taskId: a'));
  });

  it('detects dangling dependencies', () => {
    const errors = validatePlanStructure({
      tasks: [{ taskId: 'a', dependencies: ['missing'] }],
    });
    expect(errors).toContainEqual(expect.stringContaining('unknown dependency "missing"'));
  });

  it('detects cycles', () => {
    const errors = validatePlanStructure({
      tasks: [
        { taskId: 'a', dependencies: ['b'] },
        { taskId: 'b', dependencies: ['a'] },
      ],
    });
    expect(errors).toContainEqual(expect.stringContaining('dependency cycle detected'));
  });
});
