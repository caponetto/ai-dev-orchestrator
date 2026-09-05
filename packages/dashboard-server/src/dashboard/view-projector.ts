import type {
  ApprovalStatus,
  ArtifactDetailView,
  ArtifactEntryView,
  ArtifactInventoryView,
  ArtifactRef,
  ArtifactSummary,
  ArtifactVersionView,
  ContractProgressView,
  EngineState,
  FindingEntryView,
  FindingsView,
  IterationProgressView,
  ManifestIterationSummary,
  ManifestTokenUsage,
  PersistedState,
  RoleAssignmentView,
  RoleUsage,
  RoleUsageView,
  QualityGateConfig,
  RunConfigView,
  RunManifest,
  RunStateView,
  RunStatus,
  RunSummaryView,
  StateNode,
  TransitionEdge,
  TransitionRecord,
  UsageBreakdownView,
  WorkflowDefinition,
  WorkflowStateView,
} from '@ai-dev-orchestrator/schemas';
function projectRoleAssignments(raw: Record<string, unknown>): RoleAssignmentView[] {
  const roles: RoleAssignmentView[] = [];
  const rawRoles = raw.roles as
    { assignments?: Record<string, Record<string, unknown>> } | undefined;
  if (!rawRoles?.assignments) {
    return roles;
  }

  for (const [role, assignment] of Object.entries(rawRoles.assignments)) {
    const agentConfig = assignment.agentConfig as Record<string, unknown> | undefined;
    const effectiveModel =
      (typeof agentConfig?.model === 'string' ? agentConfig.model : undefined) ??
      (typeof assignment.model === 'string' ? assignment.model : undefined);
    roles.push({
      role,
      model: effectiveModel,
      dispatchType:
        typeof assignment.dispatchType === 'string' ? assignment.dispatchType : undefined,
      runner: typeof assignment.runner === 'string' ? assignment.runner : undefined,
      maxTokens:
        typeof assignment.maxTokens === 'number' ? assignment.maxTokens : (null as number | null),
      timeoutMs: typeof agentConfig?.timeoutMs === 'number' ? agentConfig.timeoutMs : undefined,
      maxTurns: typeof agentConfig?.maxTurns === 'number' ? agentConfig.maxTurns : undefined,
    });
  }

  return roles;
}

function projectIterationLimits(rawGov?: Record<string, unknown>): Record<string, number> {
  const iterationLimits: Record<string, number> = {};
  const rawLimits = rawGov?.iterationLimits as Record<string, unknown> | undefined;
  if (!rawLimits) {
    return iterationLimits;
  }

  const defaults = rawLimits.defaults as Record<string, unknown> | undefined;
  const source = defaults && typeof defaults === 'object' ? defaults : rawLimits;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number') {
      iterationLimits[key] = value;
    }
  }

  return iterationLimits;
}

function projectQualityGates(rawGov?: Record<string, unknown>): RunConfigView['qualityGates'] {
  const rawGates = rawGov?.qualityGates as QualityGateConfig | undefined;
  return {
    specificationReadiness: {
      minCompletenessScore: rawGates?.specificationReadiness.minCompletenessScore ?? 0,
    },
    implementationReview: {
      maxHighSeverityFindings: rawGates?.implementationReview.maxHighSeverityFindings ?? 0,
      maxMediumSeverityFindings: rawGates?.implementationReview.maxMediumSeverityFindings ?? 0,
    },
  };
}

function projectBudget(rawGov?: Record<string, unknown>) {
  const rawBudget = rawGov?.budget as Record<string, unknown> | undefined;
  return {
    maxTokensPerRun:
      typeof rawBudget?.maxTokensPerRun === 'number' ? rawBudget.maxTokensPerRun : null,
  };
}

/** Derive the run status from engine state and workflow state types. */
function deriveRunStatus(
  engineState: EngineState,
  stateTypes?: Readonly<Record<string, string>>,
): RunStatus {
  if (engineState.isWaitingForHuman) {
    return 'waiting';
  }
  if (stateTypes?.[engineState.currentState] === 'terminal') {
    const lower = engineState.currentState.toLowerCase();
    if (lower.includes('abort')) {
      return 'aborted';
    }
    if (lower.includes('fail')) {
      return 'failed';
    }
    return 'completed';
  }
  return 'running';
}

