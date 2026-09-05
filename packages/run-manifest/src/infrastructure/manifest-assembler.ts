import type {
  ArtifactRef,
  ManifestArtifactSummary,
  ManifestContext,
  ManifestContextConfig,
  ManifestTiming,
  ManifestTokenUsage,
  RoleUsage,
  RunManifest,
  StateTiming,
  StateVisit,
} from '@ai-dev-orchestrator/schemas';

/** Safely parse an ISO date string to epoch ms; returns NaN on failure. */
function parseMs(iso: string): number {
  return new Date(iso).getTime();
}

// ---------------------------------------------------------------------------
// Timing extraction
// ---------------------------------------------------------------------------

function extractTiming(config: ManifestContextConfig): ManifestTiming {
  const { stateTimestamps, startedAt, completedAt } = config;

  if (stateTimestamps.length > 0) {
    const stateTimings = buildStateTimings(stateTimestamps);
    const first = stateTimestamps[0].enteredAt;
    const last = stateTimestamps[stateTimestamps.length - 1].exitedAt;
    const startMs = parseMs(first);
    const endMs = parseMs(last);
    const totalDurationMs =
      Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;

    const stateTrace = buildStateTrace(stateTimestamps);
    return { startedAt: first, completedAt: last, totalDurationMs, stateTimings, stateTrace };
  }

  const startMs = parseMs(startedAt);
  const endMs = parseMs(completedAt);
  const totalDurationMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;

  return { startedAt, completedAt, totalDurationMs, stateTimings: [] };
}

type StateTimestampEntry = ManifestContextConfig['stateTimestamps'][number];

/** Build per-state timing entries, aggregating visits for the same stateId. */
function buildStateTimings(entries: readonly StateTimestampEntry[]): StateTiming[] {
  const map = new Map<
    string,
    { stateId: string; enteredAt: string; exitedAt: string; durationMs: number; visits: number }
  >();

  for (const e of entries) {
    const startMs = parseMs(e.enteredAt);
    const endMs = parseMs(e.exitedAt);
    const dur =
      Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;

    const existing = map.get(e.stateId);
    if (existing) {
      existing.durationMs += dur;
      existing.visits += 1;
      existing.exitedAt = e.exitedAt; // keep latest exit
    } else {
      map.set(e.stateId, {
        stateId: e.stateId,
        enteredAt: e.enteredAt,
        exitedAt: e.exitedAt,
        durationMs: dur,
        visits: 1,
      });
    }
  }

  return [...map.values()];
}

/** Build an ordered per-visit trace, preserving chronological order. */
function buildStateTrace(entries: readonly StateTimestampEntry[]): StateVisit[] {
  return entries.map((e) => {
    const startMs = parseMs(e.enteredAt);
    const endMs = parseMs(e.exitedAt);
    const durationMs =
      Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
    return {
      stateId: e.stateId,
      enteredAt: e.enteredAt,
      exitedAt: e.exitedAt,
      durationMs,
    };
  });
}

// ---------------------------------------------------------------------------
// Token usage & role extraction
// ---------------------------------------------------------------------------

interface ExtractedRoleData {
  tokenUsage: ManifestTokenUsage;
  activeRoles: RoleUsage[];
}

function extractRoleData(workerMetrics: ManifestContext['workerMetrics']): ExtractedRoleData {
  let totalInput = 0;
  let totalOutput = 0;
  const byRole: Record<string, { readonly input: number; readonly output: number }> = {};
  const activeRoles: RoleUsage[] = [];

  for (const [role, value] of Object.entries(workerMetrics)) {
    totalInput += value.inputTokens;
    totalOutput += value.outputTokens;
    byRole[role] = { input: value.inputTokens, output: value.outputTokens };

    activeRoles.push({
      role,
      dispatches: value.dispatches,
      inputTokens: value.inputTokens,
      outputTokens: value.outputTokens,
      totalDurationMs: value.durationMs,
      artifactsProduced: value.artifactsProduced,
    });
  }

  return {
    tokenUsage: {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      byRole,
    },
    activeRoles,
  };
}

// ---------------------------------------------------------------------------
// Artifact inventory extraction
// ---------------------------------------------------------------------------

function buildArtifactInventory(
  artifacts: readonly ArtifactRef[],
  workerMetrics: ManifestContext['workerMetrics'],
): ManifestArtifactSummary[] {
  const roleForType = new Map<string, string>();
  for (const [role, value] of Object.entries(workerMetrics)) {
    if (value.artifactsProduced > 0) {
      roleForType.set(role, role);
    }
  }

  return artifacts.map((ref) => ({
    ref,
    producedBy: roleForType.get(ref.type) ?? 'unknown',
    createdAt: new Date().toISOString(),
    sizeBytes: 0,
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Assembles a RunManifest from a ManifestContext. */
export function assembleManifest(context: ManifestContext): RunManifest {
  const stateHistory = context.stateHistory;
  const finalState = stateHistory.length > 0 ? stateHistory[stateHistory.length - 1] : 'UNKNOWN';
  const status =
    finalState === 'DONE'
      ? 'completed'
      : finalState === 'ABORTED'
        ? 'aborted'
        : finalState === 'FAILED'
          ? 'failed'
          : 'interrupted';

  const timing = extractTiming(context.config);
  const { tokenUsage, activeRoles } = extractRoleData(context.workerMetrics);

  const artifactInventory =
    context.artifactSummaries && context.artifactSummaries.length > 0
      ? [...context.artifactSummaries]
      : buildArtifactInventory(context.artifactInventory, context.workerMetrics);
  const totalArtifactSizeBytes = artifactInventory.reduce((sum, a) => sum + a.sizeBytes, 0);

  return {
    runId: context.runId,
    version: '1.0.0',
    repository: '',
    repoRoot: context.config.repoRoot,
    workflow: {
      name: context.workflowName ?? 'unknown',
      version: context.workflowVersion ?? '1.0.0',
    },
    timing,
    status,
    finalState,
    activeRoles,
    artifactInventory,
    totalArtifacts: context.artifactInventory.length,
    totalArtifactSizeBytes,
    iterations: [...context.config.iterations],
    governanceDecisions: context.config.governanceDecisions,
    escalations: context.config.escalations,
    humanInterventions: 0,
    agreements: [],
    tokenUsage,
    reportPath: context.reportPath,
  };
}
