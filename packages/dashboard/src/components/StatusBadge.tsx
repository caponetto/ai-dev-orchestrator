import { memo } from 'react';

import { cn } from '../lib/utils';

import { Badge } from './ui/badge';

const colors: Record<string, string> = {
  running: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  aborted: 'bg-red-500/15 text-red-400 border-red-500/25',
  failed: 'bg-red-500/15 text-red-400 border-red-500/25',
  paused: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  waiting: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  interrupted: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
};

const pulseStatuses = new Set(['running']);

export const StatusBadge = memo(function StatusBadge({ status }: { status: string }) {
  const color = colors[status] ?? 'bg-muted text-muted-foreground border-border';
  return (
    <Badge variant="outline" className={cn('gap-1.5', color)}>
      {pulseStatuses.has(status) && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full motion-safe:animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
      )}
      {status.toUpperCase()}
    </Badge>
  );
});
