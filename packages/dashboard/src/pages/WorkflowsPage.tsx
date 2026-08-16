import type { WorkflowStateView, WorkflowSummary } from '@ai-orchestrator/schemas';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import { WorkflowGraph } from '../components/WorkflowGraph';
import { useFetch } from '../hooks/use-fetch';
import { cn } from '../lib/utils';

function WorkflowListItem({
  workflow,
  isSelected,
  onSelect,
}: Readonly<{
  workflow: WorkflowSummary;
  isSelected: boolean;
  onSelect: (name: string) => void;
}>) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      className={cn(
        'flex w-full flex-col rounded-lg px-4 py-3 text-left transition-colors',
        isSelected
          ? 'border-l-2 border-l-primary bg-primary/10'
          : 'border-l-2 border-l-transparent hover:bg-accent/40',
      )}
      onClick={() => {
        onSelect(workflow.name);
      }}
    >
      <span className="text-sm font-medium text-foreground">{workflow.name}</span>
      <span className="mt-1 flex gap-2 text-2xs text-muted-foreground">
        <span>v{workflow.version}</span>
        <span>{workflow.stateCount} states</span>
      </span>
    </button>
  );
}

export function WorkflowsPage() {
  const { data: workflows, error } = useFetch(api.fetchWorkflows);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(searchParams.get('selected'));
  const [preview, setPreview] = useState<WorkflowStateView | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!workflows || workflows.length === 0) {
      return;
    }
    const match = selected && workflows.some((w) => w.name === selected);
    if (!match) {
      setSelected(workflows[0].name);
    }
  }, [workflows, selected]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    const current = searchParams.get('selected');
    if (current !== selected) {
      setSearchParams({ selected }, { replace: true });
    }
  }, [selected, searchParams, setSearchParams]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    void api
      .fetchWorkflowPreview(selected)
      .then(setPreview)
      .catch((e: unknown) => {
        setPreview(null);
        setPreviewError(e instanceof Error ? e.message : `Failed to load preview for ${selected}`);
      })
      .finally(() => {
        setPreviewLoading(false);
      });
  }, [selected]);

  const handleSelect = useCallback((name: string) => {
    setSelected(name);
  }, []);

  if (error) {
    return (
      <div className="mx-auto h-full max-w-7xl space-y-3 overflow-auto p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">Failed to load workflows: {error}</p>
        </div>
      </div>
    );
  }

  if (!workflows) {
    return (
      <div className="flex h-full flex-col p-6">
        <div className="flex flex-1 flex-col gap-4 lg:flex-row">
          <div className="w-full shrink-0 space-y-2 lg:w-[280px]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="mt-2 flex gap-2">
                  <div className="h-3 w-12 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-14 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
          <div className="min-h-[400px] flex-1" />
        </div>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">No workflows found</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div
          className="w-full shrink-0 space-y-1 overflow-auto lg:w-[280px]"
          role="listbox"
          aria-label="Workflow list"
        >
          {workflows.map((wf) => (
            <WorkflowListItem
              key={wf.name}
              workflow={wf}
              isSelected={selected === wf.name}
              onSelect={handleSelect}
            />
          ))}
        </div>

        <div className="min-h-[400px] flex-1" aria-live="polite">
          {previewLoading && (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {previewError && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-destructive">{previewError}</p>
            </div>
          )}
          {!previewLoading && !previewError && preview && (
            <WorkflowGraph workflow={preview} compact preview />
          )}
          {!previewLoading && !previewError && !preview && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">Select a workflow</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
