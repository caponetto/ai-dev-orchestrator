import { memo } from 'react';

import { formatTokens } from '../lib/format';
import { cn } from '../lib/utils';

export const TokenDisplay = memo(function TokenDisplay({
  input,
  output,
  className,
}: Readonly<{ input: number; output: number; className?: string }>) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm tabular-nums', className)}>
      <span className="text-cyan-400/70" title="Input tokens">
        {formatTokens(input)} ↓
      </span>
      <span className="text-muted-foreground/30">|</span>
      <span className="text-emerald-400/70" title="Output tokens">
        {formatTokens(output)} ↑
      </span>
    </span>
  );
});
