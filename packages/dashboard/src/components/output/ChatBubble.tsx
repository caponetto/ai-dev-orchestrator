import type { ArtifactRef } from '@ai-dev-orchestrator/schemas';
import { Bot, Check, ChevronDown, User2, X, Zap } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { DashboardAgentStreamEvent } from '../../hooks/use-agent-stream';
import type { DispatchArtifacts } from '../../lib/dispatch-artifacts';
import { resolveDispatchArtifacts } from '../../lib/dispatch-artifacts';
import { humanize } from '../../lib/humanize';
import { cn } from '../../lib/utils';
import { PermissionBanner } from '../PermissionBanner';

import { ArtifactsPopover } from './ArtifactsPopover';
import { AutoResolvedBanner } from './AutoResolvedBanner';
import { LineContent, TaskPromptContent, Timestamp } from './line-renderers';
import type { MessageGroup, RoleMeta } from './output-utils';
import {
  ACTION_LABELS,
  humanizeRole,
  senderBorderColor,
  senderLabelColor,
  str,
} from './output-utils';
import { PromptButton } from './PromptModal';

export function SystemMessage({
  line,
  runId,
  respondedRequestIds,
  dispatchLabelMap,
  finishedDispatchIds,
}: Readonly<{
  line: DashboardAgentStreamEvent;
  runId: string;
  respondedRequestIds?: ReadonlyMap<string, 'granted' | 'denied'>;
  dispatchLabelMap?: ReadonlyMap<string, string>;
  finishedDispatchIds?: ReadonlySet<string>;
}>) {
  const pm = line.protocolMessage;
  if (!pm) {
    return null;
  }

  if (pm.messageType === 'permission_resolved') {
    const resolved = str(pm.payload.resolved ?? line.structuredData?.resolved);
    const reason = str(pm.payload.reason ?? line.structuredData?.reason);
    const action = str(pm.payload.action ?? line.structuredData?.action);
    const icon = resolved === 'granted' ? '✓' : '✗';
    const color = resolved === 'granted' ? 'text-emerald-500' : 'text-red-500';
    const actionLabel = ACTION_LABELS[action] ?? action;
    const workerLabel = line.dispatchId ? dispatchLabelMap?.get(line.dispatchId) : undefined;
    return (
      <div className="my-1">
        <AutoResolvedBanner
          icon={icon}
          color={color}
          label={actionLabel}
          resolved={resolved}
          reason={reason}
          toolInput={
            (pm.payload.toolInput ?? line.structuredData?.toolInput) as
              Record<string, unknown> | undefined
          }
          action={action}
          resource={str(pm.payload.resource ?? line.structuredData?.resource)}
          roleId={line.roleId}
          workerLabel={workerLabel}
          rawDetail={str(pm.payload.detail ?? line.structuredData?.detail)}
        />
      </div>
    );
  }

  if (pm.messageType === 'permission_request') {
    const messageId = line.requestMessageId ?? str(line.structuredData?.messageId);
    const priorDecision = messageId ? respondedRequestIds?.get(messageId) : undefined;
    const isExpired =
      !priorDecision && !!line.dispatchId && !!finishedDispatchIds?.has(line.dispatchId);
    return (
      <div className="my-2">
        <PermissionBanner
          runId={runId}
          messageId={messageId}
          action={str(pm.payload.action ?? line.structuredData?.action)}
          resource={str(pm.payload.resource ?? line.structuredData?.resource)}
          detail={str(pm.payload.detail ?? line.structuredData?.detail)}
          riskLevel={str(pm.payload.riskLevel ?? line.structuredData?.riskLevel, 'medium')}
          toolInput={
            (pm.payload.toolInput ?? line.structuredData?.toolInput) as
              Record<string, unknown> | undefined
          }
          initialResolved={isExpired ? 'denied' : priorDecision}
          reason={isExpired ? 'agent_finished' : undefined}
          roleId={line.roleId}
        />
      </div>
    );
  }

  if (pm.messageType === 'permission_response') {
    return null;
  }

  if (pm.messageType === 'clarification_request') {
    const question = str(pm.payload.question);
    const options = Array.isArray(pm.payload.options) ? (pm.payload.options as string[]) : [];
    return (
      <div className="my-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-2.5 text-xs">
        <div className="flex items-baseline gap-2">
          <Timestamp iso={line.timestamp} />
          <span className="font-medium text-yellow-400">Agent needs clarification</span>
        </div>
        <div className="mt-1 text-foreground/80">{question}</div>
        {str(pm.payload.context) && (
          <div className="mt-1 text-muted-foreground">{str(pm.payload.context)}</div>
        )}
        {options.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {options.map((opt) => (
              <span key={opt} className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
                {opt}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (pm.messageType === 'clarification_response') {
    return (
      <div className="my-2 flex items-baseline justify-center gap-2 text-xs text-emerald-400">
        <span>✓ Clarification provided</span>
        <Timestamp iso={line.timestamp} />
      </div>
    );
  }

  return null;
}

function collectTextNodes(root: Node, excludeAttr: string): Text[] {
  const result: Text[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result.push(node as Text);
      return;
    }
    if (node instanceof HTMLElement && node.hasAttribute(excludeAttr)) {
      return;
    }
    for (const child of node.childNodes) {
      walk(child);
    }
  };
  walk(root);
  return result;
}

export function TypedReveal({
  children,
  scrollContainer,
  timestamp: _timestamp,
}: Readonly<{
  children: React.ReactNode;
  scrollContainer: React.RefObject<HTMLDivElement | null>;
  timestamp: string;
}>) {
  const measureRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'measure' | 'typing' | 'done'>('measure');

  useEffect(() => {
    if (phase !== 'measure' || !measureRef.current) {
      return;
    }
    const clone = measureRef.current.cloneNode(true) as HTMLElement;
    for (const el of clone.querySelectorAll('[data-timestamp]')) {
      el.remove();
    }
    if (!(clone.textContent || '').trim()) {
      setPhase('done');
    } else {
      setPhase('typing');
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'typing' || !contentRef.current) {
      return;
    }

    const el = contentRef.current;
    const textNodes = collectTextNodes(el, 'data-timestamp');
    const originals = textNodes.map((t) => t.textContent || '');
    const totalLength = originals.reduce((sum, t) => sum + t.length, 0);

    if (totalLength === 0) {
      setPhase('done');
      return;
    }

    let charsPerFrame = 2;
    if (totalLength > 400) {
      charsPerFrame = 6;
    } else if (totalLength > 200) {
      charsPerFrame = 4;
    }

    const cursor = document.createElement('span');
    cursor.style.cssText =
      'display:inline-block;width:3px;height:0.85em;background:#9ca3af;vertical-align:text-bottom;margin-left:1px;animation:pulse 1s ease-in-out infinite';

    const truncate = (count: number) => {
      cursor.remove();
      let remaining = count;
      let lastVisible: Text | null = null;
      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        const full = originals[i];
        if (remaining >= full.length) {
          node.textContent = full;
          if (full.length > 0) {
            lastVisible = node;
          }
          remaining -= full.length;
        } else {
          node.textContent = full.slice(0, remaining);
          if (remaining > 0) {
            lastVisible = node;
          }
          remaining = 0;
        }
      }
      if (lastVisible?.parentNode) {
        lastVisible.parentNode.insertBefore(cursor, lastVisible.nextSibling);
      }
    };

    truncate(0);

    const sc = scrollContainer.current;
    const nearBottom = sc !== null && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 150;

    let current = 0;
    let raf = 0;
    const tick = () => {
      current = Math.min(current + charsPerFrame, totalLength);
      truncate(current);
      if (nearBottom) {
        sc.scrollTop = sc.scrollHeight;
      }
      if (current >= totalLength) {
        cursor.remove();
        setPhase('done');
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      cursor.remove();
    };
  }, [phase, scrollContainer]);

  if (phase === 'measure') {
    return (
      <div
        ref={measureRef}
        style={{ position: 'absolute', visibility: 'hidden', height: 0, overflow: 'hidden' }}
      >
        {children}
      </div>
    );
  }

  if (phase === 'done') {
    return <div>{children}</div>;
  }

  return <div ref={contentRef}>{children}</div>;
}

const COLLAPSED_HEIGHT = 80;

function CollapsibleContent({ children }: Readonly<{ children: React.ReactNode }>) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);

  const measure = useCallback(() => {
    if (contentRef.current) {
      setIsOverflowing(contentRef.current.scrollHeight > COLLAPSED_HEIGHT + 16);
    }
  }, []);

  useEffect(() => {
    measure();
  }, [measure, children]);

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className={cn(
          'overflow-hidden transition-[max-height] duration-200',
          isCollapsed && isOverflowing && 'max-h-[80px]',
        )}
      >
        {children}
      </div>
      {isOverflowing && isCollapsed && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card/95 to-transparent" />
      )}
      {isOverflowing && (
        <button
          type="button"
          onClick={() => {
            setIsCollapsed(!isCollapsed);
          }}
          className="relative z-10 mt-2 flex items-center gap-1 text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          <ChevronDown
            className={cn('size-3 transition-transform', !isCollapsed && 'rotate-180')}
          />
          <span>{isCollapsed ? 'Show more' : 'Show less'}</span>
        </button>
      )}
    </div>
  );
}

export const ChatBubble = React.memo(function ChatBubble({
  group,
  runId,
  seenTimestamps,
  scrollContainer,
  roleMetaMap,
  dispatchPromptMap,
  dispatchArtifactMap,
  historicalArtifactMap,
  onViewArtifact,
  respondedRequestIds,
  finishedDispatchIds,
  showHeader = true,
  dispatchLabelMap,
}: Readonly<{
  group: MessageGroup;
  runId: string;
  seenTimestamps: Set<string>;
  scrollContainer: React.RefObject<HTMLDivElement | null>;
  roleMetaMap: ReadonlyMap<string, RoleMeta>;
  dispatchPromptMap: ReadonlyMap<string, string>;
  dispatchArtifactMap: ReadonlyMap<string, DispatchArtifacts>;
  historicalArtifactMap: ReadonlyMap<string, DispatchArtifacts>;
  onViewArtifact?: (ref: ArtifactRef) => void;
  respondedRequestIds?: ReadonlyMap<string, 'granted' | 'denied'>;
  finishedDispatchIds?: ReadonlySet<string>;
  showHeader?: boolean;
  dispatchLabelMap?: ReadonlyMap<string, string>;
}>) {
  if (group.sender === 'system') {
    return (
      <SystemMessage
        line={group.lines[0]}
        runId={runId}
        respondedRequestIds={respondedRequestIds}
        finishedDispatchIds={finishedDispatchIds}
        dispatchLabelMap={dispatchLabelMap}
      />
    );
  }

  const isTaskPrompt = group.lines.some((l) => l.protocolMessage?.messageType === 'task_prompt');
  const roleId = group.lines[0]?.roleId;
  const dispatchId = group.lines[0]?.dispatchId;
  const meta = group.sender === 'agent' && roleId ? roleMetaMap.get(roleId) : undefined;
  const blockArtifacts =
    group.sender === 'agent' && roleId && dispatchId
      ? resolveDispatchArtifacts(roleId, dispatchId, dispatchArtifactMap, historicalArtifactMap)
      : undefined;
  const blockPrompt = dispatchId ? dispatchPromptMap.get(dispatchId) : undefined;
  const hasAgentMeta =
    group.sender === 'agent' && (meta != null || blockArtifacts != null || blockPrompt != null);

  const isOrchestrator = group.sender === 'orchestrator';

  if (isOrchestrator) {
    return (
      <div className="my-1.5 flex items-baseline gap-2 text-xs text-emerald-400/80">
        <Zap className="mt-0.5 size-3 shrink-0" />
        <div className="space-y-1">
          {group.lines.map((line, i) => {
            const key = `${line.timestamp}-${String(i)}`;
            const isNew = !seenTimestamps.has(line.timestamp);
            const verdictMatch = line.content.match(
              /(did not approve|not approved|rejected|failed|approved)/i,
            );
            let contentNode: React.ReactNode = <span>{line.content}</span>;
            if (verdictMatch) {
              const idx = verdictMatch.index ?? 0;
              const word = verdictMatch[0];
              const before = line.content.slice(0, idx + word.length);
              const after = line.content.slice(idx + word.length);
              const isNegative = /did not approve|not approved|rejected|failed/i.test(word);
              contentNode = (
                <span>
                  {before}
                  {isNegative ? (
                    <X className="mx-0.5 inline size-3.5 align-text-top text-red-400" />
                  ) : (
                    <Check className="mx-0.5 inline size-3.5 align-text-top text-emerald-400" />
                  )}
                  {after}
                </span>
              );
            }
            const node = (
              <span key={key} className="flex items-baseline gap-2">
                <Timestamp iso={line.timestamp} />
                {contentNode}
              </span>
            );
            return isNew ? (
              <TypedReveal key={key} scrollContainer={scrollContainer} timestamp={line.timestamp}>
                {node}
              </TypedReveal>
            ) : (
              <React.Fragment key={key}>{node}</React.Fragment>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('mb-3', !showHeader && 'mt-0')}>
      {showHeader && (
        <div
          className={cn(
            'mb-1 flex items-center justify-between text-2xs font-medium',
            senderLabelColor[group.sender],
          )}
        >
          <span className="flex items-center gap-1.5">
            {group.sender === 'human' && <User2 className="size-3.5 shrink-0" />}
            {group.sender === 'agent' && <Bot className="size-3.5 shrink-0" />}
            <span className={group.sender === 'agent' ? 'font-bold' : ''}>{group.senderLabel}</span>
            {group.stateId && group.sender === 'agent' && (
              <span className="font-normal text-yellow-400">@ {humanize(group.stateId)}</span>
            )}
          </span>
          {hasAgentMeta && (
            <span className="flex items-center gap-1.5 font-normal">
              {meta?.runner && (
                <span className="rounded bg-muted/60 px-1.5 py-0.5 text-2xs text-muted-foreground">
                  {humanizeRole(meta.runner)}
                </span>
              )}
              {meta?.model && (
                <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground/70">
                  {meta.model}
                </span>
              )}
              {blockArtifacts && (
                <ArtifactsPopover artifacts={blockArtifacts} onViewArtifact={onViewArtifact} />
              )}
              {blockPrompt && <PromptButton prompt={blockPrompt} />}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          'overflow-x-auto break-words rounded-lg border-l-2 p-2.5 text-xs ring-1 ring-white/[0.03] backdrop-blur-sm',
          senderBorderColor[group.sender],
          group.sender === 'human' ? 'bg-rose-950/20' : 'bg-card/80',
          !showHeader && 'mt-1 border-l-2',
        )}
      >
        <CollapsibleContent>
          <div className={isTaskPrompt ? '' : 'space-y-2'}>
            {group.lines.map((line, i) => {
              const key = `${line.timestamp}-${String(i)}`;
              const isNew = !seenTimestamps.has(line.timestamp);
              const node =
                line.protocolMessage?.messageType === 'task_prompt' ? (
                  <TaskPromptContent key={key} line={line} />
                ) : (
                  <LineContent key={key} line={line} />
                );
              return isNew ? (
                <TypedReveal key={key} scrollContainer={scrollContainer} timestamp={line.timestamp}>
                  {node}
                </TypedReveal>
              ) : (
                <React.Fragment key={key}>{node}</React.Fragment>
              );
            })}
          </div>
        </CollapsibleContent>
      </div>
    </div>
  );
});
