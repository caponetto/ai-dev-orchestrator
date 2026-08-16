import type { HealthResponse } from '@ai-orchestrator/schemas';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { SseStatus } from '../hooks/use-event-stream';
import { useFetch } from '../hooks/use-fetch';
import { shouldRefreshHealth } from '../lib/refresh-triggers';
import { cn } from '../lib/utils';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

export type CompositeStatus =
  'healthy' | 'connected' | 'degraded' | 'reconnecting' | 'unhealthy' | 'disconnected';

const statusConfig: Record<CompositeStatus, { color: string; label: string }> = {
  healthy: { color: 'bg-emerald-500', label: 'Healthy' },
  connected: { color: 'bg-emerald-500', label: 'Connected' },
  degraded: { color: 'bg-yellow-500 animate-pulse', label: 'Degraded' },
  reconnecting: { color: 'bg-yellow-500 animate-pulse', label: 'Reconnecting' },
  unhealthy: { color: 'bg-red-500', label: 'Unhealthy' },
  disconnected: { color: 'bg-red-500', label: 'Disconnected' },
};

export function computeCompositeStatus(
  sseStatus: SseStatus,
  health: HealthResponse | null,
): CompositeStatus {
  if (sseStatus === 'disconnected') {
    return 'disconnected';
  }
  if (sseStatus === 'reconnecting') {
    return 'reconnecting';
  }

  if (!health) {
    return 'healthy';
  }

  const normalized =
    health.status === 'ok' || health.status === 'healthy' ? 'healthy' : health.status;

  if (normalized === 'unhealthy') {
    return 'unhealthy';
  }
  if (normalized === 'degraded') {
    return 'degraded';
  }
  return 'healthy';
}

function sseLabel(sseStatus: SseStatus): string {
  if (sseStatus === 'connected') {
    return 'Connected';
  }
  if (sseStatus === 'reconnecting') {
    return 'Reconnecting';
  }
  return 'Disconnected';
}

function buildTooltipText(sseStatus: SseStatus, health: HealthResponse | null): string {
  if (sseStatus === 'disconnected') {
    return 'Disconnected';
  }

  const ssePart = `SSE: ${sseLabel(sseStatus)}`;

  if (!health) {
    return ssePart;
  }

  const troubled = health.subsystems.filter(
    (s) => s.status === 'degraded' || s.status === 'unhealthy',
  );

  if (troubled.length === 0) {
    return ssePart;
  }

  const normalized =
    health.status === 'ok' || health.status === 'healthy' ? 'Healthy' : health.status;

  return `${ssePart} · ${normalized} — ${troubled.map((s) => s.name).join(', ')}`;
}

export function SystemStatusIndicator({
  sseStatus,
  dotOnly,
}: {
  readonly sseStatus: SseStatus;
  readonly dotOnly?: boolean;
}) {
  const { data: health } = useFetch(api.fetchHealth, {
    pollMs: 60_000,
    sseFilter: shouldRefreshHealth,
  });

  const composite = computeCompositeStatus(sseStatus, health);
  const { color, label } = statusConfig[composite];
  const tooltipText = buildTooltipText(sseStatus, health);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/health"
            className={cn(
              'flex items-center text-xs text-muted-foreground transition-colors hover:text-foreground',
              dotOnly ? 'justify-center' : 'gap-2',
            )}
            role="status"
            aria-live="polite"
            aria-label={tooltipText}
          >
            <span
              className={cn(
                'flex shrink-0 items-center justify-center',
                dotOnly ? 'size-4' : 'size-3.5',
              )}
              aria-hidden="true"
            >
              <span className={cn('h-2 w-2 rounded-full', color)} />
            </span>
            {!dotOnly && label}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
