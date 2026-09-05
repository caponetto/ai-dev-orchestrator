import type { UsageBreakdownView } from '@ai-dev-orchestrator/schemas';

import { cn } from '../lib/utils';

function ProgressBar({
  current,
  max,
  exceeded,
  thresholds,
  crossedThresholds,
}: Readonly<{
  current: number;
  max: number;
  exceeded: boolean;
  thresholds?: readonly number[];
  crossedThresholds?: readonly number[];
}>) {
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const crossedSet = new Set(crossedThresholds);
  return (
    <div className="relative h-2 w-full rounded-full bg-muted">
      <div
        className={cn(
          'h-2 rounded-full',
          exceeded ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-emerald-500',
        )}
        style={{ width: `${String(pct)}%` }}
      />
      {thresholds?.map((t) => (
        <div
          key={t}
          className={cn(
            'absolute top-[-1px] h-[10px] w-[2px] rounded-sm',
            crossedSet.has(t) ? 'bg-yellow-400' : 'bg-muted-foreground/30',
          )}
          style={{ left: `${String(Math.min(t * 100, 100))}%` }}
        />
      ))}
    </div>
  );
}

function ThresholdLabels({
  thresholds,
  crossedThresholds,
}: Readonly<{
  thresholds: readonly number[];
  crossedThresholds?: readonly number[];
}>) {
  const crossedSet = new Set(crossedThresholds);
  return (
    <div className="mt-1.5 text-2xs text-muted-foreground">
      <span className="text-muted-foreground/80">Alerts: </span>
      {thresholds.map((t, i) => {
        const crossed = crossedSet.has(t);
        return (
          <span key={t}>
            {i > 0 && <span className="mx-1">&middot;</span>}
            <span className={crossed ? 'text-yellow-400' : ''}>
              {String(Math.round(t * 100))}%{crossed ? ' ✓' : ''}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function BudgetPanel({ data }: Readonly<{ data: UsageBreakdownView }>) {
  const bs = data.budgetSummary;
  if (!bs?.configuredMaxTokens) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">Budget</h3>
        {bs.budgetExceeded && (
          <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
            Exceeded
          </span>
        )}
      </div>

      <div className="space-y-3 text-xs">
        <div>
          <div className="mb-1 flex justify-between text-muted-foreground">
            <span>Tokens</span>
            <span className="text-foreground">
              {data.totalTokens.toLocaleString()} / {bs.configuredMaxTokens.toLocaleString()}
            </span>
          </div>
          <ProgressBar
            current={data.totalTokens}
            max={bs.configuredMaxTokens}
            exceeded={bs.budgetExceeded}
            thresholds={bs.alertThresholds}
            crossedThresholds={bs.crossedThresholds}
          />
          {bs.alertThresholds && bs.alertThresholds.length > 0 && (
            <ThresholdLabels
              thresholds={bs.alertThresholds}
              crossedThresholds={bs.crossedThresholds}
            />
          )}
        </div>
      </div>
    </div>
  );
}
