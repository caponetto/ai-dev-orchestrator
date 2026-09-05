import type { ArtifactEntryView, ArtifactRef } from '@ai-dev-orchestrator/schemas';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ArtifactPanel } from '../components/ArtifactPanel';
const ArtifactViewer = lazy(() =>
  import('../components/ArtifactViewer').then((m) => ({ default: m.ArtifactViewer })),
);
import { ConfigPanel } from '../components/ConfigPanel';
import { AgentOutputPanel } from '../components/output';
import type { RerunContext } from '../components/RunHeader';
import { RunHeader } from '../components/RunHeader';
const ScriptViewer = lazy(() =>
  import('../components/ScriptViewer').then((m) => ({ default: m.ScriptViewer })),
);
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { WorkflowGraph } from '../components/WorkflowGraph';
import { useRunDetail } from '../hooks/use-run-detail';

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();

  const {
    runState,
    workflow,
    artifacts,
    configData,
    loading,
    error,
    isRunActive,
    liveUsage,
    enrichedWorkflow,
    agentGroups,
    agentStreamStatus,
    refreshRunData,
  } = useRunDetail(runId);

  const [viewingArtifact, setViewingArtifact] = useState<ArtifactEntryView | null>(null);
  const [viewingScript, setViewingScript] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'chat';

  const setActiveTab = useCallback(
    (tab: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (!searchParams.has('tab')) {
      setActiveTab('chat');
    }
  }, [searchParams, setActiveTab]);

  const handleViewArtifact = useCallback(
    (ref: ArtifactRef) => {
      const entry = artifacts?.artifacts.find(
        (a) => a.type === ref.type && a.name === ref.name && a.version === ref.version,
      );
      setViewingArtifact(
        entry ?? {
          ref,
          type: ref.type,
          name: ref.name,
          version: ref.version,
          producedBy: '',
          createdAt: '',
          sizeBytes: 0,
        },
      );
    },
    [artifacts],
  );

  const rerunContext = useMemo((): RerunContext | undefined => {
    const prompt = configData?.sources?.[0];
    if (!prompt) {
      return undefined;
    }
    return {
      prompt,
      workflow: configData.workflow,
      repoRoot: runState?.repoRoot,
    };
  }, [configData, runState?.repoRoot]);

  const handleRerun = useCallback(() => {
    void Promise.resolve(navigate('/runs', { replace: true }));
  }, [navigate]);

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-5 rounded-lg border border-border bg-card px-5 py-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-2.5 w-12 animate-pulse rounded bg-muted" />
              <div className="h-5 w-24 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
        <div className="flex gap-3 border-b border-border pb-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-7 w-16 animate-pulse rounded bg-muted" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col motion-safe:animate-fade-in">
      <h2 className="sr-only">Run {runId}</h2>
      {runState && (
        <div className="shrink-0 border-b border-border px-6 py-4">
          <RunHeader
            state={runState}
            onAbort={refreshRunData}
            onRetry={refreshRunData}
            onRerun={handleRerun}
            tokenUsage={liveUsage ?? undefined}
            budgetSummary={
              liveUsage?.budgetSummary?.configuredMaxTokens != null
                ? {
                    totalTokens: liveUsage.totalTokens,
                    configuredMaxTokens: liveUsage.budgetSummary.configuredMaxTokens,
                    exceeded: liveUsage.budgetSummary.budgetExceeded,
                  }
                : undefined
            }
            rerunContext={rerunContext}
          />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-6">
          <TabsList variant="line">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="workflow">Workflow</TabsTrigger>
            <TabsTrigger value="artifacts">
              Artifacts
              {artifacts && artifacts.artifacts.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-2xs tabular-nums text-primary">
                  {artifacts.artifacts.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="min-h-0 flex-1 overflow-hidden p-6">
          <AgentOutputPanel
            groups={agentGroups}
            status={agentStreamStatus}
            runId={runId}
            isRunActive={isRunActive}
            runStatus={runState?.status}
            currentState={runState?.currentState}
            waitingContext={runState?.isWaitingForHuman ? runState.waitingContext : undefined}
            onAction={refreshRunData}
            onViewArtifact={handleViewArtifact}
            onViewScript={setViewingScript}
            sources={configData?.sources}
            artifacts={artifacts?.artifacts}
          />
        </TabsContent>

        <TabsContent
          value="workflow"
          forceMount
          className="min-h-0 flex-1 overflow-auto"
          style={{ display: activeTab === 'workflow' ? undefined : 'none' }}
        >
          <div className="h-full">
            {enrichedWorkflow && (
              <WorkflowGraph
                workflow={enrichedWorkflow}
                stateEnteredAt={runState?.stateEnteredAt}
                roleAssignments={configData?.roles}
                visible={activeTab === 'workflow'}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="artifacts" className="min-h-0 flex-1 overflow-auto p-6">
          {artifacts ? (
            <ArtifactPanel data={artifacts} runId={runId} />
          ) : (
            <div className="text-sm text-muted-foreground">No artifacts available</div>
          )}
        </TabsContent>

        <TabsContent value="config" className="min-h-0 flex-1 overflow-auto p-6">
          {runId && (
            <ConfigPanel
              runId={runId}
              roleUsage={liveUsage?.byRole}
              workflowRoles={workflow?.states.flatMap((s) => s.roles ?? [])}
            />
          )}
        </TabsContent>
      </Tabs>

      {viewingArtifact && runId && (
        <Suspense fallback={null}>
          <ArtifactViewer
            runId={runId}
            artifact={viewingArtifact}
            onClose={() => {
              setViewingArtifact(null);
            }}
          />
        </Suspense>
      )}
      {viewingScript && (
        <Suspense fallback={null}>
          <ScriptViewer
            scriptName={viewingScript}
            onClose={() => {
              setViewingScript(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
