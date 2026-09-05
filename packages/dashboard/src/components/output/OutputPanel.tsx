import type {
  ArtifactEntryView,
  ArtifactRef,
  DashboardWaitingContext,
} from '@ai-dev-orchestrator/schemas';
import { ArrowUp, User2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DispatchGroup } from '../../hooks/use-agent-stream';
import type { SseStatus } from '../../hooks/use-event-stream';
import type { DispatchArtifacts } from '../../lib/dispatch-artifacts';
import {
  buildDispatchArtifactMap,
  buildHistoricalDispatchArtifactMap,
} from '../../lib/dispatch-artifacts';
import { linkify } from '../../lib/linkify';
import { cn } from '../../lib/utils';
import { ActionBar } from '../ActionBar';

import { AbortMessage, type AbortVariant } from './AbortMessage';
import { ChatBubble } from './ChatBubble';
import { CollapsedPermissions } from './CollapsedPermissions';
import { Timestamp } from './line-renderers';
import type { MessageGroup, RoleMeta } from './output-utils';
import {
  buildDispatchDescriptionMap,
  buildDispatchPromptMap,
  buildRoleMetaMap,
  groupMessages,
  humanizeRole,
  isStderrWarning,
  isToolCallNoise,
  mergeAllLines,
  senderBorderColor,
  senderLabelColor,
} from './output-utils';
import type { ParallelPhase } from './parallel-phases';
import { detectParallelPhases } from './parallel-phases';
import { ParallelPhaseBlock } from './ParallelPhaseBlock';
import { ScriptOutputBlock } from './ScriptOutputBlock';
import { TypingIndicator } from './TypingIndicator';

function resolveAbortPresentation(
  runStatus: string | undefined,
  humanAbort: { reason: string; timestamp?: string } | null,
  systemFailureReason: string | null,
): { variant: AbortVariant; reason: string; timestamp?: string } | null {
  if (runStatus !== 'aborted' && runStatus !== 'interrupted') {
    return null;
  }

  if (runStatus === 'interrupted') {
    return {
      variant: 'interrupted',
      reason: humanAbort?.reason ?? 'Process terminated before completion',
      timestamp: humanAbort?.timestamp,
    };
  }

  // Human abort publishes a stream event with action: 'aborted'.
  if (humanAbort) {
    return {
      variant: 'aborted',
      reason: humanAbort.reason,
      timestamp: humanAbort.timestamp,
    };
  }

  // Workflow failure (script/agent/guard) lands in ABORTED without a human abort event.
  return {
    variant: 'failed',
    reason: systemFailureReason ?? 'A workflow step failed',
  };
}

function buildDispatchLabelMap(
  parallelPhases: ReadonlyMap<string, ParallelPhase>,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const phase of parallelPhases.values()) {
    const dispatches = [...phase.dispatches.values()];
    const uniqueRoles = new Set(dispatches.map((d) => d.roleId));
    const isSameRole = uniqueRoles.size === 1 && dispatches.length > 1;
    for (let i = 0; i < dispatches.length; i++) {
      const d = dispatches[i];
      const label = isSameRole
        ? `${humanizeRole(d.roleId)} #${String(i + 1)}`
        : humanizeRole(d.roleId);
      map.set(d.dispatchId, label);
    }
  }
  return map;
}

export interface AgentOutputPanelProps {
  readonly groups: Map<string, DispatchGroup>;
  readonly status: SseStatus;
  readonly runId?: string;
  readonly isRunActive?: boolean;
  readonly runStatus?: string;
  readonly currentState?: string;
  readonly waitingContext?: DashboardWaitingContext;
  readonly onAction?: () => void;
  readonly onViewArtifact?: (ref: ArtifactRef) => void;
  readonly onViewScript?: (name: string) => void;
  readonly sources?: readonly string[];
  readonly artifacts?: readonly ArtifactEntryView[];
}

