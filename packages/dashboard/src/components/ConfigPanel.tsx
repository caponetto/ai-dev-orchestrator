import type { RoleUsageView, RunConfigView } from '@ai-orchestrator/schemas';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { api } from '../api/client';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { formatTokens } from '../lib/format';
import { humanize } from '../lib/humanize';
import { cn } from '../lib/utils';

const RUNNER_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
};

function formatRunner(runner?: string): string {
  if (!runner) {
    return '—';
  }
  return RUNNER_LABELS[runner] ?? humanize(runner);
}

function HeaderWithInfo({
  label,
  description,
  align = 'right',
}: Readonly<{ label: string; description: ReactNode; align?: 'left' | 'right' }>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        align === 'right' ? 'justify-end' : 'justify-start',
      )}
    >
      {label}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help items-center">
              <Info className="size-3 text-muted-foreground/60 transition-colors hover:text-muted-foreground" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-60 text-xs">
            {description}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

function formatDuration(ms?: number): string {
  if (ms == null) {
    return '—';
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${String(minutes)}m ${String(seconds)}s` : `${String(minutes)}m`;
}

export function ConfigPanel({
  runId,
  roleUsage,
  workflowRoles,
}: Readonly<{
  runId: string;
  roleUsage?: readonly RoleUsageView[];
  workflowRoles?: readonly string[];
}>) {
  const [config, setConfig] = useState<RunConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .fetchConfig(runId)
      .then(setConfig)
      .catch(() => {
        setConfig(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [runId]);

  if (loading) {
    return (
      <div className="rounded-lg bg-card/80 p-4 ring-1 ring-white/[0.04]">
        <div className="space-y-3">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="rounded-lg bg-card/80 p-4 ring-1 ring-white/[0.04]">
        <p className="text-sm text-muted-foreground">Configuration not available</p>
      </div>
    );
  }

  const usageByRole = new Map(roleUsage?.map((r) => [r.role, r]));
  const activeRoleSet = workflowRoles ? new Set(workflowRoles) : undefined;
  const visibleRoles = activeRoleSet
    ? config.roles.filter((r) => activeRoleSet.has(r.role))
    : config.roles;

  return (
    <div className="rounded-lg bg-card/80 p-4 ring-1 ring-white/[0.04]">
      <div className="space-y-4">
        {visibleRoles.length > 0 && (
          <div>
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-background text-left text-2xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">
                      <HeaderWithInfo
                        label="Role"
                        description="The agent role assigned to this workflow state."
                        align="left"
                      />
                    </th>
                    <th className="px-3 py-1.5 font-medium">
                      <HeaderWithInfo
                        label="Runner"
                        description="The CLI backend used to execute the agent (e.g. Claude Code, Cursor)."
                        align="left"
                      />
                    </th>
                    <th className="px-3 py-1.5 font-medium">
                      <HeaderWithInfo
                        label="Model"
                        description="The LLM model assigned to this role."
                        align="left"
                      />
                    </th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      <HeaderWithInfo
                        label="Timeout"
                        description="Maximum wall-clock time before the agent is killed. Defaults to 10 minutes."
                      />
                    </th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      <HeaderWithInfo
                        label="Turns"
                        description="Maximum number of agentic tool-use turns. Only supported by claude-code runner."
                      />
                    </th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      <HeaderWithInfo
                        label="Max Tokens"
                        description="Maximum output tokens per model response."
                      />
                    </th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      <HeaderWithInfo
                        label="↓ In"
                        description="Total input tokens consumed by this role across all dispatches."
                      />
                    </th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      <HeaderWithInfo
                        label="↑ Out"
                        description="Total output tokens produced by this role across all dispatches."
                      />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {visibleRoles.map((a) => {
                    const usage = usageByRole.get(a.role);
                    return (
                      <tr key={a.role} className="transition-colors hover:bg-muted/50">
                        <td className="px-3 py-1.5 font-medium text-foreground">
                          {humanize(a.role)}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {formatRunner(a.runner)}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{a.model ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">
                          {formatDuration(a.timeoutMs)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">
                          {a.maxTurns ?? '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">
                          {a.maxTokens != null ? formatTokens(a.maxTokens) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-cyan-400/70">
                          {formatTokens(usage?.inputTokens ?? 0)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-emerald-400/70">
                          {formatTokens(usage?.outputTokens ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          {Object.keys(config.iterationLimits).length > 0 && (
            <div className="flex flex-col">
              <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Iteration Limits</h4>
              <div className="flex-1 divide-y divide-border rounded border border-border bg-background text-xs">
                {Object.entries(config.iterationLimits).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-muted-foreground">{humanize(key)}</span>
                    <span className="font-medium text-foreground">{String(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Object.entries(config.qualityGates).map(([gate, settings]) => (
            <div key={gate} className="flex flex-col">
              <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">{humanize(gate)}</h4>
              <div className="flex-1 divide-y divide-border rounded border border-border bg-background text-xs">
                {Object.entries(settings).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-muted-foreground">{humanize(k)}</span>
                    <span className="font-medium text-foreground">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
