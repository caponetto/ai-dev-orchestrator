import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { useFetch } from '../hooks/use-fetch';
import { shouldRefreshHealth } from '../lib/refresh-triggers';
import { cn } from '../lib/utils';

const statusColors: Record<string, string> = {
  healthy: 'bg-emerald-500',
  ok: 'bg-emerald-500',
  degraded: 'bg-yellow-500',
  unhealthy: 'bg-red-500',
  unknown: 'bg-muted-foreground/50',
};

const statusTextColors: Record<string, string> = {
  healthy: 'text-emerald-400',
  ok: 'text-emerald-400',
  degraded: 'text-yellow-400',
  unhealthy: 'text-red-400',
  unknown: 'text-muted-foreground',
};

const subsystemDisplayNames: Record<string, string> = {
  'journal-storage': 'Journal Storage',
  'manifest-store': 'Manifest Store',
  'artifact-store': 'Artifact Store',
  'workflow-engine': 'Workflow Engine',
  'runner:claude-code': 'Claude Code',
  'runner:cursor': 'Cursor',
  'runner:gh-cli': 'GitHub CLI',
};

function humanizeSubsystem(name: string): string {
  return subsystemDisplayNames[name] ?? name;
}

export function HealthPage() {
  const { data: health, error } = useFetch(api.fetchHealth, {
    pollMs: 30_000,
    sseFilter: shouldRefreshHealth,
  });

  const [liveUptimeMs, setLiveUptimeMs] = useState<number | null>(null);
  const uptimeAnchorRef = useRef<{ serverMs: number; localTs: number } | null>(null);

  useEffect(() => {
    if (health?.uptimeMs != null) {
      uptimeAnchorRef.current = { serverMs: health.uptimeMs, localTs: Date.now() };
      setLiveUptimeMs(health.uptimeMs);
    }
  }, [health]);

  useEffect(() => {
    const timer = setInterval(() => {
      const anchor = uptimeAnchorRef.current;
      if (anchor) {
        setLiveUptimeMs(anchor.serverMs + (Date.now() - anchor.localTs));
      }
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (error) {
    return (
      <div className="mx-auto h-full max-w-7xl space-y-3 overflow-auto p-6">
        <h2 className="text-lg font-semibold text-foreground">System Health</h2>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">Failed to load health: {error}</p>
        </div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="mx-auto h-full max-w-7xl space-y-4 overflow-auto p-6">
        <h2 className="text-lg font-semibold text-foreground">System Health</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5">
              <div className="h-2.5 w-20 animate-pulse rounded bg-muted" />
              <div className="mt-3 h-6 w-24 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-16 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const normalizedStatus =
    health.status === 'ok' || health.status === 'healthy' ? 'healthy' : health.status;
  const statusDot = statusColors[normalizedStatus] ?? 'bg-muted-foreground/50';
  const statusText = statusTextColors[normalizedStatus] ?? 'text-muted-foreground';
  const statusLabel = normalizedStatus === 'healthy' ? 'Healthy' : health.status;

  function formatUptime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) {
      return `${String(d)}d ${String(h % 24)}h`;
    }
    if (h > 0) {
      return `${String(h)}h ${String(m % 60)}m`;
    }
    return `${String(m)}m ${String(s % 60)}s`;
  }

  return (
    <div className="mx-auto h-full max-w-7xl space-y-4 overflow-auto p-6">
      <h2 className="text-lg font-semibold text-foreground">System Health</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border-l-2 border-l-emerald-500/50 bg-card/80 p-5 ring-1 ring-white/[0.04] backdrop-blur-sm transition-all duration-200 hover:ring-white/[0.08] motion-safe:animate-fade-in-up">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            Overall Status
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                'size-3 rounded-full',
                statusDot,
                normalizedStatus === 'healthy' && 'shadow-[0_0_8px_2px] shadow-emerald-500/40',
              )}
            />
            <span className={cn('text-lg font-semibold', statusText)}>{statusLabel}</span>
          </div>
          {liveUptimeMs != null && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Uptime: {formatUptime(liveUptimeMs)}
            </p>
          )}
        </div>

        <div
          className="rounded-lg border-l-2 border-l-emerald-500/50 bg-card/80 p-5 ring-1 ring-white/[0.04] backdrop-blur-sm transition-all duration-200 hover:ring-white/[0.08] motion-safe:animate-fade-in-up"
          style={{ animationDelay: '60ms' }}
        >
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            API Server
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="size-3 rounded-full bg-emerald-500" />
            <span className="text-lg font-semibold text-emerald-400">Running</span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {health.host ?? '127.0.0.1'}:{String(health.port ?? 9100)}
          </p>
        </div>

        <div
          className="rounded-lg border-l-2 border-l-cyan-500/50 bg-card/80 p-5 ring-1 ring-white/[0.04] backdrop-blur-sm transition-all duration-200 hover:ring-white/[0.08] motion-safe:animate-fade-in-up"
          style={{ animationDelay: '120ms' }}
        >
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            SSE Clients
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{health.clients}</p>
          <p className="mt-1 text-xs text-muted-foreground">connected</p>
        </div>
      </div>

      {health.subsystems.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Subsystems</h3>
          <div className="space-y-2">
            {health.subsystems.map((s, i) => (
              <div
                key={s.name}
                className={cn(
                  'flex items-center gap-3 rounded-lg bg-card/80 px-4 py-3 ring-1 ring-white/[0.04] motion-safe:animate-fade-in-up',
                  s.status === 'unhealthy' && 'bg-red-500/5',
                  s.status === 'degraded' && 'bg-yellow-500/5',
                )}
                style={{ animationDelay: `${String(200 + i * 40)}ms` }}
              >
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    statusColors[s.status] ?? 'bg-muted-foreground/50',
                  )}
                />
                <span className="min-w-[7rem] text-sm font-medium text-foreground">
                  {humanizeSubsystem(s.name)}
                </span>
                <span className="flex-1 truncate text-xs text-muted-foreground">{s.message}</span>
                {s.version && (
                  <span className="shrink-0 text-2xs text-muted-foreground">{s.version}</span>
                )}
                {s.consecutiveFailures > 0 && (
                  <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-2xs font-medium text-red-400">
                    Failures: {s.consecutiveFailures}
                  </span>
                )}
                <span
                  className={cn(
                    'shrink-0 text-2xs font-medium',
                    statusTextColors[s.status] ?? 'text-muted-foreground',
                  )}
                >
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
