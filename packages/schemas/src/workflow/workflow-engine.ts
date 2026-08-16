import { z } from 'zod/v4';

import { agreementTypeSchema } from '../artifacts/agreement-artifacts';
import { artifactRefSchema, artifactTypeSchema } from '../artifacts/artifact-system';
import { governanceOutcomeSchema } from '../governance/governance';
import { runManifestSchema } from '../persistence/run-manifest';
import { budgetExhaustionContextSchema } from '../persistence/state-persistence';
import { confidenceReportSchema } from '../runner/confidence';
import { roleIdSchema } from '../runner/role-system';
import {
  agentSessionRefSchema,
  sessionDispatchOutcomeSchema,
  sessionPendingRequestSchema,
  workerErrorTypeSchema,
} from '../runner/runner-system';

export const STATE_TYPES = ['action', 'review', 'judge', 'gate', 'wait', 'terminal'] as const;
export const stateTypeSchema = z.enum(STATE_TYPES);
export type StateType = z.infer<typeof stateTypeSchema>;

export const TRANSITION_TRIGGERS = [
  'completion',
  'failure',
  'review_approved',
  'review_rejected',
  'iteration_exhausted',
  'judge_approved',
  'judge_rejected',
  'escalation',
  'human_input',
  'human_approved',
  'human_rejected',
  'timeout',
] as const;
export const transitionTriggerSchema = z.enum(TRANSITION_TRIGGERS);
export type TransitionTrigger = z.infer<typeof transitionTriggerSchema>;

export const GUARD_TYPES = [
  'artifact_exists',
  'artifact_version_min',
  'agreement_exists',
  'state_visited',
  'iteration_below_limit',
  'findings_indicate_plan_issue',
  'known_failure_pattern',
  'verification_failures_are_fixable',
  'verification_passed',
  'waiting_context_matches',
  'plan_structure_valid',
  'previous_run_pattern',
  'specification_feasible',
  'has_clarification_needs',
  'synthesis_approved',
  'acceptance_passed',
  'triage_indicates_plan_issue',
  'triage_needs_human',
  'confidence_threshold',
  'project_context_available',
] as const;
export const guardTypeSchema = z.enum(GUARD_TYPES);
export type GuardType = z.infer<typeof guardTypeSchema>;

export const ACTION_TYPES = [
  'dispatch_worker',
  'dispatch_parallel_workers',
  'dispatch_dynamic_workers',
  'run_script',
  'store_artifact',
  'record_journal',
  'generate_agreement',
  'produce_manifest',
  'notify_human',
] as const;
export const actionTypeSchema = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof actionTypeSchema>;

// --- Guard variant schemas ---

const guardExtras = { waitForAll: z.boolean().optional() };

export const artifactExistsGuardSchema = z.object({
  type: z.literal('artifact_exists'),
  params: z.object({ artifactType: artifactTypeSchema, ...guardExtras }),
});

export const artifactVersionMinGuardSchema = z.object({
  type: z.literal('artifact_version_min'),
  params: z.object({ artifactType: artifactTypeSchema, minVersion: z.number(), ...guardExtras }),
});

export const agreementExistsGuardSchema = z.object({
  type: z.literal('agreement_exists'),
  params: z.object({ agreementType: agreementTypeSchema, ...guardExtras }),
});

export const stateVisitedGuardSchema = z.object({
  type: z.literal('state_visited'),
  params: z.object({ stateId: z.string(), ...guardExtras }),
});

export const iterationBelowLimitGuardSchema = z.object({
  type: z.literal('iteration_below_limit'),
  params: z.object({ contract: z.string(), ...guardExtras }),
});

export const waitingContextMatchesGuardSchema = z.object({
  type: z.literal('waiting_context_matches'),
  params: z.object({ requestingState: z.string(), ...guardExtras }),
});

export const findingsIndicatePlanIssueGuardSchema = z.object({
  type: z.literal('findings_indicate_plan_issue'),
  params: z.object({ ...guardExtras }),
});

export const verificationFailuresAreFixableGuardSchema = z.object({
  type: z.literal('verification_failures_are_fixable'),
  params: z.object({ ...guardExtras }),
});

