import type {
  ArtifactInventoryView,
  RoleUsageView,
  RunConfigView,
  RunStateView,
  StateNode,
  UsageBreakdownView,
  WorkflowStateView,
} from '@ai-dev-orchestrator/schemas';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api/client';
import { shouldRefreshUsage } from '../lib/refresh-triggers';

import type { DispatchGroup } from './use-agent-stream';
import { useAgentStream } from './use-agent-stream';
import { useCompletionNotifications } from './use-completion-notifications';
import type { SseStatus } from './use-event-stream';
import { useEventStream } from './use-event-stream';
import { usePermissionNotifications } from './use-permission-notifications';

function extractLiveUsageFromStream(
  groups: ReadonlyMap<string, DispatchGroup>,
): Map<string, { inputTokens: number; outputTokens: number }> {
  const byRole = new Map<string, { inputTokens: number; outputTokens: number }>();
  for (const group of groups.values()) {
    let latestInput = 0;
    let latestOutput = 0;
    let found = false;
    for (const line of group.lines) {
      if (line.structuredData?.phase === 'usage_update') {
        latestInput = Number(line.structuredData.inputTokens) || 0;
        latestOutput = Number(line.structuredData.outputTokens) || 0;
        found = true;
      }
    }
    if (found) {
      const existing = byRole.get(group.roleId);
      byRole.set(group.roleId, {
        inputTokens: (existing?.inputTokens ?? 0) + latestInput,
        outputTokens: (existing?.outputTokens ?? 0) + latestOutput,
      });
    }
  }
  return byRole;
}

function mergeUsageWithLiveStream(
  serverUsage: UsageBreakdownView | null,
  liveByRole: Map<string, { inputTokens: number; outputTokens: number }>,
  runId: string,
): UsageBreakdownView | null {
  if (liveByRole.size === 0) {
    return serverUsage;
  }

  const baseRoles = serverUsage?.byRole ?? [];
  const roleMap = new Map<string, RoleUsageView>(baseRoles.map((r) => [r.role, { ...r }]));

  for (const [role, live] of liveByRole) {
    const existing = roleMap.get(role);
    if (existing) {
      const mergedInput = Math.max(existing.inputTokens, live.inputTokens);
      const mergedOutput = Math.max(existing.outputTokens, live.outputTokens);
      roleMap.set(role, { ...existing, inputTokens: mergedInput, outputTokens: mergedOutput });
    } else {
      roleMap.set(role, {
        role,
        inputTokens: live.inputTokens,
        outputTokens: live.outputTokens,
        dispatches: 0,
        totalDurationMs: 0,
      });
    }
  }

  const mergedRoles = [...roleMap.values()];
  const totalInput = mergedRoles.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutput = mergedRoles.reduce((s, r) => s + r.outputTokens, 0);

  return {
    runId: serverUsage?.runId ?? runId,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalTokens: totalInput + totalOutput,
    byRole: mergedRoles,
    budgetSummary: serverUsage?.budgetSummary,
  };
}

function extractLiveRoleDurations(groups: ReadonlyMap<string, DispatchGroup>): Map<string, number> {
  const durations = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.lines.length === 0) {
      continue;
    }
    const firstTs = new Date(group.lines[0].timestamp).getTime();
    for (const line of group.lines) {
      const isDone =
        line.protocolMessage?.messageType === 'done' || line.structuredData?.phase === 'done';
      if (isDone) {
        const doneTs = new Date(line.timestamp).getTime();
        const ms = Math.max(0, doneTs - firstTs);
        durations.set(group.roleId, ms);
        break;
      }
    }
  }
  return durations;
}

function enrichWorkflowWithLiveDurations(
  workflow: WorkflowStateView,
  liveDurations: ReadonlyMap<string, number>,
): WorkflowStateView {
  if (liveDurations.size === 0) {
    return workflow;
  }
  const states: StateNode[] = workflow.states.map((s) => {
    if (!s.parallelInfo?.parallelRoles || s.parallelInfo.parallelRoles.length === 0) {
      return s;
    }
    const existing = s.parallelInfo.roleDurations ?? {};
    const merged = { ...existing };
    let changed = false;
    for (const role of s.parallelInfo.parallelRoles) {
      if (!merged[role]) {
        const live = liveDurations.get(role);
        if (live != null) {
          merged[role] = live;
          changed = true;
        }
      }
    }
    if (!changed) {
      return s;
    }
    return { ...s, parallelInfo: { ...s.parallelInfo, roleDurations: merged } };
  });
  return { ...workflow, states };
}

export interface UseRunDetailResult {
  runState: RunStateView | null;
  workflow: WorkflowStateView | null;
  artifacts: ArtifactInventoryView | null;
  configData: RunConfigView | null;
  loading: boolean;
  error: string | null;
  isRunActive: boolean;
  liveUsage: UsageBreakdownView | null;
  enrichedWorkflow: WorkflowStateView | null;
  agentGroups: Map<string, DispatchGroup>;
  agentStreamStatus: SseStatus;
  refreshRunData: () => void;
}

