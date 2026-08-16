import { useState } from 'react';

import { cn } from '../../lib/utils';

import { humanizeRole } from './output-utils';

export function AutoResolvedBanner({
  icon,
  color,
  label,
  resolved,
  reason,
  toolInput,
  action,
  resource,
  roleId,
  workerLabel,
  rawDetail,
}: Readonly<{
  icon: string;
  color: string;
  label: string;
  resolved: string;
  reason: string;
  toolInput?: Record<string, unknown>;
  action: string;
  resource: string;
  roleId?: string;
  workerLabel?: string;
  rawDetail?: string;
}>) {
  const [expanded, setExpanded] = useState(false);
  const input = toolInput ?? {};
  const command = typeof input['command'] === 'string' ? input['command'] : undefined;
  const filePath =
    (typeof input['file_path'] === 'string' ? input['file_path'] : undefined) ??
    (typeof input['path'] === 'string' ? input['path'] : undefined) ??
    resource;
  const detail =
    action === 'shell_execute' ? command : action === 'custom' ? rawDetail || resource : filePath;

  const isPreviouslyApproved = reason.startsWith('previously_approved');
  const displayName = workerLabel ?? (roleId ? humanizeRole(roleId) : undefined);
  const resolvedLabel = isPreviouslyApproved
    ? `auto-granted${displayName ? ` to ${displayName}` : ''} (previously approved)`
    : `${resolved}${displayName ? ` to ${displayName}` : ''}`;
  const borderColor = isPreviouslyApproved ? 'border-blue-900/50' : 'border-border';
  const bgColor = isPreviouslyApproved ? 'bg-blue-950/30' : 'bg-card/50';
  const displayIcon = isPreviouslyApproved ? '↻' : icon;
  const displayColor = isPreviouslyApproved ? 'text-blue-400' : color;

  return (
    <div
      className={cn(
        'border rounded px-3 py-1.5 text-xs text-muted-foreground',
        borderColor,
        bgColor,
      )}
    >
      <button
        type="button"
        className={cn('flex w-full items-center gap-2 text-left', detail && 'cursor-pointer')}
        onClick={() => {
          if (detail) {
            setExpanded(!expanded);
          }
        }}
      >
        <span className={displayColor}>{displayIcon}</span>
        <span>
          {label} — {resolvedLabel}
        </span>
        {detail && (
          <span
            className={cn(
              'ml-auto text-[11px] text-muted-foreground/60 transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          >
            ›
          </span>
        )}
      </button>
      {expanded && detail && (
        <div className="mt-1.5 rounded border border-border bg-background/60 p-2 overflow-x-auto">
          <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
            {detail}
          </pre>
          {reason && !isPreviouslyApproved && (
            <p className="mt-1 text-2xs text-muted-foreground/60 italic">{reason}</p>
          )}
        </div>
      )}
    </div>
  );
}
