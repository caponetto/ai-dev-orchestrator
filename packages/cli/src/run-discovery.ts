import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { safeJsonParse } from '@ai-orchestrator/artifacts';
import { DefaultStatePersistence } from '@ai-orchestrator/core';
import { DefaultJournalReader } from '@ai-orchestrator/journal';
import { DefaultManifestQuery } from '@ai-orchestrator/run-manifest';
import { agentStreamEventSchema } from '@ai-orchestrator/runner';
import {
  RUN_LOCK_FILENAME,
  WORKFLOW_DEFINITION_FILENAME,
  type PersistedState,
  type RunManifest,
} from '@ai-orchestrator/schemas';
import { parse } from 'yaml';

import { getConfigSnapshotPath, getJournalPath, getRunsDir } from './workspace-paths';

interface RunLockData {
  readonly runId: string;
  readonly pid: number;
  readonly acquiredAt: string;
  readonly lockPath: string;
  readonly hostname: string;
}

export function discoverRunManifest(runId: string): RunManifest | null {
  const runsDir = getRunsDir();
  const manifestQuery = new DefaultManifestQuery(runsDir);
  const statePersistence = new DefaultStatePersistence(runsDir);
  const manifest = manifestQuery.get(runId);
  if (manifest) {
    const reconciled = reconcileManifestWithState(manifest, statePersistence) ?? manifest;
    return reconcileTokenUsageFromStream(reconciled, join(runsDir, runId));
  }

  const liveManifest = buildLiveRunManifest(runsDir, runId, statePersistence);
  return liveManifest ? reconcileTokenUsageFromStream(liveManifest, join(runsDir, runId)) : null;
}

export function discoverRunManifests(): RunManifest[] {
  const runsDir = getRunsDir();
  if (!existsSync(runsDir)) {
    return [];
  }

  const manifestQuery = new DefaultManifestQuery(runsDir);
  const manifestsById = new Map(manifestQuery.list().map((manifest) => [manifest.runId, manifest]));
  const statePersistence = new DefaultStatePersistence(runsDir);
  const entries = readdirSync(runsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (manifestsById.has(entry.name)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by has() check above
      const manifest = manifestsById.get(entry.name)!;
      const reconciled = reconcileManifestWithState(manifest, statePersistence) ?? manifest;
      manifestsById.set(
        entry.name,
        reconcileTokenUsageFromStream(reconciled, join(runsDir, entry.name)),
      );
      continue;
    }

    const liveManifest = buildLiveRunManifest(runsDir, entry.name, statePersistence);
    if (liveManifest) {
      manifestsById.set(
        entry.name,
        reconcileTokenUsageFromStream(liveManifest, join(runsDir, entry.name)),
      );
    }
  }

  return [...manifestsById.values()];
}

function reconcileManifestWithState(
  manifest: RunManifest,
  statePersistence: DefaultStatePersistence,
): RunManifest | null {
  const state = readPersistedState(statePersistence, manifest.runId);
  if (!state) {
    return null;
  }
  const liveStatus = deriveLiveRunStatus(state);
  if (liveStatus === manifest.status) {
    return null;
  }
  return { ...manifest, status: liveStatus, finalState: state.currentState };
}

/**
 * When a worker fails after streaming usage, persisted metrics can stay at 0.
 * Prefer the higher of persisted vs agent-stream usage_update totals so list/detail match.
 */
function reconcileTokenUsageFromStream(manifest: RunManifest, runDir: string): RunManifest {
  const streamByRole = readStreamUsageByRole(join(runDir, 'agent-stream.jsonl'));
  if (streamByRole.size === 0) {
    return manifest;
  }

  const byRole = new Map<string, { input: number; output: number }>(
    Object.entries(manifest.tokenUsage.byRole).map(([role, usage]) => [
      role,
      { input: usage.input, output: usage.output },
    ]),
  );

  for (const [role, streamUsage] of streamByRole) {
    const existing = byRole.get(role);
    byRole.set(role, {
      input: Math.max(existing?.input ?? 0, streamUsage.input),
      output: Math.max(existing?.output ?? 0, streamUsage.output),
    });
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const usage of byRole.values()) {
    totalInputTokens += usage.input;
    totalOutputTokens += usage.output;
  }
  const totalTokens = totalInputTokens + totalOutputTokens;
  if (totalTokens <= manifest.tokenUsage.totalTokens) {
    return manifest;
  }

  const activeRoles = manifest.activeRoles.map((roleUsage) => {
    const reconciled = byRole.get(roleUsage.role);
    if (!reconciled) {
      return roleUsage;
    }
    if (
      reconciled.input === roleUsage.inputTokens &&
      reconciled.output === roleUsage.outputTokens
    ) {
      return roleUsage;
    }
    return {
      ...roleUsage,
      inputTokens: reconciled.input,
      outputTokens: reconciled.output,
    };
  });

  for (const [role, usage] of byRole) {
    if (activeRoles.some((r) => r.role === role)) {
      continue;
    }
    activeRoles.push({
      role,
      dispatches: 1,
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalDurationMs: 0,
      artifactsProduced: 0,
    });
  }

  return {
    ...manifest,
    activeRoles,
    tokenUsage: {
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      byRole: Object.fromEntries(byRole),
    },
  };
}

