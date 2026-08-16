import type { RoleAssignmentView, StateNode as StateNodeData } from '@ai-orchestrator/schemas';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';

import { humanize } from '../lib/humanize';

import { stateTypeIcon, type EdgeCategory } from './workflow-graph-layout';

export interface RunnerInfoData {
  runner: string;
  model: string;
}

export const stateTypeColors: Record<string, string> = {
  action: '#3b82f6',
  review: '#a855f7',
  judge: '#a855f7',
  gate: '#a855f7',
  wait: '#f59e0b',
  terminal: '#22c55e',
  script: '#06b6d4',
};

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 60;
export const GROUP_H_PAD = 10;
export const GROUP_TOP_PAD = 24;
export const GROUP_BOTTOM_PAD = 8;

export function formatTimeSpent(ms: number): string {
  if (ms === 0) {
    return '';
  }
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) {
    return `${String(totalSec)}s`;
  }
  const m = Math.floor(totalSec / 60);
  const rem = totalSec % 60;
  return `${String(m)}m ${String(rem)}s`;
}

export function shortenRoleName(role: string): string {
  return humanize(role.replace(/_(?:reviewer|analyst|engineer|checker)$/i, ''));
}

export function nodeLabel(s: StateNodeData, currentStateElapsedMs?: number): ReactNode {
  const icon = stateTypeIcon(s.type);
  const title = `${icon}  ${humanize(s.label)}`;
  let timeText: string | undefined;
  if (s.current && currentStateElapsedMs != null && currentStateElapsedMs > 0) {
    const sec = Math.floor(currentStateElapsedMs / 1000);
    const liveLabel =
      sec < 60 ? `${String(sec)}s` : `${String(Math.floor(sec / 60))}m ${String(sec % 60)}s`;
    timeText = s.timeSpentMs > 0 ? `${liveLabel} (+ ${formatTimeSpent(s.timeSpentMs)})` : liveLabel;
  } else if (s.visited && s.timeSpentMs > 0) {
    timeText = formatTimeSpent(s.timeSpentMs);
  }
  if (!timeText) {
    return title;
  }
  return (
    <span className="flex flex-col items-center">
      <span>{title}</span>
      <span className="text-2xs opacity-70">{timeText}</span>
    </span>
  );
}

export function subNodeLabel(
  role: string,
  s: StateNodeData,
  currentStateElapsedMs?: number,
): ReactNode {
  const icon = stateTypeIcon(s.type);
  const title = `${icon}  ${shortenRoleName(role)}`;
  const roleDuration = s.parallelInfo?.roleDurations?.[role];
  let timeText: string | undefined;

  if (roleDuration != null && roleDuration > 0) {
    timeText = formatTimeSpent(roleDuration);
  } else if (s.current && currentStateElapsedMs != null && currentStateElapsedMs > 0) {
    const sec = Math.floor(currentStateElapsedMs / 1000);
    timeText =
      sec < 60 ? `${String(sec)}s` : `${String(Math.floor(sec / 60))}m ${String(sec % 60)}s`;
  } else if (s.visited && s.timeSpentMs > 0) {
    timeText = formatTimeSpent(s.timeSpentMs);
  }
  if (!timeText) {
    return title;
  }
  return (
    <span className="flex flex-col items-center">
      <span>{title}</span>
      <span className="text-2xs opacity-70">{timeText}</span>
    </span>
  );
}

export function edgeStroke(category: EdgeCategory, traversed: boolean): string {
  if (category === 'abort') {
    return traversed ? '#ef4444' : '#7f1d1d';
  }
  if (category === 'backward') {
    return traversed ? '#f59e0b' : '#92400e';
  }
  if (traversed) {
    return '#60a5fa';
  }
  return '#9ca3af';
}

export function edgeOpacity(category: EdgeCategory, traversed: boolean, preview?: boolean): number {
  if (preview) {
    return 0.7;
  }
  if (traversed) {
    return 1;
  }
  if (category === 'backward' || category === 'abort') {
    return 0.6;
  }
  return 0.25;
}

