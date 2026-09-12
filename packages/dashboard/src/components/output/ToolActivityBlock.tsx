import { ChevronDown, Wrench } from 'lucide-react';
import React, { useMemo, useState } from 'react';

import type { DashboardAgentStreamEvent } from '../../hooks/use-agent-stream';
import { cn } from '../../lib/utils';

import { Timestamp } from './line-renderers';
import type { MessageGroup } from './output-utils';
import { extractToolCallInfo, humanizeRole } from './output-utils';

export interface ToolActivityItem {
  readonly id: string;
  readonly name: string;
  readonly timestamp: string;
  readonly detail?: string;
  readonly phase: 'tool_call' | 'tool_result';
}

export function consolidateToolCalls(
  lines: readonly DashboardAgentStreamEvent[],
): readonly ToolActivityItem[] {
  const items: ToolActivityItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const info = extractToolCallInfo(line);
    if (!info) {
      continue;
    }
    const lastIndex = items.length - 1;
    const lastItem = items.at(-1);
    if (
      lastItem?.name === info.name &&
      lastItem.phase === 'tool_call' &&
      info.phase === 'tool_result'
    ) {
      items[lastIndex] = {
        ...lastItem,
        phase: 'tool_result',
        timestamp: info.timestamp,
        detail: info.detail ?? lastItem.detail,
      };
    } else {
      items.push({
        id: `${line.timestamp}-${String(i)}`,
        name: info.name,
        timestamp: info.timestamp,
        detail: info.detail,
        phase: info.phase,
      });
    }
  }
  return items;
}

export function ToolActivityBlock({
  group,
  dispatchLabelMap,
}: Readonly<{
  group: MessageGroup;
  dispatchLabelMap?: ReadonlyMap<string, string>;
}>) {
  const [expanded, setExpanded] = useState(false);

  const items = useMemo(() => consolidateToolCalls(group.lines), [group.lines]);
  if (items.length === 0) {
    return null;
  }

  const roleId = group.lines[0]?.roleId;
  const dispatchId = group.lines[0]?.dispatchId;
  const workerLabel = dispatchId
    ? (dispatchLabelMap?.get(dispatchId) ?? (roleId ? humanizeRole(roleId) : undefined))
    : roleId
      ? humanizeRole(roleId)
      : undefined;

  const toolCounts = new Map<string, number>();
  for (const item of items) {
    toolCounts.set(item.name, (toolCounts.get(item.name) ?? 0) + 1);
  }
  const summaryParts = [...toolCounts.entries()].map(([name, count]) =>
    count > 1 ? `${String(count)}× ${name}` : name,
  );
  const toolsSummary = summaryParts.join(', ');
  const totalCount = items.length;
  const lastItem = items.at(-1);
  const isLastRunning = lastItem?.phase === 'tool_call';

  const singleDetail = items[0]?.detail ? ` (${items[0].detail})` : '';
  const title =
    totalCount === 1
      ? `Used tool ${items[0]?.name ?? 'tool'}${singleDetail}`
      : `Used ${String(totalCount)} tools (${toolsSummary})`;

  return (
    <div className="my-1.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((v) => !v);
        }}
        className="flex w-full items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-left text-2xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <Wrench className="size-3 shrink-0 text-muted-foreground/70" />
        {workerLabel && <span className="font-semibold text-foreground/80">{workerLabel}:</span>}
        <span className="truncate font-medium text-foreground/70">{title}</span>
        {isLastRunning && (
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary/60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
        )}
        <ChevronDown
          className={cn(
            'ml-auto size-3 shrink-0 text-muted-foreground/60 transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="mt-1 space-y-1 rounded-md border border-border/40 bg-card/60 p-2 font-mono text-2xs">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-baseline gap-2 text-muted-foreground hover:text-foreground/90"
            >
              <Timestamp iso={item.timestamp} />
              <span className="font-semibold text-foreground/90">{item.name}</span>
              {item.detail && (
                <span
                  className="max-w-[70%] truncate text-muted-foreground/80 font-normal"
                  title={item.detail}
                >
                  {item.detail}
                </span>
              )}
              {item.phase === 'tool_call' ? (
                <span className="ml-auto shrink-0 text-2xs text-amber-400">running...</span>
              ) : (
                <span className="ml-auto shrink-0 text-2xs text-emerald-400">done</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
