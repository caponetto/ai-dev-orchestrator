import type { RunStateView } from '@ai-orchestrator/schemas';
import { formatDuration } from '@ai-orchestrator/utils/formatters';
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { formatTokens } from '../lib/format';
import { cn } from '../lib/utils';

import { AbortDialog, RerunDialog, RetryDialog } from './run-header-dialogs';
import type { RerunContext } from './run-header-dialogs';
import { StatusBadge } from './StatusBadge';
import { TokenDisplay } from './TokenDisplay';
import { Button } from './ui/button';

export type { RerunContext } from './run-header-dialogs';

export function RunHeader({
  state,
  onAbort,
  onRetry,
  onRerun,
  tokenUsage,
  budgetSummary,
  rerunContext,
}: Readonly<{
  state: RunStateView;
  onAbort?: () => void;
  onRetry?: () => void;
  onRerun?: () => void;
  tokenUsage?: { totalInputTokens: number; totalOutputTokens: number };
  budgetSummary?: { totalTokens: number; configuredMaxTokens: number; exceeded: boolean };
  rerunContext?: RerunContext;
}>) {
  const [showAbortDialog, setShowAbortDialog] = useState(false);
  const [showRetryDialog, setShowRetryDialog] = useState(false);
  const [showRerunDialog, setShowRerunDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyRunId = useCallback(() => {
    void navigator.clipboard.writeText(state.runId).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    });
  }, [state.runId]);

  const isActive =
    state.status !== 'completed' &&
    state.status !== 'aborted' &&
    state.status !== 'failed' &&
    state.status !== 'interrupted';
  const [liveElapsedMs, setLiveElapsedMs] = useState(() =>
    isActive ? Date.now() - new Date(state.startedAt).getTime() : state.elapsedMs,
  );

  useEffect(() => {
    if (!isActive) {
      setLiveElapsedMs(state.elapsedMs);
      return;
    }
    const startTime = new Date(state.startedAt).getTime();
    setLiveElapsedMs(Date.now() - startTime);
    const id = setInterval(() => {
      setLiveElapsedMs(Date.now() - startTime);
    }, 1_000);
    return () => {
      clearInterval(id);
    };
  }, [isActive, state.startedAt, state.elapsedMs]);

  const canAbort =
    state.status !== 'completed' && state.status !== 'aborted' && state.status !== 'failed';
  const canRetry = state.status === 'aborted' || state.status === 'failed';
  const canRerun =
    rerunContext != null &&
    (state.status === 'completed' ||
      state.status === 'aborted' ||
      state.status === 'failed' ||
      state.status === 'interrupted');
  const hasTokenUsage =
    tokenUsage != null && (tokenUsage.totalInputTokens > 0 || tokenUsage.totalOutputTokens > 0);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-card/80 px-5 py-3 ring-1 ring-white/[0.04] backdrop-blur-sm">
      <div>
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Run</p>
        <div className="flex items-center gap-1.5">
          <p className="font-mono text-sm text-foreground">{state.runId}</p>
          <button
            type="button"
            onClick={handleCopyRunId}
            className="inline-flex items-center rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title="Copy run ID"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {state.repoRoot && (
        <>
          <div className="hidden h-8 w-px bg-white/[0.06] sm:block" />
          <div>
            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Context
            </p>
            <p className="text-sm text-foreground/90" title={state.repoRoot}>
              {state.repoRoot.replace(/\/$/, '').split('/').pop()}
            </p>
          </div>
        </>
      )}
      <div className="hidden h-8 w-px bg-white/[0.06] sm:block" />
      <div>
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Status
        </p>
        <div role="status" aria-live="polite">
          <StatusBadge status={state.status} />
        </div>
      </div>
      <div className="hidden h-8 w-px bg-white/[0.06] sm:block" />
      <div className="min-w-[5rem]">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Elapsed
        </p>
        <p className="text-sm tabular-nums text-foreground/90">{formatDuration(liveElapsedMs)}</p>
      </div>
      {tokenUsage && hasTokenUsage && (
        <>
          <div className="hidden h-8 w-px bg-white/[0.06] sm:block" />
          <div>
            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Tokens
            </p>
            <TokenDisplay
              input={tokenUsage.totalInputTokens}
              output={tokenUsage.totalOutputTokens}
            />
          </div>
        </>
      )}
      {budgetSummary && (
        <>
          <div className="hidden h-8 w-px bg-white/[0.06] sm:block" />
          <div className="min-w-[5rem]">
            <p className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Budget
            </p>
            <div className="relative h-1.5 w-16 rounded-full bg-muted">
              <div
                className={cn(
                  'h-1.5 rounded-full',
                  budgetSummary.exceeded
                    ? 'bg-red-500'
                    : budgetSummary.totalTokens / budgetSummary.configuredMaxTokens >= 0.8
                      ? 'bg-yellow-500'
                      : 'bg-gradient-to-r from-primary/80 to-primary',
                )}
                style={{
                  width: `${String(Math.min((budgetSummary.totalTokens / budgetSummary.configuredMaxTokens) * 100, 100))}%`,
                }}
              />
            </div>
            <span className="mt-0.5 block text-2xs tabular-nums text-muted-foreground">
              {formatTokens(budgetSummary.totalTokens)} /{' '}
              {formatTokens(budgetSummary.configuredMaxTokens)}
            </span>
          </div>
        </>
      )}
      {state.isWaitingForHuman &&
        state.waitingContext?.budgetExhaustion &&
        (budgetSummary ? budgetSummary.exceeded : true) && (
          <div
            role="status"
            aria-live="polite"
            className="rounded bg-red-500/20 px-3 py-1 text-xs font-medium text-red-400"
          >
            Budget exceeded: Tokens {String(state.waitingContext.budgetExhaustion.current)} /{' '}
            {String(
              budgetSummary?.configuredMaxTokens ?? state.waitingContext.budgetExhaustion.limit,
            )}
          </div>
        )}
      {state.isWaitingForHuman && !state.waitingContext?.budgetExhaustion && (
        <div
          role="status"
          aria-live="polite"
          className="rounded bg-yellow-500/20 px-3 py-1 text-xs font-medium text-yellow-400"
        >
          Awaiting human approval
        </div>
      )}
      {(canAbort || canRetry || canRerun) && (
        <div className="ml-auto flex gap-2">
          {canRerun && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowRerunDialog(true);
              }}
            >
              Rerun
            </Button>
          )}
          {canRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowRetryDialog(true);
              }}
            >
              Retry
            </Button>
          )}
          {canAbort && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setShowAbortDialog(true);
              }}
            >
              Abort
            </Button>
          )}
        </div>
      )}
      <AbortDialog
        runId={state.runId}
        open={showAbortDialog}
        onOpenChange={setShowAbortDialog}
        onAborted={() => {
          onAbort?.();
        }}
      />
      <RetryDialog
        runId={state.runId}
        open={showRetryDialog}
        onOpenChange={setShowRetryDialog}
        onRetried={() => {
          onRetry?.();
        }}
      />
      {rerunContext && (
        <RerunDialog
          context={rerunContext}
          open={showRerunDialog}
          onOpenChange={setShowRerunDialog}
          onRerun={() => {
            onRerun?.();
          }}
        />
      )}
    </div>
  );
}
