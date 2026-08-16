import type { ArtifactType } from '@ai-orchestrator/schemas';
import {
  agreementTypeSchema,
  approvalStatusSchema,
  approvalTypeSchema,
  escalationTriggerSchema,
  intakeVerdictSchema,
} from '@ai-orchestrator/schemas';
import { z } from 'zod/v4';

import { REVIEW_ARTIFACT_TYPES } from './constants';

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

const artifactRefSchema = z
  .object({
    type: z.string().optional(),
    name: z.string().optional(),
    version: z.number().optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// Content schemas — one per artifact shape
// ---------------------------------------------------------------------------

export const canonicalSpecificationContentSchema = z
  .object({
    id: z.string(),
    version: z.number().min(1),
    title: z.string().min(1).max(200),
    businessGoal: z.string().min(1).max(1000),
    createdAt: z.string(),
    updatedAt: z.string(),
    previousVersion: z.string().optional(),
    sources: z.array(z.unknown()).optional(),
    analysis: z.looseObject({}).optional(),
    feasibility: z
      .object({
        feasible: z.boolean(),
        reason: z.string().optional(),
      })
      .optional(),
  })
  .loose();

const planTaskSchema = z.object({
  taskId: z.string().min(1),
  description: z.string().min(1),
  files: z.array(z.string()),
  dependencies: z.array(z.string()),
});

function validateTaskDag(
  tasks: ReadonlyArray<{ readonly taskId: string; readonly dependencies: readonly string[] }>,
): string[] {
  const errors: string[] = [];
  const taskIds = new Set<string>();

  for (const task of tasks) {
    if (taskIds.has(task.taskId)) {
      errors.push(`duplicate taskId: ${task.taskId}`);
    }
    taskIds.add(task.taskId);
  }

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!taskIds.has(dep)) {
        errors.push(`task "${task.taskId}" references unknown dependency "${dep}"`);
      }
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const task of tasks) {
    color.set(task.taskId, WHITE);
  }

  const depMap = new Map<string, readonly string[]>();
  for (const task of tasks) {
    depMap.set(task.taskId, task.dependencies);
  }

  function visit(taskId: string, path: string[]): void {
    color.set(taskId, GRAY);
    path.push(taskId);
    for (const dep of depMap.get(taskId) ?? []) {
      if (color.get(dep) === GRAY) {
        const cycleStart = path.indexOf(dep);
        const cycle = path.slice(cycleStart).concat(dep);
        errors.push(`dependency cycle detected: ${cycle.join(' → ')}`);
        return;
      }
      if (color.get(dep) === WHITE) {
        visit(dep, path);
      }
    }
    path.pop();
    color.set(taskId, BLACK);
  }

  for (const task of tasks) {
    if (color.get(task.taskId) === WHITE) {
      visit(task.taskId, []);
    }
  }

  return errors;
}

export const planContentSchema = z
  .object({
    version: z.number().min(1),
    specificationRef: artifactRefSchema,
    previousVersion: z.string().optional(),
    createdAt: z.string(),
    summary: z.string().min(1),
    tasks: z.array(planTaskSchema).min(1),
  })
  .loose()
  .superRefine((data, ctx) => {
    for (const message of validateTaskDag(data.tasks)) {
      ctx.addIssue({ code: 'custom', path: ['tasks'], message });
    }
  });

const reviewFindingSchema = z.object({
  id: z.string(),
  category: z.string(),
  severity: z.string(),
  description: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  suggestion: z.string().optional(),
  evidence: z.string().optional(),
});

export const reviewContentSchema = z
  .object({
    version: z.number().min(1),
    approved: z.boolean(),
    summary: z.string().min(1),
    findings: z.array(reviewFindingSchema),
    reviewType: z.enum([...REVIEW_ARTIFACT_TYPES] as [ArtifactType, ...ArtifactType[]]).optional(),
    reviewedArtifactRef: artifactRefSchema.optional(),
    previousVersion: z.string().optional(),
    role: z.string().optional(),
    createdAt: z.string(),
  })
  .loose();

const reviewReportFindingSchema = z.object({
  id: z.string(),
  category: z.enum([
    'correctness',
    'maintainability',
    'security',
    'performance',
    'design',
    'style',
  ]),
  severity: z.enum(['critical', 'major', 'minor']),
  description: z.string(),
  sources: z.array(z.string()).optional(),
  file: z.string().nullish(),
  line: z.number().nullish(),
  suggestion: z.string().nullish(),
  evidence: z.string().nullish(),
});

