import { VERDICT_ARTIFACT_TYPES, safeJsonParse } from '@ai-orchestrator/artifacts';
import type { EventCapableDataProvider, SessionCapableDataProvider } from '@ai-orchestrator/ports';
import type {
  AgentSessionSnapshot,
  ApprovalStatus,
  ArtifactContentView,
  ArtifactDetailView,
  ArtifactInventoryView,
  ArtifactRef,
  ArtifactSummary,
  DashboardEvent,
  DashboardSessionView,
  EngineState,
  FindingsView,
  HealthStatus,
  IterationProgressView,
  PersistedState,
  RunConfigView,
  RunManifest,
  RunStateView,
  RunSummaryView,
  SubsystemHealth,
  SystemHealthView,
  TransitionRecord,
  UsageBreakdownView,
  WorkflowStateView,
  Result,
} from '@ai-orchestrator/schemas';
import { err, ok } from '@ai-orchestrator/schemas';
import { z } from 'zod';

import { DashboardDataError } from '../domain/dashboard-errors';

import type { DefinitionTransition, FindingData } from './view-projector';
import {
  deduplicateFindings,
  projectArtifactDetail,
  projectArtifactView,
  projectFindingsView,
  projectIterationView,
  projectIterationViewFromState,
  projectRunConfig,
  projectRunState,
  projectRunSummary,
  projectUsageView,
  projectUsageViewFromState,
  projectWorkflowView,
} from './view-projector';

/** Data sources required by the dashboard data provider. */
export interface DashboardDataSources {
  readonly getEngineState: (runId: string) => EngineState | null;
  readonly getStartedAt: (runId: string) => string | null;
  readonly getStateNames: (runId: string) => readonly string[];
  readonly getStateTypes: (runId: string) => Readonly<Record<string, string>>;
  readonly getStateLabels: (runId: string) => Readonly<Record<string, string>>;
  readonly getTransitionRecords: (runId: string) => readonly TransitionRecord[];
  readonly getDefinitionTransitions: (runId: string) => readonly DefinitionTransition[];
  readonly getParallelStates: (runId: string) => ReadonlyMap<string, readonly string[]>;
  readonly getDynamicParallelStates?: (runId: string) => ReadonlyMap<string, string>;
  readonly getStateRoles?: (runId: string) => ReadonlyMap<string, readonly string[]>;
  readonly getStateScripts?: (runId: string) => ReadonlyMap<string, readonly string[]>;
  readonly getArtifacts: (runId: string) => readonly ArtifactSummary[];
  readonly getManifest: (runId: string) => RunManifest | null;
  readonly getManifests: () => readonly RunManifest[];
  readonly getPersistedState: (runId: string) => PersistedState | null;
  readonly getFindings: (runId: string) => readonly FindingData[];
  readonly getContractLimits?: () => Readonly<Record<string, number>>;
  readonly getArtifactVersionHistory: (ref: ArtifactRef) => readonly ArtifactRef[];
  readonly getSubsystemHealth: () => readonly SubsystemHealth[];
  readonly getArtifactContentText: (
    runId: string,
    type: string,
    name: string,
    version: number,
  ) => string | null;
  readonly getRunConfig: (runId: string) => Record<string, unknown> | null;
  readonly getRunEvents?: (runId: string) => readonly DashboardEvent[];
  readonly clock: () => string;
  readonly getSessionSnapshots?: (runId: string) => readonly AgentSessionSnapshot[];
}