function readStreamUsageByRole(streamPath: string): Map<string, { input: number; output: number }> {
  if (!existsSync(streamPath)) {
    return new Map();
  }

  let content: string;
  try {
    content = readFileSync(streamPath, 'utf8');
  } catch {
    return new Map();
  }

  const latestByDispatch = new Map<string, { role: string; input: number; output: number }>();
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = safeJsonParse(line, agentStreamEventSchema);
      if (!parsed.success) {
        continue;
      }
      const event = parsed.data;
      if (event.structuredData?.phase !== 'usage_update' || !event.roleId || !event.dispatchId) {
        continue;
      }
      latestByDispatch.set(`${event.roleId}\0${event.dispatchId}`, {
        role: event.roleId,
        input:
          typeof event.structuredData.inputTokens === 'number'
            ? event.structuredData.inputTokens
            : 0,
        output:
          typeof event.structuredData.outputTokens === 'number'
            ? event.structuredData.outputTokens
            : 0,
      });
    } catch {
      // Skip malformed stream lines.
    }
  }

  const byRole = new Map<string, { input: number; output: number }>();
  for (const entry of latestByDispatch.values()) {
    const existing = byRole.get(entry.role);
    byRole.set(entry.role, {
      input: (existing?.input ?? 0) + entry.input,
      output: (existing?.output ?? 0) + entry.output,
    });
  }
  return byRole;
}

function readRepoRootFromConfig(runDir: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(getConfigSnapshotPath(runDir), 'utf8')) as {
      repoRoot?: string;
    };
    return typeof raw.repoRoot === 'string' ? raw.repoRoot : undefined;
  } catch {
    return undefined;
  }
}

function buildLiveRunManifest(
  runsDir: string,
  runId: string,
  statePersistence: DefaultStatePersistence,
): RunManifest | null {
  const runDir = join(runsDir, runId);
  const lockPath = join(runDir, RUN_LOCK_FILENAME);
  if (!existsSync(lockPath)) {
    return null;
  }

  const lock = readRunLock(lockPath);
  if (!lock) {
    return null;
  }

  const state = readPersistedState(statePersistence, runId);
  const startedAt = readStartedAt(runDir, lock.acquiredAt);
  const now = new Date().toISOString();
  const workerMetrics = state?.workerMetricsByRole ?? {};
  const totalInputTokens = state?.cumulativeInputTokens ?? 0;
  const totalOutputTokens = state?.cumulativeOutputTokens ?? 0;
  const totalTokens = totalInputTokens + totalOutputTokens;
  const workflowDef = readWorkflowDefinition(runDir);
  const repoRoot = state?.repoRoot ?? readRepoRootFromConfig(runDir);
  return {
    runId,
    version: '1.0.0',
    repository: '',
    repoRoot,
    workflow: {
      name: state?.workflowName ?? workflowDef?.name ?? 'dev',
      version: state?.workflowVersion ?? workflowDef?.version ?? '1.0',
    },
    timing: {
      startedAt,
      completedAt: TERMINAL_STATUS[state?.currentState ?? ''] ? (state?.persistedAt ?? now) : '',
      totalDurationMs: durationSince(
        startedAt,
        TERMINAL_STATUS[state?.currentState ?? ''] ? (state?.persistedAt ?? now) : now,
      ),
      stateTimings: [],
    },
    status: deriveLiveRunStatus(state),
    finalState: state?.currentState ?? 'INTAKE',
    activeRoles: Object.entries(workerMetrics).map(([role, metrics]) => ({
      role,
      dispatches: metrics.dispatches,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      totalDurationMs: metrics.durationMs,
      artifactsProduced: metrics.artifactsProduced,
    })),
    artifactInventory: [],
    totalArtifacts: state?.activeArtifacts.length ?? 0,
    totalArtifactSizeBytes: 0,
    iterations: [],
    governanceDecisions: state?.governanceDecisionCount ?? 0,
    escalations: state?.escalationCount ?? 0,
    humanInterventions: state?.waitingContext ? 1 : 0,
    agreements: [],
    tokenUsage: {
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      byRole: Object.fromEntries(
        Object.entries(workerMetrics).map(([role, metrics]) => [
          role,
          { input: metrics.inputTokens, output: metrics.outputTokens },
        ]),
      ),
    },
  };
}

const TERMINAL_STATUS: Readonly<Record<string, string>> = {
  DONE: 'completed',
  ABORTED: 'aborted',
  FAILED: 'failed',
};

function readWorkflowDefinition(runDir: string): { name: string; version: string } | null {
  try {
    const defPath = join(runDir, WORKFLOW_DEFINITION_FILENAME);
    const raw = JSON.parse(readFileSync(defPath, 'utf8')) as { name?: string; version?: string };
    if (raw.name) {
      return { name: raw.name, version: raw.version ?? '1.0' };
    }
    return null;
  } catch {
    return null;
  }
}

function deriveLiveRunStatus(state: PersistedState | null): string {
  const currentState = state?.currentState ?? '';
  const terminalStatus = TERMINAL_STATUS[currentState] as string | undefined;
  if (terminalStatus) {
    return terminalStatus;
  }
  return state?.waitingContext ? 'waiting' : 'running';
}

function readRunLock(lockPath: string): RunLockData | null {
  try {
    return parse(readFileSync(lockPath, 'utf8')) as RunLockData;
  } catch {
    return null;
  }
}

function readStartedAt(runDir: string, fallback: string): string {
  const reader = new DefaultJournalReader(getJournalPath(runDir));
  const startedEvent = reader.readAll().find((event) => event.type === 'run_started');
  return startedEvent?.timestamp ?? fallback;
}

function readPersistedState(
  statePersistence: DefaultStatePersistence,
  runId: string,
): PersistedState | null {
  try {
    return statePersistence.load(runId as Parameters<typeof statePersistence.load>[0]);
  } catch {
    return null;
  }
}

function durationSince(startedAt: string, now: string): number {
  const startedAtMs = new Date(startedAt).getTime();
  const nowMs = new Date(now).getTime();
  if (Number.isNaN(startedAtMs) || Number.isNaN(nowMs)) {
    return 0;
  }
  return Math.max(0, nowMs - startedAtMs);
}
