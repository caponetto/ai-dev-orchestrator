import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: Readonly<{
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg bg-card/80 px-6 py-16 text-center ring-1 ring-white/[0.04] backdrop-blur-sm motion-safe:animate-fade-in-up',
        className,
      )}
    >
      <div className="mb-4 rounded-full bg-muted/50 p-3">
        <Icon className="size-8 text-muted-foreground/60" />
      </div>
      <h3 className="text-sm font-semibold text-card-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