export const verificationPassedGuardSchema = z.object({
  type: z.literal('verification_passed'),
  params: z.object({ ...guardExtras }),
});

export const planStructureValidGuardSchema = z.object({
  type: z.literal('plan_structure_valid'),
  params: z.object({ ...guardExtras }),
});

export const specificationFeasibleGuardSchema = z.object({
  type: z.literal('specification_feasible'),
  params: z.object({ ...guardExtras }),
});

export const hasClarificationNeedsGuardSchema = z.object({
  type: z.literal('has_clarification_needs'),
  params: z.object({ ...guardExtras }),
});

export const synthesisApprovedGuardSchema = z.object({
  type: z.literal('synthesis_approved'),
  params: z.object({ ...guardExtras }),
});

export const acceptancePassedGuardSchema = z.object({
  type: z.literal('acceptance_passed'),
  params: z.object({ ...guardExtras }),
});

export const knownFailurePatternGuardSchema = z.object({
  type: z.literal('known_failure_pattern'),
  params: z.object({
    patternSubstring: z.string().min(1),
    ...guardExtras,
  }),
});

export const previousRunPatternGuardSchema = z.object({
  type: z.literal('previous_run_pattern'),
  params: z.object({
    outcome: z.enum(['completed', 'failed', 'aborted', 'escalated']),
    workflowVariant: z.string().optional(),
    minOccurrences: z.number().int().min(1).optional(),
    ...guardExtras,
  }),
});

export const triageIndicatesPlanIssueGuardSchema = z.object({
  type: z.literal('triage_indicates_plan_issue'),
  params: z.object({ ...guardExtras }),
});

export const triageNeedsHumanGuardSchema = z.object({
  type: z.literal('triage_needs_human'),
  params: z.object({ ...guardExtras }),
});

export const confidenceThresholdGuardSchema = z.object({
  type: z.literal('confidence_threshold'),
  params: z.object({
    minConfidence: z.number().min(0).max(1),
    ...guardExtras,
  }),
});

export const projectContextAvailableGuardSchema = z.object({
  type: z.literal('project_context_available'),
  params: z.object({
    category: z.enum(['codebase', 'run_history', 'preferences']).optional(),
    ...guardExtras,
  }),
});

export const guardSchema = z.discriminatedUnion('type', [
  artifactExistsGuardSchema,
  artifactVersionMinGuardSchema,
  agreementExistsGuardSchema,
  stateVisitedGuardSchema,
  iterationBelowLimitGuardSchema,
  waitingContextMatchesGuardSchema,
  findingsIndicatePlanIssueGuardSchema,
  knownFailurePatternGuardSchema,
  verificationFailuresAreFixableGuardSchema,
  verificationPassedGuardSchema,
  planStructureValidGuardSchema,
  previousRunPatternGuardSchema,
  specificationFeasibleGuardSchema,
  hasClarificationNeedsGuardSchema,
  synthesisApprovedGuardSchema,
  acceptancePassedGuardSchema,
  triageIndicatesPlanIssueGuardSchema,
  triageNeedsHumanGuardSchema,
  confidenceThresholdGuardSchema,
  projectContextAvailableGuardSchema,
]);
export type Guard = z.infer<typeof guardSchema>;

// --- Action variant schemas ---

export const dispatchWorkerActionSchema = z.object({
  type: z.literal('dispatch_worker'),
  params: z.object({
    role: roleIdSchema,
    parallel: z.boolean().optional(),
    branchId: z.string().optional(),
    stateId: z.string().optional(),
  }),
});

export const dispatchParallelWorkersActionSchema = z.object({
  type: z.literal('dispatch_parallel_workers'),
  params: z.object({
    roles: z.array(roleIdSchema).readonly(),
    docsOnlyRoles: z.array(roleIdSchema).readonly().optional(),
  }),
});

export const dispatchDynamicWorkersActionSchema = z.object({
  type: z.literal('dispatch_dynamic_workers'),
  params: z.object({
    role: roleIdSchema,
    sourceArtifact: artifactTypeSchema,
    itemsPath: z.string().min(1),
  }),
});

