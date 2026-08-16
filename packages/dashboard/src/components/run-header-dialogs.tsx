import { useState } from 'react';

import { api } from '../api/client';
import { linkify } from '../lib/linkify';
import { showError, showSuccess } from '../lib/toast';

import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Textarea } from './ui/textarea';

export interface RerunContext {
  readonly prompt: string;
  readonly workflow?: string;
  readonly repoRoot?: string;
}

export function AbortDialog({
  runId,
  open,
  onOpenChange,
  onAborted,
}: Readonly<{
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAborted: () => void;
}>) {
  const [reason, setReason] = useState('');
  const [aborting, setAborting] = useState(false);

  async function handleConfirm() {
    setAborting(true);
    try {
      const result = await api.abort(runId, reason.trim() || undefined);
      if (!result.success) {
        showError(result.error ?? 'Abort failed');
        return;
      }
      showSuccess('Run aborted');
      onOpenChange(false);
      onAborted();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Abort request failed');
    } finally {
      setAborting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abort Run</DialogTitle>
          <DialogDescription>
            Provide an optional reason for aborting this run. This will appear in the chat log.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
          placeholder="e.g. Plan doesn't address the security requirements"
          rows={3}
          autoFocus
          disabled={aborting}
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={aborting}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleConfirm()} disabled={aborting}>
            {aborting ? 'Aborting...' : 'Abort Run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RetryDialog({
  runId,
  open,
  onOpenChange,
  onRetried,
}: Readonly<{
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetried: () => void;
}>) {
  const [retrying, setRetrying] = useState(false);

  async function handleConfirm() {
    setRetrying(true);
    try {
      const result = await api.retry(runId);
      if (!result.success) {
        showError(result.error ?? 'Retry failed');
        return;
      }
      showSuccess('Run retried');
      onOpenChange(false);
      onRetried();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Retry request failed');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retry Run</DialogTitle>
          <DialogDescription>
            This will re-run the workflow from the state that caused the failure, carrying over all
            prior artifacts and progress.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={retrying}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={retrying}>
            {retrying ? 'Retrying...' : 'Retry Run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RerunDialog({
  context,
  open,
  onOpenChange,
  onRerun,
}: Readonly<{
  context: RerunContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRerun: () => void;
}>) {
  const [rerunning, setRerunning] = useState(false);

  async function handleConfirm() {
    setRerunning(true);
    try {
      const result = await api.createRun(context.prompt, context.workflow, context.repoRoot);
      if (!result.success) {
        showError(result.error ?? 'Rerun failed');
        return;
      }
      showSuccess('New run started');
      onOpenChange(false);
      onRerun();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Rerun request failed');
    } finally {
      setRerunning(false);
    }
  }

  const truncatedPrompt =
    context.prompt.length > 120 ? `${context.prompt.slice(0, 120)}…` : context.prompt;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rerun Workflow</DialogTitle>
          <DialogDescription>
            This will start a new run with the same prompt, workflow, and context.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs">
          <div>
            <span className="text-muted-foreground">Prompt: </span>
            <span className="text-foreground">{linkify(truncatedPrompt)}</span>
          </div>
          {context.workflow && (
            <div>
              <span className="text-muted-foreground">Workflow: </span>
              <span className="text-foreground">{context.workflow}</span>
            </div>
          )}
          {context.repoRoot && (
            <div>
              <span className="text-muted-foreground">Context: </span>
              <span className="text-foreground">{context.repoRoot}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={rerunning}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={rerunning}>
            {rerunning ? 'Starting...' : 'Rerun'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