export function edgeDash(category: EdgeCategory, traversed: boolean): string | undefined {
  if (category === 'backward') {
    return '6 3';
  }
  if (!traversed && category === 'forward') {
    return '4 4';
  }
  return undefined;
}

export function nodeOpacity(s: StateNodeData, role: string, preview?: boolean): number {
  if (preview) {
    return 1;
  }
  if (s.current) {
    return 1;
  }
  if (s.visited) {
    return 1;
  }
  if (role === 'branch' || role === 'terminal-branch') {
    return 0.35;
  }
  return 0.45;
}

export function resolveRunnerInfo(
  roles: readonly string[] | undefined,
  roleAssignments: readonly RoleAssignmentView[] | undefined,
): RunnerInfoData | undefined {
  if (!roles || roles.length === 0 || !roleAssignments || roleAssignments.length === 0) {
    return undefined;
  }
  const match = roleAssignments.find((ra) => roles.includes(ra.role));
  if (!match || (!match.runner && !match.model)) {
    return undefined;
  }
  return {
    runner: humanize(match.runner ?? 'unknown'),
    model: match.model ?? 'unknown',
  };
}

export function resolveSubBackground(
  preview: boolean | undefined,
  current: boolean,
  typeColor: string,
  role: string,
): string {
  if (preview) {
    return '#1e293b';
  }
  if (current) {
    return typeColor;
  }
  if (role === 'branch') {
    return '#111827';
  }
  return '#1f2937';
}

export function resolveNodeBackground(opts: {
  preview?: boolean;
  current: boolean;
  typeColor: string;
  isTerminal: boolean;
  isAborted: boolean;
  role: string;
}): string {
  if (opts.preview) {
    return '#1e293b';
  }
  if (opts.current) {
    return opts.typeColor;
  }
  if (opts.isTerminal) {
    return opts.isAborted ? '#7f1d1d' : '#14532d';
  }
  if (opts.role === 'branch') {
    return '#111827';
  }
  return '#1f2937';
}

export function resolveBorderColor(
  preview: boolean | undefined,
  current: boolean,
  visited: boolean,
  typeColor: string,
): string {
  if (preview) {
    return typeColor;
  }
  if (current) {
    return '#93c5fd';
  }
  if (visited) {
    return typeColor;
  }
  return '#374151';
}

function ParallelGroupNode({ data }: NodeProps) {
  return (
    <div className="flex h-full w-full flex-col rounded-lg border-2 border-dashed border-white/30 bg-white/[0.03]">
      <span className="px-2.5 pt-1.5 text-xs font-semibold text-muted-foreground">
        {data.label as string}
      </span>
    </div>
  );
}