export const storeArtifactActionSchema = z.object({
  type: z.literal('store_artifact'),
  params: z.object({
    type: artifactTypeSchema,
    content: z.string(),
    name: z.string().optional(),
  }),
});

export const recordJournalActionSchema = z.object({
  type: z.literal('record_journal'),
  params: z.object({
    event: z.enum(['run_started', 'run_completed', 'run_failed', 'run_aborted']),
  }),
});

export const generateAgreementActionSchema = z.object({
  type: z.literal('generate_agreement'),
  params: z.object({ type: agreementTypeSchema }),
});

export const notifyHumanActionSchema = z.object({
  type: z.literal('notify_human'),
  params: z.object({ reason: z.string().optional() }),
});

export const runScriptActionSchema = z.object({
  type: z.literal('run_script'),
  params: z.object({
    script: z.string(),
    timeout: z.number().optional(),
    env: z.record(z.string(), z.string()).optional(),
    storeOutput: z
      .object({
        artifactType: z.string(),
        producedBy: z.string().default('script'),
      })
      .optional(),
  }),
});

export const produceManifestActionSchema = z.object({
  type: z.literal('produce_manifest'),
  params: z.object({}),
});

export const actionSchema = z.discriminatedUnion('type', [
  dispatchWorkerActionSchema,
  dispatchParallelWorkersActionSchema,
  dispatchDynamicWorkersActionSchema,
  runScriptActionSchema,
  storeArtifactActionSchema,
  recordJournalActionSchema,
  generateAgreementActionSchema,
  notifyHumanActionSchema,
  produceManifestActionSchema,
]);
export type Action = z.infer<typeof actionSchema>;

export const transitionDefinitionSchema = z.object({
  target: z.string(),
  trigger: transitionTriggerSchema,
  guards: z.array(guardSchema).readonly(),
  governanceRequired: z.boolean(),
  priority: z.number(),
});
export type TransitionDefinition = z.infer<typeof transitionDefinitionSchema>;

export const stateDefinitionSchema = z.object({
  type: stateTypeSchema,
  label: z.string().optional(),
  description: z.string(),
  entryActions: z.array(actionSchema).readonly().optional(),
  exitActions: z.array(actionSchema).readonly().optional(),
  transitions: z.array(transitionDefinitionSchema).readonly(),
  timeout: z.number().optional(),
});
export type StateDefinition = z.infer<typeof stateDefinitionSchema>;

export const workflowBudgetSchema = z.object({
  maxTokensPerRun: z.number().optional(),
});
export type WorkflowBudget = z.infer<typeof workflowBudgetSchema>;

export const workflowDefinitionSchema = z.object({
  name: z.string(),
  version: z.string(),
  states: z.record(z.string(), stateDefinitionSchema),
  initialState: z.string(),
  terminalStates: z.array(z.string()).readonly(),
  budget: workflowBudgetSchema.optional(),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const waitingContextSchema = z.object({
  reason: z.string(),
  requiredInput: z.string(),
  requestingState: z.string(),
  autoResumeSafe: z.boolean(),
  presentedArtifacts: z.array(artifactRefSchema).readonly(),
  waitingSince: z.string(),
  budgetExhaustion: budgetExhaustionContextSchema.optional(),
});
export type WaitingContext = z.infer<typeof waitingContextSchema>;

export const engineStateSchema = z.object({
  runId: z.string(),
  currentState: z.string(),
  previousState: z.string().nullable(),
  stateEnteredAt: z.string(),
  transitionCount: z.number(),
  isWaitingForHuman: z.boolean(),
  waitingContext: waitingContextSchema.optional(),
});
export type EngineState = z.infer<typeof engineStateSchema>;

export const runResultSchema = z.object({
  runId: z.string(),
  finalState: z.string(),
  artifactInventory: z.array(artifactRefSchema).readonly(),
  manifest: runManifestSchema,
});
export type RunResult = z.infer<typeof runResultSchema>;

export const humanInputSchema = z.object({
  type: z.enum(['text', 'approval', 'rejection']),
  content: z.string(),
  artifactRef: artifactRefSchema.optional(),
});
export type HumanInput = z.infer<typeof humanInputSchema>;

export const workflowRunConfigSchema = z.object({
  runId: z.string(),
  workflowDefinition: workflowDefinitionSchema,
  governancePolicy: z.object({}),
  roleAssignments: z.record(z.string(), z.string()),
  sources: z.array(z.string()).readonly(),
  resumeFrom: z.string().optional(),
  globalTransitionLimit: z.number().optional(),
  budgetMaxTokens: z.number().optional(),
  budgetAlertThresholds: z.array(z.number()).readonly().optional(),
  reportOutputPath: z.string().optional(),
  runDir: z.string().optional(),
  repoRoot: z.string().optional(),
});
export type WorkflowRunConfig = z.infer<typeof workflowRunConfigSchema>;

export const transitionContextSchema = z.object({
  runId: z.string(),
  currentIteration: z.number(),
  stateHistory: z.array(z.string()).readonly(),
  artifactRefs: z.array(artifactRefSchema).readonly().optional(),
  waitingContext: waitingContextSchema.optional(),
  tokenUsage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    })
    .optional(),
  repoRoot: z.string().optional(),
});
export type TransitionContext = z.infer<typeof transitionContextSchema>;

