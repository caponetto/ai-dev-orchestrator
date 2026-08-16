// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../client';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  });
}

describe('api.fetchRuns', () => {
  it('fetches from /api/runs', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.fetchRuns();
    expect(mockFetch).toHaveBeenCalledWith('/api/runs');
  });
});

describe('api.fetchRunState', () => {
  it('fetches from /api/runs/:id/state', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        runId: 'r1',
        status: 'running',
        currentState: 'INTAKE',
        previousState: null,
        startedAt: '2026-01-01T00:00:00Z',
        stateEnteredAt: '2026-01-01T00:00:00Z',
        elapsedMs: 0,
        transitionCount: 0,
        isWaitingForHuman: false,
      }),
    );
    await api.fetchRunState('r1');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/state');
  });
});

describe('api.fetchHealth', () => {
  it('fetches from /api/health', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        status: 'healthy',
        clients: 0,
        subsystems: [],
        timestamp: '2026-01-01T00:00:00Z',
        uptimeMs: 100,
      }),
    );
    const result = await api.fetchHealth();
    expect(mockFetch).toHaveBeenCalledWith('/api/health');
    expect(result.status).toBe('healthy');
  });
});

describe('api.fetchWorkflow', () => {
  it('fetches from /api/runs/:id/workflow', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        runId: 'r1',
        states: [],
        transitions: [],
        currentState: 'INTAKE',
        visitedStates: [],
        stateHistory: [],
      }),
    );
    await api.fetchWorkflow('r1');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/workflow');
  });
});

describe('api.fetchArtifacts', () => {
  it('fetches from /api/runs/:id/artifacts', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        runId: 'r1',
        artifacts: [],
        totalCount: 0,
        totalSizeBytes: 0,
        byType: {},
      }),
    );
    await api.fetchArtifacts('r1');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/artifacts');
  });
});

describe('api.respondPermission', () => {
  it('posts to permissions endpoint', async () => {
    mockFetch.mockReturnValue(jsonResponse({ ok: true }));
    await api.respondPermission('r1', 'msg-1', true);
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/permissions/msg-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ granted: true }),
    });
  });
});

describe('api.respondClarification', () => {
  it('posts to clarifications endpoint', async () => {
    mockFetch.mockReturnValue(jsonResponse({ ok: true }));
    await api.respondClarification('r1', 'msg-2', 'yes');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/clarifications/msg-2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'yes' }),
    });
  });
});

describe('api.createRun', () => {
  it('posts prompt, workflow, and repoRoot', async () => {
    mockFetch.mockReturnValue(jsonResponse({ success: true, runId: 'new-1' }));
    const result = await api.createRun('do stuff', 'dev', '/repo');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'do stuff', workflow: 'dev', repoRoot: '/repo' }),
    });
    expect(result.success).toBe(true);
  });
});

describe('api.deleteRun', () => {
  it('sends DELETE request', async () => {
    mockFetch.mockReturnValue(jsonResponse({ success: true }));
    await api.deleteRun('r1');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1', { method: 'DELETE' });
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({}),
      }),
    );
    await expect(api.deleteRun('r1')).rejects.toThrow();
  });
});

describe('api.approve', () => {
  it('posts to approve endpoint', async () => {
    mockFetch.mockReturnValue(jsonResponse({ success: true }));
    await api.approve('r1', 'looks good');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'looks good' }),
    });
  });
});

describe('api.abort', () => {
  it('posts to abort endpoint with force and reason', async () => {
    mockFetch.mockReturnValue(jsonResponse({ success: true }));
    await api.abort('r1', 'timeout');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true, reason: 'timeout' }),
    });
  });
});

describe('api.fetchArtifactContent', () => {
  it('constructs correct path with version', async () => {
    mockFetch.mockReturnValue(jsonResponse({ content: '{}', contentType: 'json', sizeBytes: 2 }));
    await api.fetchArtifactContent('r1', 'spec', 'main', 2);
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/artifacts/spec/main/2/content');
  });
});

describe('api.updateSettings', () => {
  it('sends PUT request with patch', async () => {
    mockFetch.mockReturnValue(jsonResponse({ ok: true }));
    await api.updateSettings({ runtime: { logLevel: 'debug' } });
    expect(mockFetch).toHaveBeenCalledWith('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: expect.any(String) as unknown,
    });
  });
});

describe('api.reject', () => {
  it('posts to reject endpoint', async () => {
    mockFetch.mockReturnValue(jsonResponse({ success: true }));
    await api.reject('r1', 'not ready');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'not ready' }),
    });
  });
});

describe('api.retry', () => {
  it('posts to retry endpoint with empty body', async () => {
    mockFetch.mockReturnValue(jsonResponse({ success: true }));
    await api.retry('r1');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  });
});

