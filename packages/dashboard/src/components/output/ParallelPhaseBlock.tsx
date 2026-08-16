import type { ArtifactRef } from '@ai-orchestrator/schemas';
import { Bot } from 'lucide-react';
import React, { useMemo, useState } from 'react';

import type { DashboardAgentStreamEvent } from '../../hooks/use-agent-stream';
import type { DispatchArtifacts } from '../../lib/dispatch-artifacts';
import { resolveDispatchArtifacts } from '../../lib/dispatch-artifacts';
import { humanize } from '../../lib/humanize';
import { cn } from '../../lib/utils';

import { ArtifactsPopover } from './ArtifactsPopover';
import { ChatBubble } from './ChatBubble';
import type { RoleMeta } from './output-utils';
import { groupMessages, humanizeRole } from './output-utils';
import type { ParallelPhase, ParallelPhaseDispatch } from './parallel-phases';
import { PromptButton } from './PromptModal';

function StatusIcon({ status }: Readonly<{ status: ParallelPhaseDispatch['status'] }>) {
  if (status === 'working') {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-primary/60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
      </span>
    );
  }
  if (status === 'done') {
    return <span className="text-emerald-400">✓</span>;
  }
  return <span className="text-red-400">✗</span>;
}

function firstContentLine(lines: DashboardAgentStreamEvent[]): string | undefined {
  for (const l of lines) {
    const pm = l.protocolMessage;
    if (pm?.messageType === 'permission_resolved' || pm?.messageType === 'permission_request') {
      continue;
    }
    if (l.type === 'stderr') {
      continue;
    }
    const text = l.content.trim();
    if (text && !text.startsWith('Warning:')) {
      return text.length > 140 ? `${text.slice(0, 137)}…` : text;
    }
  }
  return undefined;
}