/** Project engine state to a run state view. */
export function projectRunState(
  engineState: EngineState,
  startedAt: string,
  now: string,
  stateTypes?: Readonly<Record<string, string>>,
): RunStateView {
  const elapsedMs = new Date(now).getTime() - new Date(startedAt).getTime();

  return {
    runId: engineState.runId,
    status: deriveRunStatus(engineState, stateTypes),
    currentState: engineState.currentState,
    previousState: engineState.previousState,
    startedAt,
    stateEnteredAt: engineState.stateEnteredAt,
    elapsedMs,
    transitionCount: engineState.transitionCount,
    isWaitingForHuman: engineState.isWaitingForHuman,
    waitingReason: engineState.waitingContext?.reason,
    waitingContext: engineState.waitingContext
      ? {
          reason: engineState.waitingContext.reason,
          requiredInput: engineState.waitingContext.requiredInput,
          requestingState: engineState.waitingContext.requestingState,
          autoResumeSafe: engineState.waitingContext.autoResumeSafe,
          presentedArtifacts: engineState.waitingContext.presentedArtifacts,
          waitingSince: engineState.waitingContext.waitingSince,
          budgetExhaustion: engineState.waitingContext.budgetExhaustion,
        }
      : undefined,
  };
}

/** A transition from the workflow definition (may not yet be traversed). */
export interface DefinitionTransition {
  readonly from: string;
  readonly to: string;
  readonly trigger: string;
}

export interface ProjectWorkflowViewOptions {
  readonly runId: string;
  readonly stateNames: readonly string[];
  readonly stateTypes: Readonly<Record<string, string>>;
  readonly currentState: string;
  readonly transitionRecords: readonly TransitionRecord[];
  readonly definitionTransitions?: readonly DefinitionTransition[];
  readonly parallelStates?: ReadonlyMap<string, readonly string[]>;
  readonly dynamicParallelStates?: ReadonlyMap<string, string>;
  readonly stateTimestamps?: readonly { stateId: string; enteredAt: string; exitedAt: string }[];
  readonly currentStateEnteredAt?: string;
  readonly stateHistory?: readonly string[];
  readonly abortReason?: string;
  readonly stateLabels?: Readonly<Record<string, string>>;
  readonly stateRoles?: ReadonlyMap<string, readonly string[]>;
  /** Script names from `run_script` entry actions, keyed by state ID. */
  readonly stateScripts?: ReadonlyMap<string, readonly string[]>;
  readonly workerMetricsByRole?: Readonly<
    Record<string, { durationMs: number; dispatches?: number }>
  >;
}