describe('api.answer', () => {
  it('posts content to answer endpoint', async () => {
    mockFetch.mockReturnValue(jsonResponse({ success: true }));
    await api.answer('r1', 'the answer');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'the answer' }),
    });
  });
});

describe('api.fetchConfig', () => {
  it('fetches from /api/runs/:id/config', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        roles: [],
        iterationLimits: {},
        qualityGates: {
          specificationReadiness: { minCompletenessScore: 0.8 },
          implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
        },
        budget: { maxTokensPerRun: null },
      }),
    );
    await api.fetchConfig('r1');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/config');
  });
});

describe('api.fetchArtifactDetail', () => {
  it('constructs correct path with version', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        ref: { type: 'plan', name: 'main', version: 3, checksum: 'abc' },
        type: 'plan',
        name: 'main',
        currentVersion: 3,
        producedBy: 'planner',
        createdAt: '2026-01-01T00:00:00Z',
        sizeBytes: 200,
        versions: [],
        dependsOn: [],
        dependedOnBy: [],
      }),
    );
    await api.fetchArtifactDetail('r1', 'plan', 'main', 3);
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/artifacts/plan/main/3/detail');
  });
});

describe('api.fetchLiveRequests', () => {
  it('fetches from /api/runs/:id/live-requests', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.fetchLiveRequests('r1');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/live-requests');
  });
});

describe('api.fetchUsage', () => {
  it('fetches from /api/runs/:id/usage', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        runId: 'r1',
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalTokens: 1500,
        byRole: [],
      }),
    );
    await api.fetchUsage('r1');
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/r1/usage');
  });
});

describe('api.fetchWorkflows', () => {
  it('fetches from /api/workflows', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.fetchWorkflows();
    expect(mockFetch).toHaveBeenCalledWith('/api/workflows');
  });
});

describe('api.fetchWorkflowPreview', () => {
  it('fetches preview with encoded workflow name', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        runId: '',
        states: [],
        transitions: [],
        currentState: 'INTAKE',
        visitedStates: [],
        stateHistory: [],
      }),
    );
    await api.fetchWorkflowPreview('my workflow');
    expect(mockFetch).toHaveBeenCalledWith('/api/workflows/my%20workflow/preview');
  });
});

describe('api.fetchSettings', () => {
  it('fetches from /api/settings', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        roles: { assignments: {} },
        governance: {
          iterationLimits: { defaults: {} },
          qualityGates: {
            specificationReadiness: { minCompletenessScore: 0.8 },
            implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
          },
        },
        runtime: { logLevel: 'info' },
        availableRunners: [],
        modelsByRunner: {},
      }),
    );
    await api.fetchSettings();
    expect(mockFetch).toHaveBeenCalledWith('/api/settings');
  });
});

describe('api.fetchPermissionApprovals', () => {
  it('fetches from /api/permission-approvals', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.fetchPermissionApprovals();
    expect(mockFetch).toHaveBeenCalledWith('/api/permission-approvals');
  });
});

describe('api.deletePermissionApproval', () => {
  it('sends DELETE request for single approval', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 204,
        statusText: 'No Content',
      }),
    );
    await api.deletePermissionApproval('approval-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/permission-approvals/approval-1', {
      method: 'DELETE',
    });
  });
});

describe('api.clearPermissionApprovals', () => {
  it('sends DELETE request to clear all approvals', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 204,
        statusText: 'No Content',
      }),
    );
    await api.clearPermissionApprovals();
    expect(mockFetch).toHaveBeenCalledWith('/api/permission-approvals', { method: 'DELETE' });
  });
});

describe('api.fetchServerInfo', () => {
  it('fetches from /api/server-info', async () => {
    mockFetch.mockReturnValue(jsonResponse({ cwd: '/home/user/project' }));
    const result = await api.fetchServerInfo();
    expect(mockFetch).toHaveBeenCalledWith('/api/server-info');
    expect(result.cwd).toBe('/home/user/project');
  });
});

describe('error handling', () => {
  it('fetchJson throws on non-ok response', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      }),
    );
    try {
      await api.fetchHealth();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain('500');
    }
  });

  it('postJson extracts error message from body', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'Invalid prompt' }),
      }),
    );
    try {
      await api.createRun('', undefined, undefined);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain('Invalid prompt');
    }
  });

  it('postJson falls back to status text when body is not JSON', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      }),
    );
    try {
      await api.approve('r1');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain('502');
      expect((e as Error).message).toContain('Bad Gateway');
    }
  });

  it('deleteVoid throws on non-ok response', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      }),
    );
    try {
      await api.deletePermissionApproval('x');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain('403');
    }
  });
});
