import { z } from 'zod/v4';

import { approvalStatusSchema } from '../artifacts/agreement-artifacts';
import { artifactRefSchema, artifactTypeSchema } from '../artifacts/artifact-system';
import { qualityGateConfigSchema } from '../config/configuration';
import { healthStatusSchema } from '../observability/metrics';
import { budgetExhaustionContextSchema } from '../persistence/state-persistence';
import {
  liveRequestKindSchema,
  permissionDecisionActionSchema,
  roleTrustLevelSchema,
  sessionTransportSchema,
} from '../shared/string-enums';

export const runStatusSchema = z.enum([
  'running',
  'paused',
  'waiting',
  'completed',
  'aborted',
  'failed',
  'interrupted',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const dashboardWaitingContextSchema = z.object({
  reason: z.string(),
  requiredInput: z.string(),
  requestingState: z.string(),
  autoResumeSafe: z.boolean(),
  presentedArtifacts: z.array(artifactRefSchema).readonly(),
  waitingSince: z.string(),
  budgetExhaustion: budgetExhaustionContextSchema.optional(),
  liveSessionId: z.string().optional(),
  pendingRequestId: z.string().optional(),
  liveRequestType: liveRequestKindSchema.optional(),
  sessionTransport: sessionTransportSchema.optional(),
});
export type DashboardWaitingContext = z.infer<typeof dashboardWaitingContextSchema>;

export const dashboardSessionViewSchema = z.object({
  sessionId: z.string(),
  runId: z.string(),
  role: z.string(),
  stateId: z.string(),
  transport: sessionTransportSchema,
  state: z.string(),
  pendingRequestKind: liveRequestKindSchema.optional(),
  pendingRequestId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().optional(),
  error: z.string().optional(),
});
export type DashboardSessionView = z.infer<typeof dashboardSessionViewSchema>;

export const runStateViewSchema = z.object({
  runId: z.string(),
  status: runStatusSchema,
  currentState: z.string(),
  previousState: z.string().nullable(),
  startedAt: z.string(),
  stateEnteredAt: z.string(),
  elapsedMs: z.number(),
  transitionCount: z.number(),
  isWaitingForHuman: z.boolean(),
  waitingReason: z.string().optional(),
  waitingContext: dashboardWaitingContextSchema.optional(),
  repoRoot: z.string().optional(),
  processAlive: z.boolean().optional(),
});
export type RunStateView = z.infer<typeof runStateViewSchema>;

export const parallelInfoSchema = z.object({
  type: z.enum(['fork', 'join']),
  parallelRoles: z.array(z.string()).readonly().optional(),
  roleDurations: z.record(z.string(), z.number()).optional(),
  dynamicRole: z.string().optional(),
  dynamicWorkerCount: z.number().optional(),
});
export type ParallelInfo = z.infer<typeof parallelInfoSchema>;

export const stateNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string(),
  visited: z.boolean(),
  current: z.boolean(),
  timeSpentMs: z.number(),
  visitCount: z.number(),
  parallelInfo: parallelInfoSchema.optional(),
  roles: z.array(z.string()).readonly().optional(),
  /** Script names from `run_script` entry actions. */
  scripts: z.array(z.string()).readonly().optional(),
});
export type StateNode = z.infer<typeof stateNodeSchema>;

export const transitionEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  trigger: z.string(),
  traversed: z.boolean(),
  traversalCount: z.number(),
});
export type TransitionEdge = z.infer<typeof transitionEdgeSchema>;

export const workflowStateViewSchema = z.object({
  runId: z.string(),
  states: z.array(stateNodeSchema).readonly(),
  transitions: z.array(transitionEdgeSchema).readonly(),
  currentState: z.string(),
  visitedStates: z.array(z.string()).readonly(),
  stateHistory: z.array(z.string()).readonly(),
  abortReason: z.string().optional(),
});
export type WorkflowStateView = z.infer<typeof workflowStateViewSchema>;

export const artifactEntryViewSchema = z.object({
  ref: artifactRefSchema,
  type: artifactTypeSchema,
  name: z.string(),
  version: z.number(),
  producedBy: z.string(),
  createdAt: z.string(),
  sizeBytes: z.number(),
  verdict: approvalStatusSchema.optional(),
});
export type ArtifactEntryView = z.infer<typeof artifactEntryViewSchema>;

