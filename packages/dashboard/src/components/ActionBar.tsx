import type { ArtifactRef, DashboardWaitingContext } from '@ai-dev-orchestrator/schemas';
import { useState } from 'react';

import { api } from '../api/client';
import { formatArtifactDisplayName } from '../lib/humanize';
import { cn } from '../lib/utils';

import { AnswerForm } from './AnswerForm';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

function formatWaitingReason(ctx: DashboardWaitingContext): string {
  const state = ctx.requestingState
    .replaceAll(/[_-]/g, ' ')
    .toLowerCase()
    .replaceAll(/\b\w/g, (c) => c.toUpperCase());

  switch (ctx.reason) {
    case 'governance_escalation':
      return `Review iteration limit reached at ${state}. Approve to proceed or reject to abort.`;
    case 'token_budget_exceeded':
      return ctx.budgetExhaustion
        ? `Token budget exceeded (${String(ctx.budgetExhaustion.current)} / ${String(ctx.budgetExhaustion.limit)}). Approve to continue.`
        : 'Token budget exceeded. Approve to continue.';
    case 'clarification_needed':
      return `${state} needs clarification before continuing.`;
    case 'waiting_for_human':
      return `${state} requires human approval to proceed.`;
    default:
      return `${state} is waiting for your decision.`;
  }
}

export function ActionBar({
  runId,
  waitingContext,
  onAction,
  onSubmitting,
  onViewArtifact,
}: Readonly<{
  runId: string;
  waitingContext: DashboardWaitingContext;
  onAction: () => void;
  onSubmitting?: () => void;
  onViewArtifact?: (ref: ArtifactRef) => void;
}>) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'approved' | 'rejected' | null>(null);
  const [showRejectForm, setShowRejectForm] = useState(false);

  const isTextInput = waitingContext.requiredInput === 'text';

  async function handleApprove() {
    onSubmitting?.();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.approve(runId, message || undefined);
      if (result.success) {
        setOutcome('approved');
        onAction();
      } else {
        setError(result.error ?? 'Unknown error');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    onSubmitting?.();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.reject(runId, message || undefined);
      if (result.success) {
        setOutcome('rejected');
        onAction();
      } else {
        setError(result.error ?? 'Unknown error');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (outcome) {
    const isApproved = outcome === 'approved';
    return (
      <div
        className={cn(
          'rounded-lg border p-3 text-xs',
          isApproved ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5',
        )}
        data-testid="action-bar"
      >
        <div className="flex items-center gap-2">
          <span className={isApproved ? 'text-emerald-400' : 'text-red-400'}>
            {isApproved
              ? `✓ Approved ${waitingContext.requestingState.replaceAll('_', ' ').toLowerCase()}`
              : `✗ Rejected ${waitingContext.requestingState.replaceAll('_', ' ').toLowerCase()}`}
          </span>
          {message && <span className="text-muted-foreground">— {message}</span>}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
      role="alert"
      data-testid="action-bar"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-semibold text-amber-400">Action Required</span>
        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {waitingContext.requestingState
            .replaceAll(/[_-]/g, ' ')
            .toLowerCase()
            .replaceAll(/\b\w/g, (c) => c.toUpperCase())}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{formatWaitingReason(waitingContext)}</p>

      {waitingContext.presentedArtifacts.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {waitingContext.presentedArtifacts.map((a) => (
            <button
              key={`${a.type}-${a.name}-${String(a.version)}`}
              type="button"
              className="rounded bg-muted px-2 py-0.5 text-xs text-blue-400 hover:bg-muted/70 hover:text-blue-300"
              onClick={() => {
                onViewArtifact?.(a);
              }}
            >
              {formatArtifactDisplayName(a)}
            </button>
          ))}
        </div>
      )}

      {isTextInput ? (
        <AnswerForm
          runId={runId}
          reason={waitingContext.reason}
          requestingState={waitingContext.requestingState}
          onSuccess={onAction}
        />
      ) : (
        <div className="space-y-3">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {showRejectForm ? (
            <>
              <Textarea
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                }}
                placeholder="Reason for rejection..."
                rows={2}
                autoFocus
                aria-required="true"
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={submitting || !message.trim()}
                  onClick={() => void handleReject()}
                  title={message.trim() ? undefined : 'A reason is required to reject'}
                >
                  {submitting ? 'Processing...' : 'Confirm Rejection'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => {
                    setShowRejectForm(false);
                    setMessage('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={submitting}
                onClick={() => void handleApprove()}
                variant="success"
              >
                {submitting ? 'Processing...' : 'Approve'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={submitting}
                onClick={() => {
                  setShowRejectForm(true);
                }}
              >
                Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