export function useRunDetail(runId: string | undefined): UseRunDetailResult {
  const [runState, setRunState] = useState<RunStateView | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowStateView | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactInventoryView | null>(null);
  const [usage, setUsage] = useState<UsageBreakdownView | null>(null);
  const [configData, setConfigData] = useState<RunConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { events: liveEvents } = useEventStream(runId);
  const { groups: agentGroups, status: agentStreamStatus } = useAgentStream(runId, Boolean(runId));
  const lastProcessedLiveEventRef = useRef<string | null>(null);

  usePermissionNotifications(agentGroups);
  useCompletionNotifications(liveEvents);

  const isRunActive = runState?.status === 'running' || runState?.status === 'waiting';
  const shouldWarmLiveDetails = !error && (!runState || !workflow);
  const shouldAutoRefresh = isRunActive || shouldWarmLiveDetails;

  const liveUsage = useMemo(
    () => mergeUsageWithLiveStream(usage, extractLiveUsageFromStream(agentGroups), runId ?? ''),
    [usage, agentGroups, runId],
  );

  const enrichedWorkflow = useMemo(() => {
    if (!workflow) {
      return null;
    }
    const liveDurations = extractLiveRoleDurations(agentGroups);
    return enrichWorkflowWithLiveDurations(workflow, liveDurations);
  }, [workflow, agentGroups]);

  const refreshRunData = useCallback(() => {
    if (!runId) {
      return;
    }
    api
      .fetchRunState(runId)
      .then((s) => {
        setRunState(s);
      })
      .catch(() => undefined);
    api
      .fetchWorkflow(runId)
      .then((w) => {
        setWorkflow(w);
      })
      .catch(() => undefined);
    api
      .fetchArtifacts(runId)
      .then((v) => {
        setArtifacts(v);
      })
      .catch(() => undefined);
    api
      .fetchUsage(runId)
      .then((v) => {
        setUsage(v);
      })
      .catch(() => undefined);
  }, [runId]);

  const prevActiveRef = useRef(isRunActive);
  useEffect(() => {
    prevActiveRef.current = isRunActive;
  }, [isRunActive]);

  useEffect(() => {
    if (!runId) {
      return;
    }
    let cancelled = false;

    setLoading(true);
    setError(null);

    const runStatePromise: Promise<RunStateView | null> = api
      .fetchRunState(runId)
      .catch(() => null);
    const workflowPromise: Promise<WorkflowStateView | null> = api
      .fetchWorkflow(runId)
      .catch(() => null);
    const artifactsPromise: Promise<ArtifactInventoryView | null> = api
      .fetchArtifacts(runId)
      .catch(() => null);
    const usagePromise: Promise<UsageBreakdownView | null> = api
      .fetchUsage(runId)
      .catch(() => null);
    const configPromise: Promise<RunConfigView | null> = api.fetchConfig(runId).catch(() => null);

    Promise.all([runStatePromise, workflowPromise, artifactsPromise, usagePromise, configPromise])
      .then(([st, wf, art, usg, cfg]) => {
        if (cancelled) {
          return;
        }
        setRunState((prev) => st ?? prev);
        setWorkflow((prev) => wf ?? prev);
        setArtifacts((prev) => art ?? prev);
        setUsage((prev) => usg ?? prev);
        setConfigData((prev) => cfg ?? prev);

        if (!st && !wf && !art) {
          setError('No data found for this run');
        }
      })
      .catch((e: unknown) => {
        if (cancelled) {
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!runId || !shouldAutoRefresh) {
      return;
    }
    let cancelled = false;

    const doRefresh = () => {
      if (cancelled) {
        return;
      }
      Promise.all([
        api.fetchRunState(runId).catch(() => null),
        api.fetchWorkflow(runId).catch(() => null),
        api.fetchArtifacts(runId).catch(() => null),
        api.fetchUsage(runId).catch(() => null),
      ])
        .then(([st, wf, art, usg]) => {
          if (cancelled) {
            return;
          }
          if (st) {
            setRunState(st);
          }
          if (wf) {
            setWorkflow(wf);
          }
          if (art) {
            setArtifacts(art);
          }
          if (usg) {
            setUsage(usg);
          }
        })
        .catch(() => undefined);
    };

    doRefresh();
    let timer = setInterval(doRefresh, 3_000);

    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(timer);
      } else {
        doRefresh();
        timer = setInterval(doRefresh, 3_000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [runId, shouldAutoRefresh]);

  useEffect(() => {
    if (!runId || liveEvents.length === 0) {
      return;
    }

    const latest = liveEvents[0];
    const eventKey = `${latest.timestamp}:${latest.type}:${latest.runId ?? ''}:${JSON.stringify(latest.data ?? {})}`;
    if (lastProcessedLiveEventRef.current === eventKey) {
      return;
    }
    lastProcessedLiveEventRef.current = eventKey;

    let cancelled = false;

    if (latest.type === 'state_changed') {
      api
        .fetchRunState(runId)
        .then((s) => {
          if (!cancelled) {
            setRunState(s);
          }
        })
        .catch(() => undefined);
      api
        .fetchWorkflow(runId)
        .then((w) => {
          if (!cancelled) {
            setWorkflow(w);
          }
        })
        .catch(() => undefined);
      api
        .fetchArtifacts(runId)
        .then((v) => {
          if (!cancelled) {
            setArtifacts(v);
          }
        })
        .catch(() => undefined);
      api
        .fetchUsage(runId)
        .then((v) => {
          if (!cancelled) {
            setUsage(v);
          }
        })
        .catch(() => undefined);
    }
    if (shouldRefreshUsage(latest.type)) {
      api
        .fetchUsage(runId)
        .then((v) => {
          if (!cancelled) {
            setUsage(v);
          }
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [liveEvents, runId]);

  return {
    runState,
    workflow,
    artifacts,
    configData,
    loading,
    error,
    isRunActive,
    liveUsage,
    enrichedWorkflow,
    agentGroups,
    agentStreamStatus,
    refreshRunData,
  };
}