export function AgentOutputPanel({
  groups,
  status,
  runId,
  isRunActive,
  runStatus,
  currentState,
  waitingContext,
  onAction,
  onViewArtifact,
  onViewScript,
  sources,
  artifacts,
}: AgentOutputPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [actionTakenKey, setActionTakenKey] = useState<string | null>(null);

  const waitingKey = waitingContext
    ? `${waitingContext.requestingState}:${waitingContext.waitingSince}`
    : null;

  const allLines = useMemo(() => mergeAllLines(groups), [groups]);
  const roleMetaMap = useMemo(() => buildRoleMetaMap(allLines), [allLines]);
  const dispatchPromptMap = useMemo(() => buildDispatchPromptMap(allLines), [allLines]);
  const dispatchDescriptionMap = useMemo(() => buildDispatchDescriptionMap(allLines), [allLines]);
  const dispatchArtifactMap = useMemo(() => buildDispatchArtifactMap(allLines), [allLines]);
  const historicalArtifactMap = useMemo(
    () => buildHistoricalDispatchArtifactMap(allLines, artifacts ?? []),
    [allLines, artifacts],
  );

  const abortInfo = useMemo(() => {
    for (const group of groups.values()) {
      for (const line of group.lines) {
        const sd = line.structuredData;
        if (sd?.action === 'aborted' && typeof sd.reason === 'string') {
          return { reason: sd.reason, timestamp: line.timestamp };
        }
      }
    }
    return null;
  }, [groups]);

  const systemFailureReason = useMemo(() => {
    let pendingStderr = '';
    let lastFailure: string | null = null;

    for (const group of groups.values()) {
      for (const line of group.lines) {
        const sd = line.structuredData;
        if (sd?.messageType === 'script_started') {
          pendingStderr = '';
        }
        if (line.roleId === 'script' && line.type === 'stderr' && line.content.trim()) {
          pendingStderr += (pendingStderr ? '\n' : '') + line.content.trim();
        }
        if (
          sd?.messageType === 'script_completed' &&
          typeof sd.script === 'string' &&
          typeof sd.exitCode === 'number' &&
          sd.exitCode !== 0
        ) {
          const header = `Script ${sd.script} failed (exit ${String(sd.exitCode)})`;
          lastFailure = pendingStderr ? `${header}\n${pendingStderr}` : header;
          pendingStderr = '';
        }
      }
    }

    return lastFailure;
  }, [groups]);

  const abortPresentation = useMemo(
    () => resolveAbortPresentation(runStatus, abortInfo, systemFailureReason),
    [runStatus, abortInfo, systemFailureReason],
  );

  const isNearBottom = useRef(true);
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      const threshold = 80;
      isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      setShowScrollTop(el.scrollTop > 300);
    }
  }, []);

  const initialScrollDone = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    if (!initialScrollDone.current && allLines.length > 0) {
      initialScrollDone.current = true;
      const tid = setTimeout(() => {
        el.scrollTop = el.scrollHeight;
      }, 100);
      return () => {
        clearTimeout(tid);
      };
    }
    if (isNearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [allLines.length, waitingContext]);

  const hasDebug = allLines.some(
    (l) => l.protocolMessage?.messageType === 'log' && l.protocolMessage.payload.level === 'debug',
  );
  const lastMessageType = allLines.at(-1)?.protocolMessage?.messageType;
  const isTerminal = lastMessageType === 'done' || lastMessageType === 'error' || !isRunActive;

  const visibleLines = allLines.filter((l) => {
    if (l.structuredData?.action === 'aborted') {
      return false;
    }
    if (
      !showDebug &&
      l.protocolMessage?.messageType === 'log' &&
      l.protocolMessage.payload.level === 'debug'
    ) {
      return false;
    }
    if (isToolCallNoise(l)) {
      return false;
    }
    if (isStderrWarning(l)) {
      return false;
    }
    return true;
  });

  const respondedRequestIds = useMemo(() => {
    const map = new Map<string, 'granted' | 'denied'>();
    for (const l of allLines) {
      if (l.protocolMessage?.messageType === 'permission_response' && l.requestMessageId) {
        const granted = l.protocolMessage.payload.granted === true;
        map.set(l.requestMessageId, granted ? 'granted' : 'denied');
      }
    }
    return map;
  }, [allLines]);

  const finishedDispatchIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of allLines) {
      if (!l.dispatchId) {
        continue;
      }
      const mt = l.protocolMessage?.messageType;
      const phase = l.structuredData?.['phase'] as string | undefined;
      if (mt === 'done' || mt === 'error' || phase === 'done') {
        set.add(l.dispatchId);
      }
    }
    return set;
  }, [allLines]);

  const messageGroups = groupMessages(visibleLines);
  const parallelPhases = useMemo(
    () => detectParallelPhases(visibleLines, allLines, isRunActive ?? false),
    [visibleLines, allLines, isRunActive],
  );
  const dispatchLabelMap = useMemo(() => buildDispatchLabelMap(parallelPhases), [parallelPhases]);

  const seenTimestamps = useRef<Set<string> | null>(null);
  seenTimestamps.current ??=
    isRunActive && visibleLines.length <= 3
      ? new Set<string>()
      : new Set(visibleLines.map((l) => l.timestamp));
  const currentSeen = seenTimestamps.current;

  useEffect(() => {
    const seen = seenTimestamps.current;
    if (!seen) {
      return;
    }
    for (const l of visibleLines) {
      seen.add(l.timestamp);
    }
  }, [visibleLines]);

  return (
    <div className="relative flex h-full flex-col rounded-lg border border-border bg-card">
      {(status === 'reconnecting' || status === 'disconnected') && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          {status === 'reconnecting' && (
            <span className="text-xs text-yellow-500">reconnecting...</span>
          )}
          {status === 'disconnected' && (
            <span className="text-xs text-muted-foreground">disconnected</span>
          )}
        </div>
      )}

      {hasDebug && (
        <div className="flex gap-3 border-b border-border bg-card px-4 py-1">
          <button
            type="button"
            aria-pressed={showDebug}
            onClick={() => {
              setShowDebug((v) => !v);
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showDebug ? 'Hide debug' : 'Show debug'}
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        onScroll={handleScroll}
        aria-live="polite"
        aria-relevant="additions"
        className="min-h-0 flex-1 overflow-y-auto bg-background p-3 font-mono text-xs leading-relaxed"
      >
        {sources && sources.length > 0 && (
          <div className="mb-3">
            <div
              className={cn(
                'mb-1 flex items-baseline text-2xs font-medium',
                senderLabelColor.human,
              )}
            >
              <span className="flex items-center gap-1.5">
                <User2 className="size-3.5 shrink-0" />
                Human
              </span>
            </div>
            <div
              className={cn(
                'rounded-lg border-l-2 bg-rose-950/20 p-2.5 text-xs ring-1 ring-white/[0.03]',
                senderBorderColor.human,
              )}
            >
              <div className="flex items-baseline whitespace-pre-wrap text-foreground">
                {allLines[0]?.timestamp && <Timestamp iso={allLines[0].timestamp} />}
                <span className="font-medium">{linkify(sources.join('\n'))}</span>
              </div>
            </div>
          </div>
        )}
        {renderMessageFlow(
          messageGroups,
          parallelPhases,
          currentSeen,
          containerRef,
          roleMetaMap,
          dispatchPromptMap,
          dispatchDescriptionMap,
          dispatchArtifactMap,
          historicalArtifactMap,
          onViewArtifact,
          onViewScript,
          respondedRequestIds,
          finishedDispatchIds,
          runId ?? '',
          groups,
          dispatchLabelMap,
        )}
        {!isTerminal &&
          messageGroups.length > 0 &&
          !(waitingContext && runId && onAction && actionTakenKey !== waitingKey) && (
            <TypingIndicator
              lastTimestamp={allLines.at(-1)?.timestamp}
              currentState={currentState}
            />
          )}
        {!isRunActive && abortPresentation && (
          <AbortMessage
            timestamp={abortPresentation.timestamp}
            reason={abortPresentation.reason}
            variant={abortPresentation.variant}
          />
        )}
        {allLines.length === 0 && !sources?.length && (
          <div className="text-muted-foreground">Waiting for output...</div>
        )}
        {waitingContext && runId && onAction && actionTakenKey !== waitingKey && (
          <div className="mb-3">
            <div className="mb-1 flex items-baseline text-2xs font-medium text-amber-400">
              <span>Human Approval</span>
            </div>
            <ActionBar
              runId={runId}
              waitingContext={waitingContext}
              onAction={() => {
                onAction();
              }}
              onSubmitting={() => {
                setActionTakenKey(waitingKey);
              }}
              onViewArtifact={onViewArtifact}
            />
          </div>
        )}
      </div>
      {showScrollTop && (
        <button
          type="button"
          onClick={() => {
            containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="absolute bottom-4 right-4 rounded-full border border-border bg-card/90 p-2 text-muted-foreground shadow-lg backdrop-blur-sm transition-opacity hover:text-foreground"
          aria-label="Scroll to top"
          title="Scroll to top"
        >
          <ArrowUp className="size-4" />
        </button>
      )}
    </div>
  );
}

function isPermissionResolved(mg: MessageGroup): boolean {
  return (
    mg.sender === 'system' && mg.lines[0]?.protocolMessage?.messageType === 'permission_resolved'
  );
}

function agentKey(mg: MessageGroup): string {
  return `${mg.sender}:${mg.senderLabel}`;
}

function renderMessageFlow(
  messageGroups: readonly MessageGroup[],
  parallelPhases: Map<string, ParallelPhase>,
  seenTimestamps: Set<string>,
  scrollContainer: React.RefObject<HTMLDivElement | null>,
  roleMetaMap: ReadonlyMap<string, RoleMeta>,
  dispatchPromptMap: ReadonlyMap<string, string>,
  dispatchDescriptionMap: ReadonlyMap<string, string>,
  dispatchArtifactMap: ReadonlyMap<string, DispatchArtifacts>,
  historicalArtifactMap: ReadonlyMap<string, DispatchArtifacts>,
  onViewArtifact: ((ref: ArtifactRef) => void) | undefined,
  onViewScript: ((name: string) => void) | undefined,
  respondedRequestIds: ReadonlyMap<string, 'granted' | 'denied'>,
  finishedDispatchIds: ReadonlySet<string>,
  runId: string,
  groups: Map<string, DispatchGroup>,
  dispatchLabelMap: ReadonlyMap<string, string>,
): React.ReactNode[] {
  const rendered: React.ReactNode[] = [];
  const renderedPhases = new Set<string>();
  const renderedScriptDispatches = new Set<string>();
  let lastAgentKey: string | null = null;

  const phaseStateIds = new Set<string>();
  const phaseDispatchIds = new Set<string>();
  for (const phase of parallelPhases.values()) {
    phaseStateIds.add(phase.stateId);
    for (const dispatchId of phase.dispatches.keys()) {
      phaseDispatchIds.add(dispatchId);
    }
  }

  const findPhaseForGroup = (mg: MessageGroup): [string, ParallelPhase] | undefined => {
    const dispatchId = mg.lines[0]?.dispatchId;
    if (!dispatchId) {
      return undefined;
    }
    const groupStateId = mg.stateId ?? mg.lines[0]?.stateId;
    for (const [phaseKey, phase] of parallelPhases) {
      if (phase.dispatches.has(dispatchId) && phase.stateId === groupStateId) {
        return [phaseKey, phase];
      }
    }
    return undefined;
  };

  for (let i = 0; i < messageGroups.length; i++) {
    const mg = messageGroups[i];

    if (isPermissionResolved(mg)) {
      const batch: MessageGroup[] = [mg];
      while (i + 1 < messageGroups.length && isPermissionResolved(messageGroups[i + 1])) {
        i++;
        batch.push(messageGroups[i]);
      }
      const nonPhaseBatch = batch.filter((g) => {
        const did = g.lines[0]?.dispatchId;
        return !did || !phaseDispatchIds.has(did);
      });
      if (nonPhaseBatch.length > 0) {
        rendered.push(
          <CollapsedPermissions
            key={`perms-${String(i)}`}
            groups={nonPhaseBatch}
            dispatchLabelMap={dispatchLabelMap}
          />,
        );
      }
      continue;
    }

    const dispatchId = mg.lines[0]?.dispatchId;
    if (dispatchId && !renderedScriptDispatches.has(dispatchId)) {
      const group = groups.get(dispatchId);
      if (group && group.roleId === 'script') {
        renderedScriptDispatches.add(dispatchId);
        rendered.push(renderScriptBlock(group, i, onViewScript));
        continue;
      }
    } else if (dispatchId && renderedScriptDispatches.has(dispatchId)) {
      continue;
    }

    if (mg.sender === 'orchestrator' && mg.stateId && phaseStateIds.has(mg.stateId)) {
      continue;
    }

    const isInteractiveSystem =
      mg.sender === 'system' &&
      (mg.lines[0]?.protocolMessage?.messageType === 'permission_request' ||
        mg.lines[0]?.protocolMessage?.messageType === 'clarification_request');

    const match =
      mg.sender === 'orchestrator' || isInteractiveSystem ? undefined : findPhaseForGroup(mg);

    if (match) {
      const [phaseKey, phase] = match;
      if (!renderedPhases.has(phaseKey)) {
        renderedPhases.add(phaseKey);
        rendered.push(
          <ParallelPhaseBlock
            key={`phase-${phaseKey}`}
            phase={phase}
            runId={runId}
            seenTimestamps={seenTimestamps}
            scrollContainer={scrollContainer}
            roleMetaMap={roleMetaMap}
            dispatchPromptMap={dispatchPromptMap}
            dispatchDescriptionMap={dispatchDescriptionMap}
            dispatchArtifactMap={dispatchArtifactMap}
            historicalArtifactMap={historicalArtifactMap}
            onViewArtifact={onViewArtifact}
            respondedRequestIds={respondedRequestIds}
          />,
        );
      }
      lastAgentKey = agentKey(mg);
    } else {
      const currentKey = agentKey(mg);
      const showHeader = mg.sender !== 'agent' || currentKey !== lastAgentKey;

      rendered.push(
        <ChatBubble
          key={`group-${String(i)}`}
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
          finishedDispatchIds={finishedDispatchIds}
          showHeader={showHeader}
          dispatchLabelMap={dispatchLabelMap}
        />,
      );

      if (mg.sender === 'agent' || mg.sender === 'orchestrator') {
        lastAgentKey = currentKey;
      }
    }
  }

  return rendered;
}

function renderScriptBlock(
  group: DispatchGroup,
  index: number,
  onViewScript: ((name: string) => void) | undefined,
): React.ReactNode {
  const lines = group.lines;
  let script = 'unknown';
  let status: 'running' | 'success' | 'failed' = 'running';
  let message: string | undefined;
  let timestamp: string | undefined;

  const stderrParts: string[] = [];

  for (const line of lines) {
    if (line.type === 'stderr') {
      stderrParts.push(line.content);
    }
    const sd = line.structuredData;
    if (sd?.messageType === 'script_started' && typeof sd.script === 'string') {
      script = sd.script;
      timestamp = line.timestamp;
    }
    if (sd?.messageType === 'script_completed') {
      if (typeof sd.script === 'string') {
        script = sd.script;
      }
      if (typeof sd.exitCode === 'number') {
        status = sd.exitCode === 0 ? 'success' : 'failed';
      }
      timestamp = line.timestamp;
      const output = sd.output;
      if (
        output &&
        typeof output === 'object' &&
        'message' in output &&
        typeof output.message === 'string' &&
        output.message.length > 0
      ) {
        message = output.message;
      } else if (typeof line.content === 'string' && line.content.trim().length > 0) {
        message = line.content.trim();
      }
    }
  }

  return (
    <ScriptOutputBlock
      key={`script-${group.dispatchId}-${String(index)}`}
      script={script}
      state={group.stateId}
      status={status}
      message={message}
      stderr={stderrParts.join('')}
      timestamp={timestamp}
      onViewScript={onViewScript}
    />
  );
}