export const artifactInventoryViewSchema = z.object({
  runId: z.string(),
  artifacts: z.array(artifactEntryViewSchema).readonly(),
  totalCount: z.number(),
  totalSizeBytes: z.number(),
  byType: z.record(z.string(), z.number()),
});
export type ArtifactInventoryView = z.infer<typeof artifactInventoryViewSchema>;

export const artifactVersionViewSchema = z.object({
  ref: artifactRefSchema,
  version: z.number(),
  checksum: z.string(),
  createdAt: z.string(),
});
export type ArtifactVersionView = z.infer<typeof artifactVersionViewSchema>;

export const artifactDetailViewSchema = z.object({
  ref: artifactRefSchema,
  type: artifactTypeSchema,
  name: z.string(),
  currentVersion: z.number(),
  producedBy: z.string(),
  createdAt: z.string(),
  sizeBytes: z.number(),
  versions: z.array(artifactVersionViewSchema).readonly(),
  dependsOn: z.array(artifactRefSchema).readonly(),
  dependedOnBy: z.array(artifactRefSchema).readonly(),
});
export type ArtifactDetailView = z.infer<typeof artifactDetailViewSchema>;

export const artifactContentViewSchema = z.object({
  content: z.string(),
  contentType: z.enum(['markdown', 'json', 'text', 'diff']),
  sizeBytes: z.number(),
});
export type ArtifactContentView = z.infer<typeof artifactContentViewSchema>;

export const contractProgressViewSchema = z.object({
  contractId: z.string(),
  currentIteration: z.number(),
  maxIterations: z.number(),
  status: z.string(),
  findingsTotal: z.number(),
  findingsResolved: z.number(),
  judgeArbitrations: z.number(),
});
export type ContractProgressView = z.infer<typeof contractProgressViewSchema>;

export const iterationProgressViewSchema = z.object({
  runId: z.string(),
  contracts: z.array(contractProgressViewSchema).readonly(),
  totalIterations: z.number(),
  totalFindings: z.number(),
  resolvedFindings: z.number(),
});
export type IterationProgressView = z.infer<typeof iterationProgressViewSchema>;

export const findingEntryViewSchema = z.object({
  id: z.string(),
  severity: z.string(),
  status: z.string(),
  category: z.string(),
  description: z.string(),
  source: z.string(),
  iteration: z.number(),
});
export type FindingEntryView = z.infer<typeof findingEntryViewSchema>;

export const findingsViewSchema = z.object({
  runId: z.string(),
  findings: z.array(findingEntryViewSchema).readonly(),
  totalCount: z.number(),
  bySeverity: z.record(z.string(), z.number()),
  byStatus: z.record(z.string(), z.number()),
});
export type FindingsView = z.infer<typeof findingsViewSchema>;

export const roleUsageViewSchema = z.object({
  role: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  dispatches: z.number(),
  totalDurationMs: z.number(),
});
export type RoleUsageView = z.infer<typeof roleUsageViewSchema>;