function MultiHandleNode({ data }: NodeProps) {
  const [showRoleTooltip, setShowRoleTooltip] = useState(false);
  const [showRunnerTooltip, setShowRunnerTooltip] = useState(false);
  const [showScriptTooltip, setShowScriptTooltip] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);
  const roles = data.roles as readonly string[] | undefined;
  const scripts = data.scripts as readonly string[] | undefined;
  const runnerInfo = data.runnerInfo as RunnerInfoData | undefined;

  useEffect(() => {
    const nodeEl = nodeRef.current?.closest('.react-flow__node');
    if (!nodeEl) {
      return;
    }
    if (showRoleTooltip || showRunnerTooltip || showScriptTooltip) {
      nodeEl.classList.add('role-tooltip-open');
    } else {
      nodeEl.classList.remove('role-tooltip-open');
    }
  }, [showRoleTooltip, showRunnerTooltip, showScriptTooltip]);

  return (
    <div ref={nodeRef}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left-in" />
      <Handle type="target" position={Position.Right} id="right-in" />
      <div>{data.label as string}</div>
      {runnerInfo && (
        <div
          role="img"
          aria-label={`Runner: ${runnerInfo.runner} · ${runnerInfo.model}`}
          className="absolute left-1 top-1"
          onMouseEnter={() => {
            setShowRunnerTooltip(true);
          }}
          onMouseLeave={() => {
            setShowRunnerTooltip(false);
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="size-3.5 opacity-50"
          >
            <path
              fillRule="evenodd"
              d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z"
              clipRule="evenodd"
            />
          </svg>
          {showRunnerTooltip && (
            <div className="pointer-events-none absolute -top-1 right-5 z-[9999] whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground/80">
              {runnerInfo.runner} · {runnerInfo.model}
            </div>
          )}
        </div>
      )}
      {roles && roles.length > 0 && (
        <div
          role="img"
          aria-label={`Roles: ${roles.map((r) => humanize(r)).join(', ')}`}
          className="absolute right-1 top-1"
          onMouseEnter={() => {
            setShowRoleTooltip(true);
          }}
          onMouseLeave={() => {
            setShowRoleTooltip(false);
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="size-3.5 opacity-50"
          >
            <path d="M12 2a1 1 0 0 1 1 1v1.07A7.002 7.002 0 0 1 19 11v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a7.002 7.002 0 0 1 6-6.93V3a1 1 0 0 1 1-1ZM9 12a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 9 12Zm6 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM5 20h14a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2Z" />
          </svg>
          {showRoleTooltip && (
            <div className="pointer-events-none absolute -top-1 left-5 z-[9999] whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground/80">
              {roles.map((r) => humanize(r)).join(', ')}
            </div>
          )}
        </div>
      )}
      {scripts && scripts.length > 0 && !(roles && roles.length > 0) && (
        <div
          role="img"
          aria-label={`Scripts: ${scripts.join(', ')}`}
          className="absolute right-1 top-1"
          onMouseEnter={() => {
            setShowScriptTooltip(true);
          }}
          onMouseLeave={() => {
            setShowScriptTooltip(false);
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="size-3.5 opacity-50"
          >
            <path
              fillRule="evenodd"
              d="M2.25 6A2.25 2.25 0 0 1 4.5 3.75h15A2.25 2.25 0 0 1 21.75 6v12A2.25 2.25 0 0 1 19.5 20.25h-15A2.25 2.25 0 0 1 2.25 18V6ZM5.03 7.28a.75.75 0 0 0-1.06 1.06l2.47 2.47-2.47 2.47a.75.75 0 1 0 1.06 1.06l3-3a.75.75 0 0 0 0-1.06l-3-3Zm5.22 5.47a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Z"
              clipRule="evenodd"
            />
          </svg>
          {showScriptTooltip && (
            <div className="pointer-events-none absolute -top-1 left-5 z-[9999] whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground/80">
              {scripts.join(', ')}
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left-out" />
      <Handle type="source" position={Position.Right} id="right-out" />
    </div>
  );
}

export const nodeTypes = {
  multiHandle: MultiHandleNode,
  parallelGroup: ParallelGroupNode,
};

export const LEGEND_ITEMS: { color: string; label: string }[] = [
  { color: '#3b82f6', label: 'Action' },
  { color: '#a855f7', label: 'Review' },
  { color: '#06b6d4', label: 'Script' },
  { color: '#f59e0b', label: 'Waiting' },
  { color: '#22c55e', label: 'Done' },
  { color: '#ef4444', label: 'Aborted' },
];

export const GraphLegend = memo(function GraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-1.5">
      {LEGEND_ITEMS.map(({ color, label }) => (
        <span key={label} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </span>
      ))}
      <span className="ml-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
        <span className="inline-block h-0.5 w-4 rounded bg-blue-400" />
        Traversed
      </span>
      <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <span
          className="inline-block h-0.5 w-4 rounded"
          style={{
            backgroundImage: 'repeating-linear-gradient(90deg, #9ca3af 0 3px, transparent 3px 7px)',
          }}
        />
        Pending
      </span>
      <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <span
          className="inline-block h-0.5 w-4 rounded"
          style={{
            backgroundImage: 'repeating-linear-gradient(90deg, #f59e0b 0 4px, transparent 4px 7px)',
          }}
        />
        Retry
      </span>
    </div>
  );
});