/** Project workflow state to a workflow view with visited states and transitions. */
export function projectWorkflowView(options: ProjectWorkflowViewOptions): WorkflowStateView {
  const {
    runId,
    stateNames,
    stateTypes,
    currentState,
    transitionRecords,
    definitionTransitions = [],
    parallelStates = new Map<string, readonly string[]>(),
    dynamicParallelStates = new Map<string, string>(),
    stateTimestamps = [],
    currentStateEnteredAt,
    stateHistory = [],
    abortReason,
    stateLabels = {},
    stateRoles,
    stateScripts,
    workerMetricsByRole,
  } = options;
  const visitCounts = new Map<string, number>();
  const timings = new Map<string, number>();
  const edgeCounts = new Map<string, number>();
  const visitedSet = new Set<string>();

  const timestampTimings = new Map<string, number>();
  for (const st of stateTimestamps) {
    const entered = new Date(st.enteredAt).getTime();
    const exited = new Date(st.exitedAt).getTime();
    if (entered > 0 && exited > 0) {
      timestampTimings.set(
        st.stateId,
        (timestampTimings.get(st.stateId) ?? 0) + (exited - entered),
      );
    }
  }

  for (let i = 0; i < transitionRecords.length; i++) {
    const tr = transitionRecords[i];
    visitedSet.add(tr.from);
    visitedSet.add(tr.to);
    visitCounts.set(tr.to, (visitCounts.get(tr.to) ?? 0) + 1);

    if (!timestampTimings.has(tr.from)) {
      const endTs =
        tr.to === currentState && currentStateEnteredAt
          ? new Date(currentStateEnteredAt).getTime()
          : new Date(tr.timestamp).getTime();
      let duration: number;
      if (i > 0) {
        const prevTs = new Date(transitionRecords[i - 1].timestamp).getTime();
        duration = Math.max(0, endTs - prevTs);
      } else if (stateTimestamps.length > 0) {
        const lastCovered = stateTimestamps[stateTimestamps.length - 1];
        const startTs = new Date(lastCovered.exitedAt).getTime();
        duration = Math.max(0, endTs - startTs);
      } else {
        duration = tr.durationMs;
      }
      timings.set(tr.from, (timings.get(tr.from) ?? 0) + duration);
    }

    const edgeKey = `${tr.from}->${tr.to}:${tr.trigger}`;
    edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1);
  }

  for (const [stateId, ms] of timestampTimings) {
    timings.set(stateId, ms);
  }

  const states: StateNode[] = stateNames.map((id) => {
    const parallelRoles = parallelStates.get(id);
    const dynamicRole = dynamicParallelStates.get(id);
    const assignedRoles = stateRoles?.get(id);
    const assignedScripts = stateScripts?.get(id);

    let parallelInfo:
      | {
          type: 'fork';
          parallelRoles?: readonly string[];
          roleDurations?: Record<string, number>;
          dynamicRole?: string;
          dynamicWorkerCount?: number;
        }
      | undefined;
    if (parallelRoles) {
      let roleDurations: Record<string, number> | undefined;
      if (workerMetricsByRole) {
        const durations: Record<string, number> = {};
        for (const role of parallelRoles) {
          if (role in workerMetricsByRole && workerMetricsByRole[role].durationMs > 0) {
            durations[role] = workerMetricsByRole[role].durationMs;
          }
        }
        if (Object.keys(durations).length > 0) {
          roleDurations = durations;
        }
      }
      parallelInfo = {
        type: 'fork' as const,
        parallelRoles,
        ...(roleDurations ? { roleDurations } : {}),
      };
    } else if (dynamicRole) {
      const dispatches = workerMetricsByRole?.[dynamicRole]?.dispatches;
      parallelInfo = {
        type: 'fork' as const,
        dynamicRole,
        ...(dispatches && dispatches > 0 ? { dynamicWorkerCount: dispatches } : {}),
      };
    }

    const hasScripts = assignedScripts != null && assignedScripts.length > 0;

    return {
      id,
      type: hasScripts ? 'script' : (stateTypes[id] ?? 'action'),
      label: stateLabels[id] ?? id,
      visited: visitedSet.has(id),
      current: id === currentState,
      timeSpentMs: timings.get(id) ?? 0,
      visitCount: visitCounts.get(id) ?? 0,
      ...(parallelInfo ? { parallelInfo } : {}),
      ...(assignedRoles && assignedRoles.length > 0 ? { roles: assignedRoles } : {}),
      ...(hasScripts ? { scripts: assignedScripts } : {}),
    };
  });

  const edgeMap = new Map<string, TransitionEdge>();

  for (const dt of definitionTransitions) {
    const key = `${dt.from}->${dt.to}:${dt.trigger}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        from: dt.from,
        to: dt.to,
        trigger: dt.trigger,
        traversed: false,
        traversalCount: 0,
      });
    }
  }

  // Find the last transition into each terminal state from the journal.
  // Earlier transitions to the same terminal (e.g. a prior abort before resume)
  // were superseded and should not be marked traversed.
  const terminalStates = new Set<string>(stateNames.filter((id) => stateTypes[id] === 'terminal'));
  const lastTerminalSource = new Map<string, string>();
  for (const tr of transitionRecords) {
    if (terminalStates.has(tr.to) && tr.from !== tr.to) {
      lastTerminalSource.set(tr.to, tr.from);
    }
  }

  for (const tr of transitionRecords) {
    const key = `${tr.from}->${tr.to}:${tr.trigger}`;
    // Skip superseded transitions to terminal states
    if (terminalStates.has(tr.to) && lastTerminalSource.get(tr.to) !== tr.from) {
      continue;
    }
    const existing = edgeMap.get(key);
    if (!existing?.traversed) {
      edgeMap.set(key, {
        from: tr.from,
        to: tr.to,
        trigger: tr.trigger,
        traversed: true,
        traversalCount: edgeCounts.get(key) ?? 1,
      });
    }
  }

  return {
    runId,
    states,
    transitions: [...edgeMap.values()],
    currentState,
    visitedStates: [...visitedSet],
    stateHistory: stateHistory.length > 0 ? stateHistory : [...visitedSet],
    ...(abortReason ? { abortReason } : {}),
  };
}

/** Build a static WorkflowStateView from a WorkflowDefinition (no runtime data). */
export function projectWorkflowPreview(def: WorkflowDefinition): WorkflowStateView {
  const stateNames = Object.keys(def.states);

  const states: StateNode[] = stateNames.map((id) => {
    const stateDef = def.states[id];
    const parallelAction = stateDef.entryActions?.find(
      (a) => a.type === 'dispatch_parallel_workers',
    );
    const parallelRoles =
      parallelAction?.type === 'dispatch_parallel_workers'
        ? [...parallelAction.params.roles]
        : undefined;

    const dynamicAction = stateDef.entryActions?.find((a) => a.type === 'dispatch_dynamic_workers');
    const dynamicRole =
      dynamicAction?.type === 'dispatch_dynamic_workers' ? dynamicAction.params.role : undefined;

    const allRoles: string[] = [];
    const allScripts: string[] = [];
    for (const action of stateDef.entryActions ?? []) {
      if (action.type === 'dispatch_worker') {
        allRoles.push(action.params.role);
      } else if (action.type === 'dispatch_parallel_workers') {
        allRoles.push(...action.params.roles);
      } else if (action.type === 'dispatch_dynamic_workers') {
        allRoles.push(action.params.role);
      } else if (action.type === 'run_script') {
        allScripts.push(action.params.script);
      }
    }

    const hasScripts = allScripts.length > 0;

    const parallelInfo =
      parallelRoles && parallelRoles.length > 1
        ? { type: 'fork' as const, parallelRoles }
        : dynamicRole
          ? { type: 'fork' as const, dynamicRole }
          : undefined;

    return {
      id,
      type: hasScripts ? 'script' : stateDef.type,
      label: stateDef.label ?? id,
      visited: false,
      current: false,
      timeSpentMs: 0,
      visitCount: 0,
      ...(parallelInfo ? { parallelInfo } : {}),
      ...(allRoles.length > 0 ? { roles: allRoles } : {}),
      ...(hasScripts ? { scripts: allScripts } : {}),
    };
  });

  const transitions: TransitionEdge[] = [];
  for (const [fromId, stateDef] of Object.entries(def.states)) {
    for (const t of stateDef.transitions) {
      transitions.push({
        from: fromId,
        to: t.target,
        trigger: t.trigger,
        traversed: false,
        traversalCount: 0,
      });
    }
  }

  return {
    runId: '',
    states,
    transitions,
    currentState: '',
    visitedStates: [],
    stateHistory: [],
  };
}

/** Project artifact summaries to an artifact inventory view. */
export function projectArtifactView(
  runId: string,
  artifacts: readonly ArtifactSummary[],
  verdicts?: ReadonlyMap<string, ApprovalStatus>,
): ArtifactInventoryView {
  const byType: Record<string, number> = {};
  const entries: ArtifactEntryView[] = artifacts.map((a) => {
    byType[a.type] = (byType[a.type] ?? 0) + 1;
    const verdictKey = `${a.type}/${a.name}@${String(a.version)}`;
    const verdict = verdicts?.get(verdictKey);
    return {
      ref: a.ref,
      type: a.type,
      name: a.name,
      version: a.version,
      producedBy: a.producedBy,
      createdAt: a.createdAt,
      sizeBytes: a.sizeBytes,
      ...(verdict ? { verdict } : {}),
    };
  });

  return {
    runId,
    artifacts: entries,
    totalCount: artifacts.length,
    totalSizeBytes: artifacts.reduce((sum, a) => sum + a.sizeBytes, 0),
    byType,
  };
}

/** Project iteration summaries to an iteration progress view. */
export function projectIterationView(
  runId: string,
  iterations: readonly ManifestIterationSummary[],
  runStatus?: string,
  contractLimits?: Readonly<Record<string, number>>,
): IterationProgressView {
  const terminalStatus =
    runStatus === 'completed' || runStatus === 'aborted' || runStatus === 'interrupted'
      ? runStatus
      : undefined;
  const contracts: ContractProgressView[] = iterations.map((it) => ({
    contractId: it.contractId,
    currentIteration: it.totalIterations,
    maxIterations: contractLimits?.[it.contractId] ?? it.totalIterations,
    status: terminalStatus && it.finalStatus === 'in_progress' ? terminalStatus : it.finalStatus,
    findingsTotal: it.findingsTotal,
    findingsResolved: it.findingsResolved,
    judgeArbitrations: it.judgeArbitrations,
  }));

  return {
    runId,
    contracts,
    totalIterations: iterations.reduce((sum, it) => sum + it.totalIterations, 0),
    totalFindings: iterations.reduce((sum, it) => sum + it.findingsTotal, 0),
    resolvedFindings: iterations.reduce((sum, it) => sum + it.findingsResolved, 0),
  };
}

/** Project iteration progress from persisted state (live runs without a manifest). */
export function projectIterationViewFromState(
  runId: string,
  iterationCounts: Readonly<Record<string, number>>,
  judgeArbitrationCounts: Readonly<Record<string, number>>,
  contractLimits: Readonly<Record<string, number>>,
  findings: readonly FindingData[],
): IterationProgressView {
  const findingsByContract = aggregateFindingsByContract(findings);
  const contracts: ContractProgressView[] = Object.entries(iterationCounts).map(
    ([contractId, currentIteration]) => {
      const cf = findingsByContract.get(contractId);
      return {
        contractId,
        currentIteration,
        maxIterations: contractLimits[contractId] ?? currentIteration,
        status: 'in_progress',
        findingsTotal: cf?.total ?? 0,
        findingsResolved: cf?.resolved ?? 0,
        judgeArbitrations: judgeArbitrationCounts[contractId] ?? 0,
      };
    },
  );

  const totalFindings = contracts.reduce((sum, c) => sum + c.findingsTotal, 0);
  const resolvedFindings = contracts.reduce((sum, c) => sum + c.findingsResolved, 0);

  return {
    runId,
    contracts,
    totalIterations: contracts.reduce((sum, c) => sum + c.currentIteration, 0),
    totalFindings,
    resolvedFindings,
  };
}

export function deduplicateFindings(findings: readonly FindingData[]): {
  unique: ReadonlyMap<string, FindingData>;
  total: number;
  resolved: number;
} {
  const unique = new Map<string, FindingData>();
  for (const f of findings) {
    unique.set(f.id, f);
  }
  let total = 0;
  let resolved = 0;
  for (const f of unique.values()) {
    total++;
    if (f.status === 'resolved' || f.status === 'accepted') {
      resolved++;
    }
  }
  return { unique, total, resolved };
}

const DEFAULT_CONTRACT_ID = 'implementation_review_loop';

function aggregateFindingsByContract(
  findings: readonly FindingData[],
): Map<string, { total: number; resolved: number }> {
  const result = new Map<string, { total: number; resolved: number }>();
  const { unique } = deduplicateFindings(findings);
  for (const f of unique.values()) {
    const contractId = f.contractId ?? DEFAULT_CONTRACT_ID;
    const entry = result.get(contractId) ?? { total: 0, resolved: 0 };
    entry.total++;
    if (f.status === 'resolved' || f.status === 'accepted') {
      entry.resolved++;
    }
    result.set(contractId, entry);
  }
  return result;
}

/** Raw finding data for projection. */
export interface FindingData {
  readonly id: string;
  readonly severity: string;
  readonly status: string;
  readonly category: string;
  readonly description: string;
  readonly source: string;
  readonly iteration: number;
  readonly contractId?: string;
}

/** Project findings data to a findings view with aggregations. */
export function projectFindingsView(runId: string, findings: readonly FindingData[]): FindingsView {
  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  const entries: FindingEntryView[] = findings.map((f) => {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
    return { ...f };
  });

  return {
    runId,
    findings: entries,
    totalCount: findings.length,
    bySeverity,
    byStatus,
  };
}

/** Project token usage and roles to a usage breakdown view. */
export function projectUsageView(
  runId: string,
  tokenUsage: ManifestTokenUsage,
  roles: readonly RoleUsage[],
): UsageBreakdownView {
  const byRole: RoleUsageView[] = roles.map((r) => ({
    role: r.role,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    dispatches: r.dispatches,
    totalDurationMs: r.totalDurationMs,
  }));

  return {
    runId,
    totalInputTokens: tokenUsage.totalInputTokens,
    totalOutputTokens: tokenUsage.totalOutputTokens,
    totalTokens: tokenUsage.totalTokens,
    byRole,
  };
}

/** Project a usage breakdown view from live persisted state (active runs without a manifest). */
export function projectUsageViewFromState(
  runId: string,
  state: PersistedState,
): UsageBreakdownView {
  const inputTokens = state.cumulativeInputTokens ?? 0;
  const outputTokens = state.cumulativeOutputTokens ?? 0;

  const byRole: RoleUsageView[] = state.workerMetricsByRole
    ? Object.entries(state.workerMetricsByRole).map(([role, m]) => ({
        role,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        dispatches: m.dispatches,
        totalDurationMs: m.durationMs,
      }))
    : [];

  return {
    runId,
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    totalTokens: inputTokens + outputTokens,
    byRole,
  };
}

/** Project a run manifest to a run summary view. */
export function projectRunSummary(manifest: RunManifest): RunSummaryView {
  return {
    runId: manifest.runId,
    repository: manifest.repository,
    repoRoot: manifest.repoRoot,
    workflow: manifest.workflow.name,
    status: manifest.status,
    startedAt: manifest.timing.startedAt,
    completedAt: manifest.timing.completedAt,
    durationMs: manifest.timing.totalDurationMs,
    totalArtifacts: manifest.totalArtifacts,
    totalTokens: manifest.tokenUsage.totalTokens,
    totalInputTokens: manifest.tokenUsage.totalInputTokens,
    totalOutputTokens: manifest.tokenUsage.totalOutputTokens,
    finalState: manifest.finalState,
  };
}

/** Project artifact detail with version history and dependency graph. */
export function projectArtifactDetail(
  artifact: ArtifactSummary,
  versionHistory: readonly ArtifactRef[],
  allArtifacts: readonly ArtifactSummary[],
): ArtifactDetailView {
  const versions: ArtifactVersionView[] = versionHistory.map((ref) => ({
    ref,
    version: ref.version,
    checksum: ref.checksum,
    createdAt: artifact.createdAt,
  }));

  const dependsOn = buildDependencies(artifact, allArtifacts);
  const dependedOnBy = buildDependents(artifact, allArtifacts);

  return {
    ref: artifact.ref,
    type: artifact.type,
    name: artifact.name,
    currentVersion: artifact.version,
    producedBy: artifact.producedBy,
    createdAt: artifact.createdAt,
    sizeBytes: artifact.sizeBytes,
    versions,
    dependsOn,
    dependedOnBy,
  };
}

const ARTIFACT_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  plan: ['canonical_specification'],
  implementation: ['plan'],
  static_review: ['implementation'],
  design_review: ['implementation'],
  security_review: ['implementation'],
  performance_review: ['implementation'],
  adversarial_review: ['implementation'],
  docs_review: ['implementation'],
  ux_review: ['implementation'],
  verification: ['implementation', 'test_plan'],
  plan_review: ['plan'],
  test_plan: ['plan'],
};

function invertDependencyMap(
  deps: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, string[]> = {};
  for (const [type, upstreams] of Object.entries(deps)) {
    for (const upstream of upstreams) {
      (result[upstream] ??= []).push(type);
    }
  }
  return result;
}

const ARTIFACT_DEPENDENTS: Readonly<Record<string, readonly string[]>> =
  invertDependencyMap(ARTIFACT_DEPENDENCIES);

function buildDependencies(
  artifact: ArtifactSummary,
  allArtifacts: readonly ArtifactSummary[],
): ArtifactRef[] {
  const deps: ArtifactRef[] = [];
  for (const depType of ARTIFACT_DEPENDENCIES[artifact.type] ?? []) {
    const dep = allArtifacts.find((a) => a.type === depType);
    if (dep) {
      deps.push(dep.ref);
    }
  }
  return deps;
}

function buildDependents(
  artifact: ArtifactSummary,
  allArtifacts: readonly ArtifactSummary[],
): ArtifactRef[] {
  const dependents: ArtifactRef[] = [];
  for (const downType of ARTIFACT_DEPENDENTS[artifact.type] ?? []) {
    const dep = allArtifacts.find((a) => a.type === downType);
    if (dep) {
      dependents.push(dep.ref);
    }
  }
  return dependents;
}

/** Project a raw config snapshot into a typed RunConfigView. */
export function projectRunConfig(raw: Record<string, unknown>): RunConfigView {
  const rawGov = raw.governance as Record<string, unknown> | undefined;
  const rawWorkflow = raw.workflow as Record<string, unknown> | undefined;
  const workflowName = typeof rawWorkflow?.name === 'string' ? rawWorkflow.name : undefined;
  return {
    roles: projectRoleAssignments(raw),
    iterationLimits: projectIterationLimits(rawGov),
    qualityGates: projectQualityGates(rawGov),
    budget: projectBudget(rawGov),
    sources: Array.isArray(raw.sources) ? (raw.sources as string[]) : undefined,
    workflow: workflowName,
  };
}