export const usageBreakdownViewSchema = z.object({
  runId: z.string(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalTokens: z.number(),
  byRole: z.array(roleUsageViewSchema).readonly(),
  budgetSummary: z
    .object({
      configuredMaxTokens: z.number().nullable(),
      budgetExceeded: z.boolean(),
      alertThresholds: z.array(z.number()).readonly().optional(),
      crossedThresholds: z.array(z.number()).readonly().optional(),
    })
    .optional(),
});
export type UsageBreakdownView = z.infer<typeof usageBreakdownViewSchema>;

export const runSummaryViewSchema = z.object({
  runId: z.string(),
  repository: z.string(),
  repoRoot: z.string().optional(),
  workflow: z.string(),
  status: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number(),
  totalArtifacts: z.number(),
  totalTokens: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  finalState: z.string(),
  sources: z.array(z.string()).readonly().optional(),
});
export type RunSummaryView = z.infer<typeof runSummaryViewSchema>;

export const roleAssignmentViewSchema = z.object({
  role: z.string(),
  model: z.string().optional(),
  dispatchType: z.string().optional(),
  runner: z.string().optional(),
  maxTokens: z.number().nullable().optional(),
  timeoutMs: z.number().optional(),
  maxTurns: z.number().optional(),
});
export type RoleAssignmentView = z.infer<typeof roleAssignmentViewSchema>;

export const runConfigViewSchema = z.object({
  roles: z.array(roleAssignmentViewSchema).readonly(),
  iterationLimits: z.record(z.string(), z.number()),
  qualityGates: qualityGateConfigSchema,
  budget: z.object({
    maxTokensPerRun: z.number().nullable(),
  }),
  sources: z.array(z.string()).readonly().optional(),
  workflow: z.string().optional(),
});
export type RunConfigView = z.infer<typeof runConfigViewSchema>;

export const dashboardEventTypeSchema = z.enum([
  'state_changed',
  'artifact_produced',
  'finding_added',
  'finding_resolved',
  'iteration_completed',
  'worker_dispatched',
  'worker_completed',
  'script_started',
  'script_completed',
  'health_changed',
  'run_started',
  'run_completed',
  'run_failed',
  'run_aborted',
  'permission_requested',
  'permission_resolved',
  'clarification_requested',
  'clarification_resolved',
]);
export type DashboardEventType = z.infer<typeof dashboardEventTypeSchema>;

export const dashboardEventSchema = z.object({
  type: dashboardEventTypeSchema,
  timestamp: z.string(),
  runId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type DashboardEvent = z.infer<typeof dashboardEventSchema>;

export const subsystemHealthViewSchema = z.object({
  name: z.string(),
  status: healthStatusSchema,
  lastCheckedAt: z.string(),
  consecutiveFailures: z.number(),
  message: z.string(),
  version: z.string().optional(),
});
export type SubsystemHealthView = z.infer<typeof subsystemHealthViewSchema>;

export const systemHealthViewSchema = z.object({
  timestamp: z.string(),
  overallStatus: healthStatusSchema,
  subsystems: z.array(subsystemHealthViewSchema).readonly(),
});
export type SystemHealthView = z.infer<typeof systemHealthViewSchema>;

export const runnerDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  models: z.array(z.string()).readonly(),
});
export type RunnerDefinition = z.infer<typeof runnerDefinitionSchema>;

export const settingsRoleAssignmentSchema = z.object({
  model: z.string(),
  dispatchType: z.string().optional(),
  runner: z.string().optional(),
});
export type SettingsRoleAssignment = z.infer<typeof settingsRoleAssignmentSchema>;

export const settingsPermissionRuleSchema = z.object({
  action: z.string(),
  decision: z.enum(['grant', 'deny']),
  scope: z.string().optional(),
  pattern: z.string().optional(),
});

export const settingsPermissionPolicySchema = z.object({
  defaultAction: permissionDecisionActionSchema,
  rules: z.array(settingsPermissionRuleSchema).readonly().optional(),
  roleTrust: z.record(z.string(), roleTrustLevelSchema).optional(),
  safeCommands: z.array(z.string()).readonly().optional(),
});
export type SettingsPermissionPolicy = z.infer<typeof settingsPermissionPolicySchema>;

export const settingsGovernanceSchema = z.object({
  iterationLimits: z.object({
    defaults: z.record(z.string(), z.number()),
  }),
  qualityGates: qualityGateConfigSchema,
  budget: z
    .object({
      maxTokensPerRun: z.number().optional(),
    })
    .optional(),
  permissionPolicy: settingsPermissionPolicySchema.optional(),
});
export type SettingsGovernance = z.infer<typeof settingsGovernanceSchema>;

export const projectSettingsViewSchema = z.object({
  roles: z.object({
    assignments: z.record(z.string(), settingsRoleAssignmentSchema),
  }),
  governance: settingsGovernanceSchema,
  runtime: z.object({ logLevel: z.string() }),
  availableRunners: z.array(z.string()).readonly(),
  modelsByRunner: z.record(z.string(), z.array(z.string()).readonly()),
});
export type ProjectSettingsView = z.infer<typeof projectSettingsViewSchema>;
