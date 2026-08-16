import { useState } from 'react';

import { cn } from '../../lib/utils';

import { Timestamp } from './line-renderers';
import { senderBorderColor, senderLabelColor } from './output-utils';

export type AbortVariant = 'aborted' | 'interrupted' | 'failed';

const VARIANT_COPY: Record<
  AbortVariant,
  { sender: 'human' | 'orchestrator'; title: string; colorClass: string }
> = {
  aborted: {
    sender: 'human',
    title: 'Aborted the run',
    colorClass: 'text-red-400',
  },
  interrupted: {
    sender: 'orchestrator',
    title: 'Run was interrupted',
    colorClass: 'text-orange-400',
  },
  failed: {
    sender: 'orchestrator',
    title: 'Run aborted',
    colorClass: 'text-red-400',
  },
};

export function AbortMessage({
  timestamp,
  reason,
  variant = 'aborted',
}: Readonly<{ timestamp?: string; reason: string; variant?: AbortVariant }>) {
  const [expanded, setExpanded] = useState(false);
  const { sender, title, colorClass } = VARIANT_COPY[variant];
  return (
    <div className="mb-3">
      <div
        className={cn('mb-1 flex items-baseline text-2xs font-medium', senderLabelColor[sender])}
      >
        <span>{sender === 'orchestrator' ? 'AI Dev Orchestrator' : 'Human'}</span>
      </div>
      <div className={cn('rounded-lg border-l-2 bg-card p-2.5 text-xs', senderBorderColor[sender])}>
        <div className={cn('flex items-baseline font-medium', colorClass)}>
          {timestamp && <Timestamp iso={timestamp} />}
          <span>{title}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setExpanded((v) => !v);
          }}
          className="mt-1 text-2xs text-muted-foreground hover:text-foreground/80"
        >
          {expanded ? '▼ Hide details' : '▶ Show details'}
        </button>
        {expanded && <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{reason}</div>}
      </div>
    </div>
  );
}
