import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../../lib/utils';

import { AutoResolvedBanner } from './AutoResolvedBanner';
import type { MessageGroup } from './output-utils';
import { ACTION_LABELS, humanizeRole, str } from './output-utils';

interface PermissionSummary {
  readonly action: string;
  readonly resolved: string;
  readonly roleId: string;
  readonly isPreviouslyApproved: boolean;
}

function extractPermissionInfo(group: MessageGroup): PermissionSummary | undefined {
  const line = group.lines[0] as (typeof group.lines)[number] | undefined;
  if (!line) {
    return undefined;
  }
  const pm = line.protocolMessage;
  if (!pm || pm.messageType !== 'permission_resolved') {
    return undefined;
  }
  const resolved = str(pm.payload.resolved ?? line.structuredData?.resolved);
  const reason = str(pm.payload.reason ?? line.structuredData?.reason);
  const action = str(pm.payload.action ?? line.structuredData?.action);
  return {
    action,
    resolved,
    roleId: line.roleId,
    isPreviouslyApproved: reason.startsWith('previously_approved'),
  };
}

function SinglePermission({
  group,
  dispatchLabelMap,
}: Readonly<{ group: MessageGroup; dispatchLabelMap?: ReadonlyMap<string, string> }>) {
  const line = group.lines[0];
  const pm = line.protocolMessage;
  if (!pm || pm.messageType !== 'permission_resolved') {
    return null;
  }
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

export function CollapsedPermissions({
  groups,
  dispatchLabelMap,
}: Readonly<{
  groups: readonly MessageGroup[];
  dispatchLabelMap?: ReadonlyMap<string, string>;
}>) {
  const [expanded, setExpanded] = useState(false);
  const infos = groups.map(extractPermissionInfo).filter((i): i is PermissionSummary => i != null);
  if (infos.length === 0) {
    return null;
  }

  if (groups.length === 1) {
    return <SinglePermission group={groups[0]} dispatchLabelMap={dispatchLabelMap} />;
  }

  const allGranted = infos.every((i) => i.resolved === 'granted');
  const allAutoGranted = infos.every((i) => i.isPreviouslyApproved);
  const firstDispatchId = groups[0]?.lines[0]?.dispatchId;
  const roleName = firstDispatchId
    ? (dispatchLabelMap?.get(firstDispatchId) ??
      (infos[0].roleId ? humanizeRole(infos[0].roleId) : undefined))
    : infos[0].roleId
      ? humanizeRole(infos[0].roleId)
      : undefined;

  const actionCounts = new Map<string, number>();
  for (const info of infos) {
    const label = ACTION_LABELS[info.action] ?? info.action;
    actionCounts.set(label, (actionCounts.get(label) ?? 0) + 1);
  }
  const actionSummary = [...actionCounts.entries()]
    .map(([label, count]) => (count > 1 ? `${String(count)}× ${label}` : label))
    .join(', ');

  const icon = allAutoGranted ? '↻' : allGranted ? '✓' : '⚡';
  const iconColor = allAutoGranted
    ? 'text-blue-400'
    : allGranted
      ? 'text-emerald-500'
      : 'text-yellow-400';
  const borderClass = allAutoGranted ? 'border-blue-900/50' : 'border-border';
  const bgClass = allAutoGranted ? 'bg-blue-950/30' : 'bg-card/50';

  const label = allAutoGranted
    ? `${String(infos.length)} auto-granted${roleName ? ` to ${roleName}` : ''}`
    : allGranted
      ? `${String(infos.length)} granted${roleName ? ` to ${roleName}` : ''}`
      : `${String(infos.length)} permissions resolved${roleName ? ` for ${roleName}` : ''}`;

  return (
    <div
      className={cn(
        'my-1 rounded border px-3 py-1.5 text-xs text-muted-foreground',
        borderClass,
        bgClass,
      )}
    >
      <button
        type="button"
        onClick={() => {
          setExpanded(!expanded);
        }}
        className="flex w-full cursor-pointer items-center gap-2"
      >
        <span className={iconColor}>{icon}</span>
        <span>{label}</span>
        <span className="ml-1 text-muted-foreground/50">({actionSummary})</span>
        <span className="ml-auto text-muted-foreground/50">
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 border-t border-border/50 pt-1.5">
          {groups.map((group, i) => {
            const line = group.lines[0];
            const pm = line.protocolMessage;
            if (!pm || pm.messageType !== 'permission_resolved') {
              return null;
            }
            const resolved = str(pm.payload.resolved ?? line.structuredData?.resolved);
            const reason = str(pm.payload.reason ?? line.structuredData?.reason);
            const action = str(pm.payload.action ?? line.structuredData?.action);
            const resolvedIcon = resolved === 'granted' ? '✓' : '✗';
            const color = resolved === 'granted' ? 'text-emerald-500' : 'text-red-500';
            const actionLabel = ACTION_LABELS[action] ?? action;
            const wLabel = line.dispatchId ? dispatchLabelMap?.get(line.dispatchId) : undefined;
            return (
              <AutoResolvedBanner
                key={`perm-${String(i)}`}
                icon={resolvedIcon}
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
                workerLabel={wLabel}
                rawDetail={str(pm.payload.detail ?? line.structuredData?.detail)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