export const reviewReportContentSchema = z
  .object({
    version: z.number().min(1),
    approved: z.boolean(),
    summary: z.string().min(1),
    findings: z.array(reviewReportFindingSchema),
    verdict: z.enum(['approve', 'request_changes']),
    reviewSummary: z
      .object({
        totalFindings: z.number().optional(),
        critical: z.number().optional(),
        major: z.number().optional(),
        minor: z.number().optional(),
      })
      .optional(),
    createdAt: z.string(),
  })
  .loose();

export const testPlanContentSchema = z
  .object({
    version: z.number().min(1),
    specificationRef: artifactRefSchema,
    planRef: artifactRefSchema,
    summary: z.string().optional(),
    previousVersion: z.string().optional(),
    createdAt: z.string(),
  })
  .loose();

const implementationSummarySchema = z.union([
  z.string(),
  z
    .object({
      filesCreated: z.number().optional(),
      filesModified: z.number().optional(),
      filesDeleted: z.number().optional(),
      totalTestsWritten: z.number().optional(),
      totalTestsPassed: z.number().optional(),
      totalTestsFailed: z.number().optional(),
      deviationsFromPlan: z.number().optional(),
    })
    .loose(),
]);

export const implementationContentSchema = z
  .object({
    version: z.number().min(1),
    planRef: artifactRefSchema,
    testPlanRef: artifactRefSchema,
    summary: implementationSummarySchema.optional(),
    steps: z.array(z.looseObject({})).optional(),
    previousVersion: z.string().optional(),
    createdAt: z.string(),
  })
  .loose();

const verificationFailureSchema = z.object({
  type: z.enum(['test', 'lint', 'type_check', 'build', 'other']),
  fixable: z.boolean(),
  description: z.string(),
  file: z.string().optional(),
});

export const verificationContentSchema = z
  .object({
    version: z.number().min(1),
    passed: z.boolean(),
    summary: z.string().min(1),
    failures: z.array(verificationFailureSchema),
    implementationRef: artifactRefSchema.optional(),
    testPlanRef: artifactRefSchema.optional(),
    specificationRef: artifactRefSchema.optional(),
    previousVersion: z.string().optional(),
    createdAt: z.string(),
  })
  .loose();

export const agreementContentSchema = z
  .object({
    version: z.number().min(1),
    agreementType: agreementTypeSchema,
    runId: z.string(),
    stageId: z.string(),
    createdAt: z.string(),
    approvalStatus: approvalStatusSchema,
    approvalType: approvalTypeSchema,
  })
  .loose();

export const judgeDecisionContentSchema = z
  .object({
    version: z.number().min(1),
    approved: z.boolean(),
    rationale: z.string(),
    directives: z.array(z.string()),
    reviewArtifactsConsidered: z.array(z.string()),
    planLevelIssue: z.boolean().optional(),
    createdAt: z.string(),
  })
  .loose();

export const escalationContextContentSchema = z
  .object({
    version: z.number().min(1),
    runId: z.string(),
    escalationTrigger: escalationTriggerSchema,
    stateAtEscalation: z.string(),
    createdAt: z.string(),
  })
  .loose();

export const runManifestContentSchema = z
  .object({
    runId: z.string().regex(/^\d{8}-\d{6}-[a-z0-9]{6}$/),
    version: z.string(),
    repository: z.looseObject({}),
    workflow: z.looseObject({}),
    timing: z.looseObject({}),
    status: z.enum(['completed', 'aborted', 'failed']),
    finalState: z.string(),
    abortReason: z.string().optional(),
  })
  .loose();

export const intakeAnalysisContentSchema = z
  .object({
    completenessScore: z.number().min(0).max(1),
    ambiguityCount: z.number().min(0).optional(),
    riskCount: z.number().min(0).optional(),
    unvalidatedAssumptionCount: z.number().min(0).optional(),
    readinessVerdict: intakeVerdictSchema,
    analystNotes: z.string().optional(),
  })
  .loose();

const clarificationAnswerEntrySchema = z.object({
  questionId: z.string().optional(),
  question: z.string().optional(),
  answer: z.string(),
});

export const clarificationAnswersContentSchema = z
  .object({
    answers: z.array(clarificationAnswerEntrySchema).optional(),
  })
  .loose();

export const releaseSummaryContentSchema = z
  .object({
    version: z.number().min(1),
    commitMessage: z.string().min(1),
    prDescription: z.string().min(1),
    humanSummary: z.string().min(1),
    createdAt: z.string(),
  })
  .loose();

