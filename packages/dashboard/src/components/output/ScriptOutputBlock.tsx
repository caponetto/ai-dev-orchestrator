import { FileCode2 } from 'lucide-react';

import { humanize } from '../../lib/humanize';
import { linkify } from '../../lib/linkify';

import { formatTime } from './output-utils';

export interface ScriptOutputBlockProps {
  readonly script: string;
  readonly state?: string;
  readonly status: 'running' | 'success' | 'failed';
  readonly message?: string;
  readonly stderr?: string;
  readonly timestamp?: string;
  readonly onViewScript?: (name: string) => void;
}

export function ScriptOutputBlock({
  script,
  state,
  status,
  message,
  stderr,
  timestamp,
  onViewScript,
}: ScriptOutputBlockProps) {
  const hasError = status === 'failed' && stderr && stderr.trim().length > 0;
  const time = timestamp ? formatTime(timestamp) : undefined;

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-cyan-400">
        <FileCode2 className="size-3.5 shrink-0" />
        <span className="font-bold">Script Runner</span>
        {state && <span className="text-yellow-400">@ {humanize(state)}</span>}
        <span className="text-muted-foreground/50">·</span>
        <button
          type="button"
          className="text-sky-400/80 hover:text-sky-300 hover:underline"
          onClick={() => {
            onViewScript?.(script);
          }}
        >
          {script}
        </button>
      </div>
      <div className="rounded-lg border-l-2 border-cyan-400 bg-card p-2.5 text-xs">
        {status === 'running' && (
          <div className="flex items-baseline whitespace-pre-wrap text-yellow-400">
            {time && (
              <span className="mr-2 shrink-0 font-mono text-2xs text-muted-foreground/60">
                {time}
              </span>
            )}
            <span>Running...</span>
          </div>
        )}
        {status === 'success' && message && (
          <div className="flex items-baseline whitespace-pre-wrap break-words text-foreground/80">
            {time && (
              <span className="mr-2 shrink-0 font-mono text-2xs text-muted-foreground/60">
                {time}
              </span>
            )}
            <span>{linkify(message)}</span>
          </div>
        )}
        {status === 'success' && !message && time && (
          <div className="flex items-baseline whitespace-pre-wrap text-emerald-400">
            <span className="mr-2 shrink-0 font-mono text-2xs text-muted-foreground/60">
              {time}
            </span>
            <span>Done</span>
          </div>
        )}
        {hasError && (
          <div className="flex items-baseline whitespace-pre-wrap break-all font-mono text-red-300/80">
            {time && (
              <span className="mr-2 shrink-0 font-mono text-2xs text-muted-foreground/60">
                {time}
              </span>
            )}
            <span>{stderr.trim()}</span>
          </div>
        )}
      </div>
    </div>
  );
}
