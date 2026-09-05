import type {
  ProjectSettingsView,
  RunSettings,
  WorkflowStateView,
  WorkflowSummary,
} from '@ai-dev-orchestrator/schemas';
import { ChevronUp, FolderOpen, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { EscalationSection } from '../components/settings/EscalationSection';
import { IterationLimitsSection } from '../components/settings/IterationLimitsSection';
import { PermissionApprovalsSection } from '../components/settings/PermissionApprovalsSection';
import { PermissionPolicySection } from '../components/settings/PermissionPolicySection';
import { QualityGatesSection } from '../components/settings/QualityGatesSection';
import { RoleAssignmentsSection } from '../components/settings/RoleAssignmentsSection';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { WorkflowGraph } from '../components/WorkflowGraph';
import { showError } from '../lib/toast';
import { cn } from '../lib/utils';

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'error'; message: string };

function toRunSettings(draft: ProjectSettingsView): RunSettings {
  return {
    roles: draft.roles,
    governance: draft.governance,
    runtime: draft.runtime,
  };
}

export function NewRunPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [repoRoot, setRepoRoot] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [loadingWorkflows, setLoadingWorkflows] = useState(true);
  const [preview, setPreview] = useState<WorkflowStateView | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const knownRunIdsRef = useRef<Set<string>>(new Set());
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [settings, setSettings] = useState<ProjectSettingsView | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ProjectSettingsView | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const settingsDirty =
    settings !== null &&
    settingsDraft !== null &&
    JSON.stringify(settings) !== JSON.stringify(settingsDraft);

  const applyPatch = useCallback((patch: Partial<ProjectSettingsView>) => {
    setSettingsDraft((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        ...patch,
        roles: patch.roles ? { ...prev.roles, ...patch.roles } : prev.roles,
        governance: patch.governance
          ? { ...prev.governance, ...patch.governance }
          : prev.governance,
        runtime: patch.runtime ? { ...prev.runtime, ...patch.runtime } : prev.runtime,
      };
    });
  }, []);

  useEffect(() => {
    void api
      .fetchServerInfo()
      .then((info) => {
        setRepoRoot((prev) => prev || info.cwd);
      })
      .catch((e: unknown) => {
        showError(e instanceof Error ? e.message : 'Failed to load server info');
      });
  }, []);

  useEffect(() => {
    void api
      .fetchRuns()
      .then((runs) => {
        knownRunIdsRef.current = new Set(runs.map((r) => r.runId));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void api
      .fetchSettings()
      .then((s) => {
        setSettings(s);
        setSettingsDraft(s);
      })
      .catch((e: unknown) => {
        showError(e instanceof Error ? e.message : 'Failed to load settings');
      });
  }, []);

  useEffect(() => {
    if (status.kind !== 'pending') {
      clearTimeout(pendingTimeoutRef.current);
      return;
    }

    pendingTimeoutRef.current = setTimeout(() => {
      setStatus({ kind: 'failed' });
    }, 15_000);

    const timer = setInterval(() => {
      void api.fetchRuns().then((runs) => {
        const newRun = runs.find((r) => !knownRunIdsRef.current.has(r.runId));
        if (newRun) {
          clearInterval(timer);
          void Promise.resolve(navigate(`/runs/${newRun.runId}`, { replace: true }));
        }
      });
    }, 500);

    return () => {
      clearInterval(timer);
      clearTimeout(pendingTimeoutRef.current);
    };
  }, [status.kind, navigate]);

  useEffect(() => {
    void api
      .fetchWorkflows()
      .then((wfs) => {
        setWorkflows(wfs);
        const defaultWf = wfs.find((w) => w.name === 'pr-review');
        const name = defaultWf?.name || wfs[0]?.name || '';
        setSelectedWorkflow(name);
      })
      .finally(() => {
        setLoadingWorkflows(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedWorkflow) {
      setPreview(null);
      return;
    }
    void api
      .fetchWorkflowPreview(selectedWorkflow)
      .then(setPreview)
      .catch(() => {
        setPreview(null);
      });
  }, [selectedWorkflow]);

  const handleCancel = useCallback(() => {
    void Promise.resolve(navigate('/runs', { replace: true }));
  }, [navigate]);

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setStatus({ kind: 'error', message: 'Prompt cannot be empty' });
      return;
    }
    setStatus({ kind: 'submitting' });
    try {
      const result = await api.createRun(
        trimmed,
        selectedWorkflow || undefined,
        repoRoot.trim() || undefined,
        settingsDraft ? toRunSettings(settingsDraft) : undefined,
      );
      if (result.success) {
        if (settingsDraft) {
          setSettings(settingsDraft);
        }
        if (result.runId) {
          void Promise.resolve(navigate(`/runs/${result.runId}`, { replace: true }));
        } else {
          setStatus({ kind: 'pending' });
        }
      } else {
        setStatus({ kind: 'error', message: result.error ?? 'Failed to create run' });
      }
    } catch (e: unknown) {
      setStatus({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to create run',
      });
    }
  };

  const isDisabled = status.kind === 'submitting' || status.kind === 'pending';

  if (status.kind === 'pending') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <div className="mb-3 h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-primary">Starting run...</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Waiting for the orchestrator to initialize
        </p>
      </div>
    );
  }

  if (status.kind === 'failed') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <p className="text-sm text-destructive">Run failed to start</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The orchestrator did not initialize in time. Check the terminal for errors.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={handleCancel}>
          Back to Runs
        </Button>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex h-full max-w-7xl flex-col overflow-hidden p-6 motion-safe:animate-fade-in">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">New Run</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Describe the task for the orchestrator to execute
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={isDisabled}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={isDisabled || !prompt.trim()}
          >
            {status.kind === 'submitting' ? 'Starting...' : 'Start Run'}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid shrink-0 grid-cols-2 gap-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Repository Context{' '}
              <span className="font-normal text-muted-foreground/60">(optional)</span>
            </label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  type="text"
                  value={repoRoot}
                  readOnly
                  placeholder="Defaults to system temp directory"
                  disabled={isDisabled}
                  className="cursor-default pr-8"
                />
                {repoRoot && !isDisabled && (
                  <button
                    type="button"
                    onClick={() => {
                      setRepoRoot('');
                    }}
                    className="absolute top-1/2 right-2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear repository context"
                    title="Clear"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={isDisabled || browsing}
                title="Browse for folder"
                aria-label="Browse for folder"
                onClick={() => {
                  setBrowsing(true);
                  fetch('/api/browse-directory')
                    .then((r) => r.json() as Promise<{ path: string | null }>)
                    .then((data) => {
                      if (data.path) {
                        setRepoRoot(data.path);
                      }
                    })
                    .catch(() => {})
                    .finally(() => {
                      setBrowsing(false);
                    });
                }}
              >
                {browsing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FolderOpen className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex shrink-0 flex-col">
            <Textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (status.kind === 'error') {
                  setStatus({ kind: 'idle' });
                }
              }}
              placeholder="Describe the task..."
              autoFocus
              disabled={isDisabled}
              aria-invalid={status.kind === 'error' ? 'true' : undefined}
              aria-describedby={status.kind === 'error' ? 'prompt-error' : undefined}
              className="min-h-24 flex-1 bg-card"
            />
            {status.kind === 'error' && (
              <p id="prompt-error" role="alert" className="text-xs text-destructive">
                {status.message}
              </p>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 w-1/2 shrink-0">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Workflow
              </label>
              {loadingWorkflows ? (
                <div className="flex h-9 items-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Select
                  value={selectedWorkflow}
                  onValueChange={setSelectedWorkflow}
                  disabled={isDisabled}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    {workflows.map((wf) => (
                      <SelectItem key={wf.name} value={wf.name}>
                        {wf.name} (v{wf.version})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {preview && (
              <div className="flex-1" style={{ minHeight: 300 }}>
                <WorkflowGraph workflow={preview} compact preview />
              </div>
            )}
          </div>
        </div>
      </div>

      {settingsDraft && (
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 z-40 bg-card/80 ring-1 ring-white/[0.04] backdrop-blur-sm transition-all',
            settingsOpen ? 'max-h-[60%]' : 'max-h-12',
          )}
        >
          <button
            type="button"
            onClick={() => {
              setSettingsOpen((o) => !o);
            }}
            className="flex w-full items-center gap-2 px-6 py-3 text-left"
            aria-expanded={settingsOpen}
            aria-controls="run-config-panel"
          >
            <ChevronUp
              className={cn(
                'size-3.5 text-muted-foreground transition-transform',
                settingsOpen && 'rotate-180',
              )}
            />
            <span className="text-sm font-medium text-foreground">Run Configuration</span>
            {settingsDirty && (
              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-2xs font-medium text-primary">
                modified
              </span>
            )}
          </button>

          {settingsOpen && (
            <div
              id="run-config-panel"
              className="space-y-4 overflow-auto px-6 pb-6"
              style={{ maxHeight: 'calc(60vh - 3rem)' }}
            >
              <RoleAssignmentsSection
                assignments={settingsDraft.roles.assignments}
                availableRunners={settingsDraft.availableRunners}
                modelsByRunner={settingsDraft.modelsByRunner}
                permissionPolicy={settingsDraft.governance.permissionPolicy}
                onChange={applyPatch}
              />

              <div className="grid gap-4 sm:grid-cols-[1fr_2fr_1fr]">
                <IterationLimitsSection
                  defaults={settingsDraft.governance.iterationLimits.defaults}
                  onChange={applyPatch}
                />

                <QualityGatesSection
                  gates={settingsDraft.governance.qualityGates}
                  onChange={applyPatch}
                />

                <EscalationSection
                  logLevel={settingsDraft.runtime.logLevel}
                  budget={settingsDraft.governance.budget}
                  permissionPolicy={settingsDraft.governance.permissionPolicy}
                  onChange={applyPatch}
                />
              </div>

              <PermissionPolicySection
                policy={settingsDraft.governance.permissionPolicy}
                onChange={applyPatch}
              />

              <PermissionApprovalsSection />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