export const reviewFindingsContentSchema = z
  .object({
    version: z.number().min(1),
    title: z.string().optional(),
    summary: z.string().optional(),
    acceptanceCriteria: z
      .object({
        addressed: z
          .array(
            z.object({
              criterion: z.string(),
              evidence: z.string().optional(),
            }),
          )
          .optional(),
        partiallyAddressed: z
          .array(
            z.object({
              criterion: z.string(),
              note: z.string().optional(),
            }),
          )
          .optional(),
        notAddressed: z
          .array(
            z.object({
              criterion: z.string(),
              note: z.string().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    untrackedChanges: z.array(z.object({ file: z.string(), description: z.string() })).optional(),
    risks: z.array(z.string()).optional(),
    findings: z.array(
      z
        .object({
          description: z.string().min(1),
          file: z.string().min(1).optional(),
          actionability: z.enum(['actionable', 'advisory']).optional(),
          suggestion: z.string().min(1).optional(),
          evidence: z.string().optional(),
        })
        .loose(),
    ),
    createdAt: z.string(),
  })
  .loose();

export const intakeRequirementsContentSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    rawFields: z.record(z.string(), z.unknown()).optional(),
    sourceMetadata: z
      .object({
        fetchedAt: z.string(),
        checksum: z.string(),
      })
      .optional(),
  })
  .loose();

export const codebaseContextContentSchema = z
  .object({
    version: z.number().min(1),
    specificationRef: artifactRefSchema.optional(),
    projectStructure: z.string().min(1),
    conventions: z.array(z.string()),
    techStack: z.array(z.string()),
    affectedFiles: z.array(
      z.object({
        path: z.string(),
        reason: z.string(),
      }),
    ),
    existingPatterns: z.array(z.string()).optional(),
    createdAt: z.string(),
  })
  .loose();

export const testSuiteContentSchema = z
  .object({
    version: z.number().min(1),
    planRef: artifactRefSchema.optional(),
    implementationRef: artifactRefSchema.optional(),
    testsWritten: z.array(
      z.object({
        file: z.string(),
        description: z.string(),
        type: z.enum(['unit', 'integration', 'e2e', 'other']).optional(),
      }),
    ),
    coverageTargets: z.array(z.string()).optional(),
    edgeCases: z.array(z.string()).optional(),
    createdAt: z.string(),
  })
  .loose();

export const remediationPlanContentSchema = z
  .object({
    version: z.number().min(1),
    summary: z.string().min(1),
    planLevelIssue: z.boolean(),
    needsHuman: z.boolean(),
    actionItems: z.array(
      z.object({
        id: z.string(),
        findingRef: z.string(),
        action: z.enum(['fix', 'defer', 'dismiss', 'escalate']),
        description: z.string(),
        priority: z.enum(['critical', 'high', 'medium', 'low']),
        file: z.string().nullish(),
      }),
    ),
    dismissedFindings: z
      .array(
        z.object({
          findingId: z.string(),
          reason: z.string(),
        }),
      )
      .optional(),
    createdAt: z.string(),
  })
  .loose();

export const acceptanceValidationContentSchema = z
  .object({
    version: z.number().min(1),
    passed: z.boolean(),
    summary: z.string().min(1),
    criteriaResults: z.array(
      z.object({
        requirementId: z.string(),
        description: z.string(),
        status: z.enum(['passed', 'failed', 'not_covered']),
        evidence: z.string().optional(),
      }),
    ),
    uncoveredCriteria: z.array(z.string()).optional(),
    specificationRef: artifactRefSchema.optional(),
    verificationRef: artifactRefSchema.optional(),
    createdAt: z.string(),
  })
  .loose();

export const taskBreakdownContentSchema = z
  .object({
    version: z.number().min(1),
    tasks: z.array(z.unknown()),
  })
  .loose();

export const decompositionReviewContentSchema = z
  .object({
    version: z.number().min(1),
    approved: z.boolean(),
  })
  .loose();

export const taskSpecificationsContentSchema = z
  .object({
    version: z.number().min(1),
    specifications: z.array(z.unknown()),
  })
  .loose();

export const prDiffContextContentSchema = z
  .object({
    version: z.number().min(1),
    prNumber: z.number().optional(),
    baseRef: z.string().min(1),
    headRef: z.string().min(1),
    repositoryUrl: z.string().optional(),
    diff: z.string().min(1),
    changedFiles: z.array(
      z.object({
        path: z.string(),
        status: z.enum(['added', 'modified', 'deleted', 'renamed']),
        additions: z.number().optional(),
        deletions: z.number().optional(),
      }),
    ),
    createdAt: z.string(),
  })
  .loose();

// ---------------------------------------------------------------------------
// Standalone plan structure validation (for guards that only check DAG shape)
// ---------------------------------------------------------------------------

export function validatePlanStructure(content: {
  tasks?: ReadonlyArray<{ readonly taskId: string; readonly dependencies: readonly string[] }>;
}): readonly string[] {
  if (!content.tasks || content.tasks.length === 0) {
    return ['tasks must be non-empty'];
  }
  return validateTaskDag(content.tasks);
}
