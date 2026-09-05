import type { ArtifactRef } from '@ai-dev-orchestrator/schemas';
import { Package } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useMemo } from 'react';

import type { DispatchArtifacts } from '../../lib/dispatch-artifacts';

import {
  deduplicateRefs,
  formatArtifactLabel,
  formatTokens,
  type LineTokenUsage,
} from './output-utils';

export function TokenUsageInline({ usage }: Readonly<{ usage: LineTokenUsage }>) {
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0) {
    return null;
  }
  return (
    <span className="font-mono">
      <span className="text-cyan-400/70">{formatTokens(usage.inputTokens)} ↓</span>
      <span className="mx-0.5 text-muted-foreground/60">|</span>
      <span className="text-emerald-400/70">{formatTokens(usage.outputTokens)} ↑</span>
    </span>
  );
}

export function ArtifactsPopover({
  artifacts,
  onViewArtifact,
}: Readonly<{
  artifacts: DispatchArtifacts;
  onViewArtifact?: (ref: ArtifactRef) => void;
}>) {
  const dedupedInputs = useMemo(() => deduplicateRefs(artifacts.inputs), [artifacts.inputs]);
  const dedupedOutputs = useMemo(() => deduplicateRefs(artifacts.outputs), [artifacts.outputs]);

  return (
    <span className="inline-flex items-center">
      <PopoverPrimitive.Root>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
            title="View artifacts"
            aria-label="View artifacts"
          >
            <Package className="size-3" />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="bottom"
            align="start"
            sideOffset={4}
            className="z-50 w-72 max-h-64 overflow-y-auto rounded-md border border-border bg-card p-2.5 text-[11px] shadow-xl"
          >
            <div className="mb-2">
              <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                Input
              </div>
              {dedupedInputs.length === 0 ? (
                <div className="text-muted-foreground/60">None</div>
              ) : (
                <ul className="space-y-1">
                  {dedupedInputs.map((ref) => (
                    <li key={`${ref.type}:${ref.name}:v${String(ref.version)}`}>
                      <PopoverPrimitive.Close asChild>
                        <button
                          type="button"
                          onClick={() => {
                            onViewArtifact?.(ref);
                          }}
                          className="text-left text-sky-400 hover:text-sky-300 hover:underline"
                        >
                          {formatArtifactLabel(ref)}
                        </button>
                      </PopoverPrimitive.Close>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                Output
              </div>
              {dedupedOutputs.length === 0 ? (
                <div className="text-muted-foreground/60">Not produced yet</div>
              ) : (
                <ul className="space-y-1">
                  {dedupedOutputs.map((ref) => (
                    <li key={`${ref.type}:${ref.name}:v${String(ref.version)}`}>
                      <PopoverPrimitive.Close asChild>
                        <button
                          type="button"
                          onClick={() => {
                            onViewArtifact?.(ref);
                          }}
                          className="text-left text-sky-400 hover:text-sky-300 hover:underline"
                        >
                          {formatArtifactLabel(ref)}
                        </button>
                      </PopoverPrimitive.Close>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </span>
  );
}