export const guardResultSchema = z.object({
  guard: guardSchema,
  passed: z.boolean(),
  detail: z.string(),
});
export type GuardResult = z.infer<typeof guardResultSchema>;

export const evaluatedTransitionSchema = z.object({
  definition: transitionDefinitionSchema,
  guardsResult: z.array(guardResultSchema).readonly(),
  governanceDecision: governanceOutcomeSchema.optional(),
});
export type EvaluatedTransition = z.infer<typeof evaluatedTransitionSchema>;

export const transitionRecordSchema = z.object({
  timestamp: z.string(),
  runId: z.string(),
  from: z.string(),
  to: z.string(),
  trigger: transitionTriggerSchema,
  guardsEvaluated: z.array(guardResultSchema).readonly(),
  governanceDecision: governanceOutcomeSchema.optional(),
  actionResults: z
    .array(z.lazy(() => actionResultSchema))
    .readonly()
    .optional(),
  durationMs: z.number(),
});
export type TransitionRecord = z.infer<typeof transitionRecordSchema>;

export const workerResultSchema = z.object({
  role: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  errorType: workerErrorTypeSchema.optional(),
  artifactRef: artifactRefSchema.optional(),
  model: z.string().optional(),
});
export type WorkerResult = z.infer<typeof workerResultSchema>;

export const actionUsageSnapshotSchema = z.object({
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  byRole: z.record(
    z.string(),
    z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      durationMs: z.number(),
    }),
  ),
});
export type ActionUsageSnapshot = z.infer<typeof actionUsageSnapshotSchema>;

export const scriptDisplaySchema = z.object({
  /** Human-readable summary shown in the dashboard chat. May contain URLs. */
  message: z.string().min(1),
});
export type ScriptDisplay = z.infer<typeof scriptDisplaySchema>;

export const scriptDirectivesSchema = z.object({
  repoRoot: z.string().optional(),
});
export type ScriptDirectives = z.infer<typeof scriptDirectivesSchema>;

export const scriptOutputSchema = z.object({
  message: z.string().min(1).optional(),
  directives: scriptDirectivesSchema.optional(),
});
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;

export const scriptResultSchema = z.object({
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
  output: scriptOutputSchema.optional(),
});
export type ScriptResult = z.infer<typeof scriptResultSchema>;

export const actionResultSchema = z.object({
  action: actionSchema,
  success: z.boolean(),
  error: z.string().optional(),
  errorType: workerErrorTypeSchema.optional(),
  artifactRef: artifactRefSchema.optional(),
  artifactRefs: z.array(artifactRefSchema).readonly().optional(),
  workerResults: z.array(workerResultSchema).readonly().optional(),
  usageSnapshot: actionUsageSnapshotSchema.optional(),
  sessionOutcome: sessionDispatchOutcomeSchema.optional(),
  sessionRef: agentSessionRefSchema.optional(),
  pendingRequest: sessionPendingRequestSchema.optional(),
  scriptResult: scriptResultSchema.optional(),
  confidenceReport: confidenceReportSchema.optional(),
});
export type ActionResult = z.infer<typeof actionResultSchema>;