/** Default implementation of dashboard data provider using provided sources. */
export class DefaultDashboardDataProvider
  implements EventCapableDataProvider, SessionCapableDataProvider
{
  constructor(private readonly sources: DashboardDataSources) {}

  /** @inheritdoc */
  getRunState(runId: string): Result<RunStateView> {
    const engine = this.sources.getEngineState(runId);
    if (!engine) {
      return err(new DashboardDataError('engine', `No engine state for run ${runId}`));
    }
    const startedAt = this.sources.getStartedAt(runId) ?? this.sources.clock();
    const stateTypes = this.sources.getStateTypes(runId);
    const stateType = stateTypes[engine.currentState];
    const isTerminal = stateType === 'terminal';
    const endTime = isTerminal ? engine.stateEnteredAt : this.sources.clock();
    const view = projectRunState(engine, startedAt, endTime, stateTypes);

    const manifest = this.sources.getManifest(runId);
    const repoRoot = manifest?.repoRoot;

    if (view.status === 'running') {
      if (
        manifest &&
        manifest.status !== 'running' &&
        manifest.status !== 'interrupted' &&
        manifest.status !== 'waiting'
      ) {
        return ok({ ...view, status: manifest.status as RunStateView['status'], repoRoot });
      }
    }

    return ok({ ...view, repoRoot });
  }

  /** @inheritdoc */
  getWorkflowView(runId: string): Result<WorkflowStateView> {
    const engine = this.sources.getEngineState(runId);
    if (!engine) {
      return err(new DashboardDataError('engine', `No engine state for run ${runId}`));
    }

    const persistedState = this.sources.getPersistedState(runId);
    const manifest = this.sources.getManifest(runId);
    return ok(
      projectWorkflowView({
        runId,
        stateNames: this.sources.getStateNames(runId),
        stateTypes: this.sources.getStateTypes(runId),
        currentState: engine.currentState,
        transitionRecords: this.sources.getTransitionRecords(runId),
        definitionTransitions: this.sources.getDefinitionTransitions(runId),
        parallelStates: this.sources.getParallelStates(runId),
        dynamicParallelStates: this.sources.getDynamicParallelStates?.(runId),
        stateTimestamps: persistedState?.stateTimestamps ?? [],
        currentStateEnteredAt: engine.stateEnteredAt,
        stateHistory: persistedState?.stateHistory ?? [],
        abortReason: manifest?.abortReason,
        stateLabels: this.sources.getStateLabels(runId),
        stateRoles: this.sources.getStateRoles?.(runId),
        stateScripts: this.sources.getStateScripts?.(runId),
        workerMetricsByRole: persistedState?.workerMetricsByRole,
      }),
    );
  }

  /** @inheritdoc */
  getArtifactView(runId: string): Result<ArtifactInventoryView> {
    const artifacts = this.sources.getArtifacts(runId);
    const verdicts = this.computeVerdicts(runId, artifacts);
    return ok(projectArtifactView(runId, artifacts, verdicts));
  }

  /** @inheritdoc */
  getArtifactDetail(runId: string, ref: ArtifactRef): Result<ArtifactDetailView> {
    const artifacts = this.sources.getArtifacts(runId);
    const artifact = artifacts.find(
      (a) => a.type === ref.type && a.name === ref.name && a.version === ref.version,
    );
    if (!artifact) {
      return err(
        new DashboardDataError(
          'artifact',
          `No artifact ${ref.type}/${ref.name}@${String(ref.version)} for run ${runId}`,
        ),
      );
    }
    const versionHistory = this.sources.getArtifactVersionHistory(ref);
    return ok(projectArtifactDetail(artifact, versionHistory, artifacts));
  }

  /** @inheritdoc */
  getRunConfig(runId: string): RunConfigView | null {
    const raw = this.sources.getRunConfig(runId);
    if (!raw) {
      return null;
    }
    return projectRunConfig(raw);
  }

  /** @inheritdoc */
  getRunEvents(runId: string): readonly DashboardEvent[] {
    return this.sources.getRunEvents?.(runId) ?? [];
  }

  /** @inheritdoc */
  getArtifactContent(
    runId: string,
    type: string,
    name: string,
    version: number,
  ): Result<ArtifactContentView> {
    const content = this.sources.getArtifactContentText(runId, type, name, version);
    if (content === null) {
      return err(
        new DashboardDataError(
          'artifact',
          `No content for artifact ${type}/${name}@${String(version)} in run ${runId}`,
        ),
      );
    }

    let contentType: ArtifactContentView['contentType'] = 'text';
    if (safeJsonParse(content, z.unknown()).success) {
      contentType = 'json';
    } else if (
      content.startsWith('---') ||
      content.startsWith('@@') ||
      content.startsWith('diff ')
    ) {
      contentType = 'diff';
    } else {
      contentType = content.includes('#') || content.includes('**') ? 'markdown' : 'text';
    }

    return ok({
      content,
      contentType,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    });
  }

  /** @inheritdoc */
  getIterationView(runId: string): Result<IterationProgressView> {
    const contractLimits = this.sources.getContractLimits?.() ?? {};
    const manifest = this.sources.getManifest(runId);
    if (manifest) {
      const findings = this.sources.getFindings(runId);
      const enriched = this.enrichIterationsWithFindings(manifest.iterations, findings);
      return ok(projectIterationView(runId, enriched, manifest.status, contractLimits));
    }

    const state = this.sources.getPersistedState(runId);
    if (!state) {
      return ok({
        runId,
        contracts: [],
        totalIterations: 0,
        totalFindings: 0,
        resolvedFindings: 0,
      });
    }

    const findings = this.sources.getFindings(runId);
    return ok(
      projectIterationViewFromState(
        runId,
        state.iterationCounts,
        state.judgeArbitrationCounts ?? {},
        contractLimits,
        findings,
      ),
    );
  }

  /** @inheritdoc */
  getFindingsView(runId: string): Result<FindingsView> {
    const findings = this.sources.getFindings(runId);
    return ok(projectFindingsView(runId, findings));
  }

  /** @inheritdoc */
  getUsageView(runId: string): Result<UsageBreakdownView> {
    const manifest = this.sources.getManifest(runId);
    let view: UsageBreakdownView;
    if (manifest) {
      view = projectUsageView(runId, manifest.tokenUsage, manifest.activeRoles);
    } else {
      const state = this.sources.getPersistedState(runId);
      if (!state) {
        return err(new DashboardDataError('manifest', `No data for run ${runId}`));
      }
      view = projectUsageViewFromState(runId, state);
    }

    const budgetSummary = this.buildBudgetSummary(runId, manifest, view.totalTokens);
    if (budgetSummary) {
      view = { ...view, budgetSummary };
    }
    return ok(view);
  }

  private buildBudgetSummary(
    runId: string,
    manifest: RunManifest | null,
    totalTokens: number,
  ): UsageBreakdownView['budgetSummary'] {
    const rawConfig = this.sources.getRunConfig(runId);
    const rawGov = rawConfig?.governance as Record<string, unknown> | undefined;
    const rawBudget = rawGov?.budget as Record<string, unknown> | undefined;
    const rawWorkflow = rawConfig?.workflow as Record<string, unknown> | undefined;
    const rawWorkflowBudget = rawWorkflow?.budget as Record<string, unknown> | undefined;

    const workflowMaxTokens =
      typeof rawWorkflowBudget?.maxTokensPerRun === 'number'
        ? rawWorkflowBudget.maxTokensPerRun
        : null;
    const govMaxTokens =
      typeof rawBudget?.maxTokensPerRun === 'number' ? rawBudget.maxTokensPerRun : null;

    const configuredMaxTokens =
      manifest?.budgetSummary?.configuredMaxTokens ?? workflowMaxTokens ?? govMaxTokens;

    if (configuredMaxTokens == null) {
      return undefined;
    }

    const budgetExceeded =
      manifest?.budgetSummary?.budgetExceeded ?? totalTokens > configuredMaxTokens;

    const rawThresholds = rawBudget?.alertThresholds;
    const alertThresholds = Array.isArray(rawThresholds)
      ? (rawThresholds as number[]).filter((t) => typeof t === 'number').sort((a, b) => a - b)
      : undefined;

    const ratio = configuredMaxTokens > 0 ? totalTokens / configuredMaxTokens : 0;
    const crossedThresholds = alertThresholds?.filter((t) => ratio >= t);

    return {
      configuredMaxTokens,
      budgetExceeded,
      alertThresholds,
      crossedThresholds,
    };
  }

  /** @inheritdoc */
  getRunHistory(): Result<readonly RunSummaryView[]> {
    const manifests = this.sources.getManifests();
    const summaries = manifests.map((manifest) => {
      const summary = projectRunSummary(manifest);
      const raw = this.sources.getRunConfig(manifest.runId);
      const patches: Partial<RunSummaryView> = {};
      if (raw && Array.isArray(raw.sources)) {
        patches.sources = raw.sources as string[];
      }
      if (!summary.repoRoot && raw && typeof raw.repoRoot === 'string') {
        patches.repoRoot = raw.repoRoot;
      }
      return Object.keys(patches).length > 0 ? { ...summary, ...patches } : summary;
    });
    return ok(summaries);
  }

  /** @inheritdoc */
  getSystemHealth(): Result<SystemHealthView> {
    const subsystems = this.sources.getSubsystemHealth();
    const worstStatus = subsystems.reduce<HealthStatus>((worst, s) => {
      const order: Record<HealthStatus, number> = {
        healthy: 0,
        degraded: 1,
        unhealthy: 2,
        unknown: 3,
      };
      return order[s.status] > order[worst] ? s.status : worst;
    }, 'healthy');

    return ok({
      timestamp: this.sources.clock(),
      overallStatus: subsystems.length === 0 ? 'healthy' : worstStatus,
      subsystems: subsystems.map((s) => {
        const latestCheck = s.checks.length > 0 ? s.checks[s.checks.length - 1] : undefined;
        const rawVersion = latestCheck?.details['version'];
        const version =
          typeof rawVersion === 'string' || typeof rawVersion === 'number'
            ? String(rawVersion)
            : undefined;
        return {
          name: s.subsystem,
          status: s.status,
          lastCheckedAt: s.lastCheckedAt,
          consecutiveFailures: s.consecutiveFailures,
          message: latestCheck?.message ?? 'No checks yet',
          version,
        };
      }),
    });
  }

  /** @inheritdoc */
  getSessionsView(runId: string): Result<readonly DashboardSessionView[]> {
    if (!this.sources.getSessionSnapshots) {
      return ok([]);
    }

    try {
      const snapshots = this.sources.getSessionSnapshots(runId);
      return ok(
        snapshots.map((snap): DashboardSessionView => {
          const pending = snap.pendingRequests.at(0);
          return {
            sessionId: snap.ref.sessionId,
            runId: snap.ref.runId,
            role: snap.ref.role,
            stateId: snap.ref.stateId,
            transport: snap.ref.transport,
            state: snap.state,
            pendingRequestKind: pending?.kind,
            pendingRequestId: pending?.requestId,
            createdAt: snap.createdAt,
            updatedAt: snap.updatedAt,
            expiresAt: snap.expiresAt,
            error: snap.error,
          };
        }),
      );
    } catch (e: unknown) {
      return err(
        new DashboardDataError(
          'sessions',
          `Failed to load sessions: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  private computeVerdicts(
    runId: string,
    artifacts: readonly ArtifactSummary[],
  ): Map<string, ApprovalStatus> {
    const verdicts = new Map<string, ApprovalStatus>();
    for (const a of artifacts) {
      if (!VERDICT_ARTIFACT_TYPES.has(a.type)) {
        continue;
      }
      const content = this.sources.getArtifactContentText(runId, a.type, a.name, a.version);
      if (!content) {
        continue;
      }
      const verdict = DefaultDashboardDataProvider.extractVerdict(content);
      if (verdict) {
        verdicts.set(`${a.type}/${a.name}@${String(a.version)}`, verdict);
      }
    }
    return verdicts;
  }

  private static extractVerdict(content: string): ApprovalStatus | undefined {
    const result = safeJsonParse(content, z.record(z.string(), z.unknown()));
    if (!result.success) {
      return undefined;
    }
    const parsed = result.data;

    if (typeof parsed['approved'] === 'boolean') {
      return parsed['approved'] ? 'approved' : 'rejected';
    }
    if (typeof parsed['passed'] === 'boolean') {
      return parsed['passed'] ? 'approved' : 'rejected';
    }
    const status = parsed['approvalStatus'];
    if (status === 'approved' || status === 'conditionally_approved' || status === 'rejected') {
      return status;
    }
    if (parsed['verdict'] === 'approve') {
      return 'approved';
    }
    if (parsed['verdict'] === 'request_changes') {
      return 'rejected';
    }
    return undefined;
  }

  private enrichIterationsWithFindings(
    iterations: RunManifest['iterations'],
    findings: readonly FindingData[],
  ): RunManifest['iterations'] {
    if (findings.length === 0 || iterations.length === 0) {
      return iterations;
    }

    const { total, resolved } = deduplicateFindings(findings);

    return iterations.map((it) => {
      if (it.findingsTotal > 0) {
        return it;
      }
      return {
        ...it,
        findingsTotal: total,
        findingsResolved: resolved,
      };
    });
  }
}
