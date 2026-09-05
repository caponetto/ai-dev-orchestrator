import type {
  ArtifactContentView,
  ArtifactDetailView,
  ArtifactInventoryView,
  DashboardActionResult,
  HealthResponse,
  LiveRequestView,
  PermissionApprovalEntry,
  ProjectSettingsView,
  RunConfigView,
  RunSettings,
  RunStateView,
  RunSummaryView,
  UsageBreakdownView,
  WorkflowStateView,
  WorkflowSummary,
  SchemaLike,
} from '@ai-dev-orchestrator/schemas';
import {
  artifactContentViewSchema,
  artifactDetailViewSchema,
  artifactInventoryViewSchema,
  dashboardActionResultSchema,
  healthResponseSchema,
  liveRequestViewArraySchema,
  permissionApprovalEntryArraySchema,
  projectSettingsViewSchema,
  runConfigViewSchema,
  runStateViewSchema,
  runSummaryViewArraySchema,
  safeParseResponse,
  usageBreakdownViewSchema,
  workflowStateViewSchema,
  workflowSummaryArraySchema,
} from '@ai-dev-orchestrator/schemas';

function extractErrorMessage(errorBody: unknown): string | undefined {
  if (typeof errorBody === 'object' && errorBody !== null && 'error' in errorBody) {
    const msg = errorBody.error;
    if (typeof msg === 'string') {
      return msg;
    }
  }
  return undefined;
}

async function mutateJson<T>(
  method: string,
  path: string,
  body: unknown,
  schema?: SchemaLike<T>,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${String(res.status)} ${res.statusText}`;
    try {
      message = extractErrorMessage(await res.json()) ?? message;
    } catch {
      // response wasn't JSON, keep status text
    }
    throw new Error(message);
  }
  const json: unknown = await res.json();
  if (schema) {
    return safeParseResponse(schema, json);
  }
  return json as T;
}

function postJson<T>(path: string, body: unknown, schema?: SchemaLike<T>): Promise<T> {
  return mutateJson('POST', path, body, schema);
}

function putJson<T>(path: string, body: unknown, schema?: SchemaLike<T>): Promise<T> {
  return mutateJson('PUT', path, body, schema);
}

async function deleteJson<T>(path: string, schema?: SchemaLike<T>): Promise<T> {
  const res = await fetch(path, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`${String(res.status)} ${res.statusText}`);
  }
  const json: unknown = await res.json();
  if (schema) {
    return safeParseResponse(schema, json);
  }
  return json as T;
}

async function deleteVoid(path: string): Promise<void> {
  const res = await fetch(path, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`${String(res.status)} ${res.statusText}`);
  }
}

async function fetchJson<T>(path: string, schema?: SchemaLike<T>): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`${String(res.status)} ${res.statusText}`);
  }
  const json: unknown = await res.json();
  if (schema) {
    return safeParseResponse(schema, json);
  }
  return json as T;
}

export const api = {
  fetchRuns: () => fetchJson<RunSummaryView[]>('/api/runs', runSummaryViewArraySchema),
  fetchRunState: (runId: string) =>
    fetchJson<RunStateView>(`/api/runs/${runId}/state`, runStateViewSchema),
  fetchWorkflow: (runId: string) =>
    fetchJson<WorkflowStateView>(`/api/runs/${runId}/workflow`, workflowStateViewSchema),
  fetchArtifacts: (runId: string) =>
    fetchJson<ArtifactInventoryView>(`/api/runs/${runId}/artifacts`, artifactInventoryViewSchema),
  fetchUsage: (runId: string) =>
    fetchJson<UsageBreakdownView>(`/api/runs/${runId}/usage`, usageBreakdownViewSchema),
  fetchHealth: () => fetchJson<HealthResponse>('/api/health', healthResponseSchema),
  fetchLiveRequests: (runId: string) =>
    fetchJson<LiveRequestView[]>(`/api/runs/${runId}/live-requests`, liveRequestViewArraySchema),
  respondPermission: (runId: string, messageId: string, granted: boolean) =>
    postJson<{ ok: boolean }>(`/api/runs/${runId}/permissions/${messageId}`, { granted }),
  respondClarification: (runId: string, messageId: string, answer: string) =>
    postJson<{ ok: boolean }>(`/api/runs/${runId}/clarifications/${messageId}`, { answer }),
  fetchConfig: (runId: string) =>
    fetchJson<RunConfigView>(`/api/runs/${runId}/config`, runConfigViewSchema),
  fetchArtifactContent: (runId: string, type: string, name: string, version: number) =>
    fetchJson<ArtifactContentView>(
      `/api/runs/${runId}/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/${String(version)}/content`,
      artifactContentViewSchema,
    ),
  fetchArtifactDetail: (runId: string, type: string, name: string, version: number) =>
    fetchJson<ArtifactDetailView>(
      `/api/runs/${runId}/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/${String(version)}/detail`,
      artifactDetailViewSchema,
    ),
  fetchScriptContent: (name: string) =>
    fetchJson<{ content: string; contentType: string }>(
      `/api/scripts/${encodeURIComponent(name)}/content`,
    ),
  approve: (runId: string, message?: string) =>
    postJson<DashboardActionResult>(
      `/api/runs/${runId}/approve`,
      { message },
      dashboardActionResultSchema,
    ),
  reject: (runId: string, message?: string) =>
    postJson<DashboardActionResult>(
      `/api/runs/${runId}/reject`,
      { message },
      dashboardActionResultSchema,
    ),
  abort: (runId: string, reason?: string) =>
    postJson<DashboardActionResult>(
      `/api/runs/${runId}/abort`,
      { force: true, reason },
      dashboardActionResultSchema,
    ),
  retry: (runId: string) =>
    postJson<DashboardActionResult>(`/api/runs/${runId}/retry`, {}, dashboardActionResultSchema),
  answer: (runId: string, content: string) =>
    postJson<DashboardActionResult>(
      `/api/runs/${runId}/answer`,
      { content },
      dashboardActionResultSchema,
    ),
  deleteRun: (runId: string) =>
    deleteJson<DashboardActionResult>(`/api/runs/${runId}`, dashboardActionResultSchema),
  createRun: (prompt: string, workflow?: string, repoRoot?: string, runSettings?: RunSettings) =>
    postJson<DashboardActionResult & { runId?: string }>(
      '/api/runs',
      { prompt, workflow, repoRoot, runSettings },
      dashboardActionResultSchema,
    ),
  fetchWorkflows: () => fetchJson<WorkflowSummary[]>('/api/workflows', workflowSummaryArraySchema),
  fetchWorkflowPreview: (name: string) =>
    fetchJson<WorkflowStateView>(
      `/api/workflows/${encodeURIComponent(name)}/preview`,
      workflowStateViewSchema,
    ),
  fetchSettings: () => fetchJson<ProjectSettingsView>('/api/settings', projectSettingsViewSchema),
  updateSettings: (patch: Partial<ProjectSettingsView>) =>
    putJson<{ ok: boolean; error?: string }>('/api/settings', patch),
  fetchPermissionApprovals: () =>
    fetchJson<PermissionApprovalEntry[]>(
      '/api/permission-approvals',
      permissionApprovalEntryArraySchema,
    ),
  deletePermissionApproval: (id: string) => deleteVoid(`/api/permission-approvals/${id}`),
  clearPermissionApprovals: () => deleteVoid('/api/permission-approvals'),
  fetchServerInfo: () => fetchJson<{ cwd: string; initialized?: boolean }>('/api/server-info'),
};
