import { useState } from 'react';

import { api } from '../api/client';
import { cn } from '../lib/utils';

import { Button } from './ui/button';

const RISK_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  low: { bg: 'bg-muted', text: 'text-foreground/80', border: 'border-border' },
  medium: { bg: 'bg-yellow-950', text: 'text-yellow-300', border: 'border-yellow-800' },
  high: { bg: 'bg-red-950', text: 'text-red-300', border: 'border-red-800' },
};

const BANNER_STYLE: Record<string, { border: string; bg: string }> = {
  low: { border: 'border-border', bg: 'bg-card/30' },
  medium: { border: 'border-yellow-900/40', bg: 'bg-yellow-950/20' },
  high: { border: 'border-red-900/40', bg: 'bg-red-950/20' },
};

const ACTION_LABELS: Record<string, string> = {
  file_write: 'Write File',
  file_read: 'Read File',
  shell_execute: 'Run Command',
  network: 'Network Access',
};

function shortenPath(fullPath: string): string {
  const parts = fullPath.split('/');
  if (parts.length <= 4) {
    return fullPath;
  }
  const repoIdx = parts.findIndex(
    (p) => p === '.ai' || p === 'src' || p === 'packages' || p === 'node_modules',
  );
  if (repoIdx > 0) {
    return '.../' + parts.slice(repoIdx).join('/');
  }
  return '.../' + parts.slice(-3).join('/');
}

function extractPrimaryInfo(
  action: string,
  resource: string,
  toolInput?: Record<string, unknown>,
): {
  summary: string;
  command?: string;
  filePath?: string;
  description?: string;
  contentPreview?: string;
} {
  const input = toolInput ?? {};
  const command = typeof input['command'] === 'string' ? input['command'] : undefined;
  let filePath: string | undefined;
  if (typeof input['file_path'] === 'string') {
    filePath = input['file_path'];
  } else if (typeof input['path'] === 'string') {
    filePath = input['path'];
  }
  const description = typeof input['description'] === 'string' ? input['description'] : undefined;
  const content = typeof input['content'] === 'string' ? input['content'] : undefined;

  if (action === 'shell_execute' && command) {
    return { summary: description ?? 'Execute shell command', command, description };
  }

  if (action === 'file_write') {
    const target = filePath ?? resource;
    return {
      summary: target ? `Write to ${shortenPath(target)}` : 'Write file',
      filePath: target,
      contentPreview: content,
      description,
    };
  }

  if (action === 'file_read') {
    const target = filePath ?? resource;
    return { summary: target ? `Read ${shortenPath(target)}` : 'Read file', filePath: target };
  }

  return { summary: resource || action, description };
}

export function PermissionBanner({
  runId,
  messageId,
  action,
  resource,
  detail,
  riskLevel,
  toolInput,
  initialResolved,
  roleId,
  reason,
}: Readonly<{
  runId: string;
  messageId: string;
  action: string;
  resource: string;
  detail: string;
  riskLevel: string;
  toolInput?: Record<string, unknown>;
  initialResolved?: 'granted' | 'denied';
  roleId?: string;
  reason?: string;
}>) {
  const [resolved, setResolved] = useState<'granted' | 'denied' | null>(initialResolved ?? null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(!initialResolved);

  async function respond(granted: boolean) {
    setLoading(true);
    try {
      await api.respondPermission(runId, messageId, granted);
      setResolved(granted ? 'granted' : 'denied');
      setExpanded(false);
    } finally {
      setLoading(false);
    }
  }

  const badge = RISK_BADGE[riskLevel] ?? RISK_BADGE.medium;
  const style = BANNER_STYLE[riskLevel] ?? BANNER_STYLE.medium;
  const label = ACTION_LABELS[action] ?? (detail || action);
  const info = extractPrimaryInfo(action, resource, toolInput);

  if (resolved) {
    const isPreviouslyApproved = reason?.startsWith('previously_approved');
    const isAgentFinished = reason === 'agent_finished';
    const icon = isPreviouslyApproved
      ? '↻'
      : isAgentFinished
        ? '⊘'
        : resolved === 'granted'
          ? '✓'
          : '✗';
    const color = isPreviouslyApproved
      ? 'text-blue-400'
      : isAgentFinished
        ? 'text-muted-foreground/60'
        : resolved === 'granted'
          ? 'text-emerald-500'
          : 'text-red-500';
    const resolvedDetail = info.command ?? info.filePath ?? info.summary;
    const roleSuffix = roleId
      ? ` to ${roleId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
      : '';
    const resolvedLabel = isPreviouslyApproved
      ? `auto-granted${roleSuffix} (previously approved)`
      : isAgentFinished
        ? `expired${roleSuffix} (agent finished)`
        : `${resolved}${roleSuffix}`;
    const borderClass = isPreviouslyApproved ? 'border-blue-900/50' : 'border-border';
    const bgClass = isPreviouslyApproved ? 'bg-blue-950/30' : 'bg-card/50';
    return (
      <div
        className={cn(
          'border rounded px-3 py-1.5 text-xs text-muted-foreground',
          borderClass,
          bgClass,
        )}
      >
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 text-left"
          onClick={() => {
            setExpanded(!expanded);
          }}
          aria-expanded={expanded}
        >
          <span className={color}>{icon}</span>
          <span>
            {label} — {resolvedLabel}
          </span>
          <span
            className={cn(
              'ml-auto text-[11px] text-muted-foreground/60 transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          >
            ›
          </span>
        </button>
        {expanded && (
          <div className="mt-1.5 overflow-x-auto rounded border border-border bg-background/60 p-2">
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
              {resolvedDetail}
            </pre>
          </div>
        )}
      </div>
    );
  }

  const hasExpandableContent = info.command || info.contentPreview;

  return (
    <div className={cn('border rounded-md px-3 py-2.5', style.border, style.bg)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-1.5 py-0.5 text-2xs font-medium',
                badge.bg,
                badge.text,
                badge.border,
              )}
            >
              {riskLevel}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{info.summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="xs" disabled={loading} onClick={() => void respond(true)} variant="success">
            Approve
          </Button>
          <Button
            variant="destructive"
            size="xs"
            disabled={loading}
            onClick={() => void respond(false)}
          >
            Deny
          </Button>
        </div>
      </div>

      {hasExpandableContent && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => {
              setExpanded(!expanded);
            }}
            aria-expanded={expanded}
            className="cursor-pointer p-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span
              className={cn(
                'inline-block transition-transform duration-200',
                expanded && 'rotate-90',
              )}
            >
              ›
            </span>
            {' Details'}
          </button>
          {expanded && (
            <div className="mt-1.5 overflow-x-auto rounded border border-border bg-background/60 p-2">
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                {info.command ?? info.contentPreview?.slice(0, 500)}
                {info.contentPreview && info.contentPreview.length > 500 && '…'}
              </pre>
            </div>
          )}
        </div>
      )}

      {info.description && !info.command && (
        <p className="mt-1.5 text-[11px] italic text-muted-foreground">{info.description}</p>
      )}
    </div>
  );
}