export function ParallelPhaseBlock({
  phase,
  runId,
  seenTimestamps,
  scrollContainer,
  roleMetaMap,
  dispatchPromptMap,
  dispatchDescriptionMap,
  dispatchArtifactMap,
  historicalArtifactMap,
  onViewArtifact,
  respondedRequestIds,
}: Readonly<{
  phase: ParallelPhase;
  runId: string;
  seenTimestamps: Set<string>;
  scrollContainer: React.RefObject<HTMLDivElement | null>;
  roleMetaMap: ReadonlyMap<string, RoleMeta>;
  dispatchPromptMap: ReadonlyMap<string, string>;
  dispatchDescriptionMap: ReadonlyMap<string, string>;
  dispatchArtifactMap: ReadonlyMap<string, DispatchArtifacts>;
  historicalArtifactMap: ReadonlyMap<string, DispatchArtifacts>;
  onViewArtifact?: (ref: ArtifactRef) => void;
  respondedRequestIds?: ReadonlyMap<string, 'granted' | 'denied'>;
}>) {
  const [expanded, setExpanded] = useState(false);
  const [filterDispatch, setFilterDispatch] = useState<string | null>(null);

  const dispatches = [...phase.dispatches.values()];
  const completedCount = dispatches.filter((d) => d.status !== 'working').length;
  const totalCount = dispatches.length;
  const uniqueRoles = new Set(dispatches.map((d) => d.roleId));
  const isSameRole = uniqueRoles.size === 1;

  const expandedLines = useMemo(() => {
    let lines: DashboardAgentStreamEvent[] = [];
    for (const d of dispatches) {
      if (!filterDispatch || d.dispatchId === filterDispatch) {
        lines = lines.concat(d.lines);
      }
    }
    lines.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return lines;
  }, [dispatches, filterDispatch]);

  const expandedGroups = useMemo(() => groupMessages(expandedLines), [expandedLines]);

  const showAllSummary = expanded && filterDispatch === null;

  return (
    <div className="mb-3">
      <button
        type="button"
        className="mb-1 flex w-full cursor-pointer items-center justify-between text-2xs font-medium text-blue-400"
        onClick={() => {
          setExpanded((v) => !v);
          if (expanded) {
            setFilterDispatch(null);
          }
        }}
      >
        <span className="flex items-center gap-1.5">
          <Bot className="size-3.5 shrink-0" />
          Parallel Agents{' '}
          <span className="font-normal text-muted-foreground">
            {humanize(phase.stateId)} · {String(completedCount)}/{String(totalCount)} complete
          </span>
        </span>
        <span
          className={cn(
            'text-[11px] text-muted-foreground/60 transition-transform duration-200',
            expanded && 'rotate-90',
          )}
        >
          ›
        </span>
      </button>

      <div className="rounded-lg border border-border/60 bg-card p-2.5 text-xs">
        {!expanded && (
          <div className="space-y-1">
            {dispatches.map((d, idx) => {
              const meta = roleMetaMap.get(d.roleId);
              const artifacts = resolveDispatchArtifacts(
                d.roleId,
                d.dispatchId,
                dispatchArtifactMap,
                historicalArtifactMap,
              );
              const prompt = dispatchPromptMap.get(d.dispatchId);
              const description = dispatchDescriptionMap.get(d.dispatchId);
              const label = isSameRole
                ? `${humanizeRole(d.roleId)} #${String(idx + 1)}`
                : humanizeRole(d.roleId);

              return (
                <div key={d.dispatchId} className="flex items-center gap-2 py-0.5">
                  <span className="w-4 text-center">
                    <StatusIcon status={d.status} />
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer text-left hover:text-foreground"
                    onClick={() => {
                      setExpanded(true);
                      setFilterDispatch(d.dispatchId);
                    }}
                  >
                    <span className="truncate text-foreground/80">{label}</span>
                    {description && (
                      <p className="truncate text-2xs text-muted-foreground/60">{description}</p>
                    )}
                  </button>
                  <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    {meta?.runner && <span>⚡ {humanizeRole(meta.runner)}</span>}
                    {meta?.model && <span>· {meta.model}</span>}
                    {artifacts && (
                      <>
                        <span>·</span>
                        <ArtifactsPopover artifacts={artifacts} onViewArtifact={onViewArtifact} />
                      </>
                    )}
                    {prompt && (
                      <>
                        <span>·</span>
                        <PromptButton prompt={prompt} />
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {expanded && (
          <div>
            <div className="mb-2 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => {
                  setFilterDispatch(null);
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded px-2 py-0.5 text-2xs',
                  filterDispatch === null
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'bg-muted text-muted-foreground hover:text-foreground/80',
                )}
              >
                All
              </button>
              {dispatches.map((d, idx) => (
                <button
                  key={d.dispatchId}
                  type="button"
                  onClick={() => {
                    setFilterDispatch(d.dispatchId);
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded px-2 py-0.5 text-2xs',
                    filterDispatch === d.dispatchId
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'bg-muted text-muted-foreground hover:text-foreground/80',
                  )}
                >
                  <StatusIcon status={d.status} />
                  {isSameRole
                    ? `${humanizeRole(d.roleId)} #${String(idx + 1)}`
                    : humanizeRole(d.roleId)}
                </button>
              ))}
            </div>

            {showAllSummary ? (
              <div className="space-y-1">
                {dispatches.map((d, idx) => {
                  const meta = roleMetaMap.get(d.roleId);
                  const preview = firstContentLine(d.lines);
                  const label = isSameRole
                    ? `${humanizeRole(d.roleId)} #${String(idx + 1)}`
                    : humanizeRole(d.roleId);
                  return (
                    <button
                      key={d.dispatchId}
                      type="button"
                      onClick={() => {
                        setFilterDispatch(d.dispatchId);
                      }}
                      className="flex w-full cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <span className="mt-0.5 w-4 shrink-0 text-center">
                        <StatusIcon status={d.status} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-2xs font-medium text-foreground/80">{label}</span>
                          {meta?.runner && (
                            <span className="text-2xs text-muted-foreground/60">
                              {humanizeRole(meta.runner)}
                            </span>
                          )}
                          {meta?.model && (
                            <span className="font-mono text-2xs text-muted-foreground/50">
                              {meta.model}
                            </span>
                          )}
                        </div>
                        {preview && (
                          <p className="mt-0.5 truncate text-2xs text-muted-foreground/70">
                            {preview}
                          </p>
                        )}
                      </div>
                      <span className="mt-0.5 text-[11px] text-muted-foreground/60">›</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {expandedGroups.map((mg, i) => (
                  <ChatBubble
                    key={`phase-group-${String(i)}`}
                    group={mg}
                    runId={runId}
                    seenTimestamps={seenTimestamps}
                    scrollContainer={scrollContainer}
                    roleMetaMap={roleMetaMap}
                    dispatchPromptMap={dispatchPromptMap}
                    dispatchArtifactMap={dispatchArtifactMap}
                    historicalArtifactMap={historicalArtifactMap}
                    onViewArtifact={onViewArtifact}
                    respondedRequestIds={respondedRequestIds}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
