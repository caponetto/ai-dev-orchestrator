// @vitest-environment jsdom
import type {
  ArtifactInventoryView,
  DashboardEvent,
  RunConfigView,
  RunStateView,
  UsageBreakdownView,
  WorkflowStateView,
} from '@ai-orchestrator/schemas';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DispatchGroup } from '../../hooks/use-agent-stream';
import { RunDetailPage } from '../RunDetailPage';

type AgentStreamMockResult = {
  groups: Map<string, DispatchGroup>;
  status: 'connected' | 'reconnecting' | 'disconnected';
};

type EventStreamMockResult = {
  events: DashboardEvent[];
  status: 'connected' | 'reconnecting' | 'disconnected';
  clearEvents: () => void;
};

const { mockUseAgentStream, mockUseEventStream } = vi.hoisted(() => ({
  mockUseAgentStream: vi.fn<(runId?: string, active?: boolean) => AgentStreamMockResult>(),
  mockUseEventStream: vi.fn<(runId?: string) => EventStreamMockResult>(),
}));

vi.mock('../../hooks/use-event-stream', () => ({
  useEventStream: (runId?: string) => mockUseEventStream(runId),
}));

vi.mock('../../hooks/use-agent-stream', () => ({
  useAgentStream: (runId?: string, active?: boolean) => mockUseAgentStream(runId, active),
}));

const runState: RunStateView = {
  runId: 'run-live-123',
  status: 'running',
  currentState: 'INTAKE',
  previousState: null,
  startedAt: '2026-01-01T10:00:00Z',
  stateEnteredAt: '2026-01-01T10:00:00Z',
  elapsedMs: 2000,
  transitionCount: 0,
  isWaitingForHuman: false,
};

const workflow: WorkflowStateView = {
  runId: 'run-live-123',
  currentState: 'INTAKE',
  visitedStates: ['INTAKE'],
  stateHistory: ['INTAKE'],
  states: [
    {
      id: 'INTAKE',
      type: 'action',
      label: 'INTAKE',
      visited: true,
      current: true,
      timeSpentMs: 0,
      visitCount: 1,
    },
    {
      id: 'DONE',
      type: 'terminal',
      label: 'DONE',
      visited: false,
      current: false,
      timeSpentMs: 0,
      visitCount: 0,
    },
  ],
  transitions: [
    { from: 'INTAKE', to: 'DONE', trigger: 'completion', traversed: false, traversalCount: 0 },
  ],
};

const artifacts: ArtifactInventoryView = {
  runId: 'run-live-123',
  artifacts: [],
  totalCount: 0,
  totalSizeBytes: 0,
  byType: {},
};

const usage: UsageBreakdownView = {
  runId: 'run-live-123',
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  byRole: [],
};

const config: RunConfigView = {
  roles: [],
  iterationLimits: {},
  qualityGates: {
    specificationReadiness: { minCompletenessScore: 0 },
    implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 0 },
  },
  budget: {
    maxTokensPerRun: null,
  },
};

const streamedGroups: Map<string, DispatchGroup> = new Map([
  [
    'dispatch-1',
    {
      dispatchId: 'dispatch-1',
      roleId: 'requirements_analyst',
      stateId: 'REFINEMENT',
      lines: [
        {
          runId: 'run-live-123',
          stateId: 'REFINEMENT',
          roleId: 'requirements_analyst',
          dispatchId: 'dispatch-1',
          timestamp: '2026-01-01T10:00:02Z',
          type: 'stdout',
          content: 'hello from agent',
        },
      ],
    },
  ],
]);

let stateRequests = 0;
let workflowRequests = 0;

const server = setupServer(
  http.get('/api/runs/:runId/state', () => {
    stateRequests += 1;
    if (stateRequests === 1) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(runState);
  }),
  http.get('/api/runs/:runId/workflow', () => {
    workflowRequests += 1;
    if (workflowRequests === 1) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(workflow);
  }),
  http.get('/api/runs/:runId/artifacts', () => HttpResponse.json(artifacts)),
  http.get('/api/runs/:runId/usage', () => HttpResponse.json(usage)),
  http.get('/api/runs/:runId/live-requests', () => HttpResponse.json([])),
  http.get('/api/runs/:runId/config', () => HttpResponse.json(config)),
);

const originalConsoleError = console.error;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Received NaN')) {
      return;
    }
    originalConsoleError.call(console, ...args);
  };
});

beforeEach(() => {
  mockUseAgentStream.mockImplementation((_runId?: string, active = true) => ({
    groups: active ? streamedGroups : new Map<string, DispatchGroup>(),
    status: 'connected',
  }));
  mockUseEventStream.mockReturnValue({
    events: [],
    status: 'connected',
    clearEvents: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  stateRequests = 0;
  workflowRequests = 0;
  mockUseAgentStream.mockReset();
  mockUseEventStream.mockReset();
});

afterAll(() => {
  server.close();
  console.error = originalConsoleError;
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/runs/run-live-123']}>
      <Routes>
        <Route path="/runs/:runId" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RunDetailPage', () => {
  it('recovers when live detail endpoints become available after the first fetch', async () => {
    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    expect(stateRequests).toBeGreaterThan(1);
    expect(workflowRequests).toBeGreaterThan(1);
  });

  it('refreshes artifact data automatically while a run is active', async () => {
    let artifactRequests = 0;

    server.use(
      http.get('/api/runs/:runId/state', () => HttpResponse.json(runState)),
      http.get('/api/runs/:runId/workflow', () => HttpResponse.json(workflow)),
      http.get('/api/runs/:runId/artifacts', () => {
        artifactRequests += 1;
        if (artifactRequests <= 3) {
          return HttpResponse.json(artifacts);
        }
        return HttpResponse.json({
          runId: 'run-live-123',
          artifacts: [
            {
              ref: { type: 'plan', name: 'execution-plan', version: 1, checksum: 'abc123' },
              type: 'plan',
              name: 'execution-plan',
              version: 1,
              producedBy: 'planner',
              createdAt: '2026-01-01T10:00:03Z',
              sizeBytes: 256,
            },
          ],
          totalCount: 1,
          totalSizeBytes: 256,
          byType: { plan: 1 },
        } satisfies ArtifactInventoryView);
      }),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );
    await waitFor(
      () => {
        const artifactsTab = screen.getByRole('tab', { name: /Artifacts/i });
        expect(artifactsTab.textContent).toContain('1');
      },
      { timeout: 8_000 },
    );
    expect(artifactRequests).toBeGreaterThan(1);
  }, 15_000);

  it('does not keep refetching workflow for the same historical state event', async () => {
    workflowRequests = 0;

    server.use(
      http.get('/api/runs/:runId/state', () =>
        HttpResponse.json({ ...runState, status: 'completed' } satisfies RunStateView),
      ),
      http.get('/api/runs/:runId/workflow', () => {
        workflowRequests += 1;
        return HttpResponse.json(workflow);
      }),
      http.get('/api/runs/:runId/events', () =>
        HttpResponse.json([
          {
            type: 'state_changed',
            timestamp: '2026-01-01T10:00:02Z',
            runId: 'run-live-123',
            data: { stateId: 'REFINEMENT' },
          },
        ]),
      ),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });

    const stableCount = workflowRequests;

    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });

    expect(stableCount).toBeLessThanOrEqual(8);
    expect(workflowRequests).toBe(stableCount);
  });

  it('keeps agent output visible when reopening a non-active run', async () => {
    server.use(
      http.get('/api/runs/:runId/state', () =>
        HttpResponse.json({
          ...runState,
          status: 'completed',
        } satisfies RunStateView),
      ),
      http.get('/api/runs/:runId/workflow', () => HttpResponse.json(workflow)),
      http.get('/api/runs/:runId/events', () => HttpResponse.json([])),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    await waitFor(
      () => {
        expect(screen.getByText('Chat')).toBeTruthy();
      },
      { timeout: 5_000 },
    );
    expect(screen.getByText('hello from agent')).toBeTruthy();
  });

  it('shows error state when no data is found for the run', async () => {
    server.use(
      http.get('/api/runs/:runId/state', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/runs/:runId/workflow', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/runs/:runId/artifacts', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/runs/:runId/usage', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/runs/:runId/config', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/runs/:runId/live-requests', () => new HttpResponse(null, { status: 404 })),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('No data found for this run')).toBeTruthy();
      },
      { timeout: 5_000 },
    );
  });

  it('switches between tabs', async () => {
    const user = userEvent.setup();

    server.use(
      http.get('/api/runs/:runId/state', () => HttpResponse.json(runState)),
      http.get('/api/runs/:runId/workflow', () => HttpResponse.json(workflow)),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    const workflowTab = screen.getByRole('tab', { name: /Workflow/i });
    await user.click(workflowTab);

    await waitFor(() => {
      expect(workflowTab.getAttribute('aria-selected')).toBe('true');
    });

    const artifactsTab = screen.getByRole('tab', { name: /Artifacts/i });
    await user.click(artifactsTab);

    await waitFor(() => {
      expect(artifactsTab.getAttribute('aria-selected')).toBe('true');
    });
    expect(workflowTab.getAttribute('aria-selected')).toBe('false');
  });

  it('shows budget bar in header when budget is configured', async () => {
    server.use(
      http.get('/api/runs/:runId/state', () => HttpResponse.json(runState)),
      http.get('/api/runs/:runId/workflow', () => HttpResponse.json(workflow)),
      http.get('/api/runs/:runId/usage', () =>
        HttpResponse.json({
          ...usage,
          totalTokens: 50_000,
          budgetSummary: {
            configuredMaxTokens: 100_000,
            budgetExceeded: false,
          },
        }),
      ),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    await waitFor(() => {
      expect(screen.getByText(/50\.0K/)).toBeTruthy();
    });
  });

  it('renders correctly for a completed run', async () => {
    server.use(
      http.get('/api/runs/:runId/state', () =>
        HttpResponse.json({ ...runState, status: 'completed' } satisfies RunStateView),
      ),
      http.get('/api/runs/:runId/workflow', () => HttpResponse.json(workflow)),
      http.get('/api/runs/:runId/events', () => HttpResponse.json([])),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    expect(screen.getByRole('tab', { name: /Chat/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Workflow/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Artifacts/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Config/i })).toBeTruthy();
    expect(screen.getByText('hello from agent')).toBeTruthy();
  });

  it('shows "No artifacts available" when artifacts is null on the artifacts tab', async () => {
    const user = userEvent.setup();

    server.use(
      http.get('/api/runs/:runId/state', () => HttpResponse.json(runState)),
      http.get('/api/runs/:runId/workflow', () => HttpResponse.json(workflow)),
      http.get('/api/runs/:runId/artifacts', () => new HttpResponse(null, { status: 404 })),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    const artifactsTab = screen.getByRole('tab', { name: /Artifacts/i });
    await user.click(artifactsTab);

    await waitFor(() => {
      expect(screen.getByText('No artifacts available')).toBeTruthy();
    });
  });

  it('shows artifacts tab even when artifacts exist', async () => {
    const artifactsWithEntries: ArtifactInventoryView = {
      runId: 'run-live-123',
      artifacts: [
        {
          ref: { type: 'plan', name: 'execution-plan', version: 1, checksum: 'abc123' },
          type: 'plan',
          name: 'execution-plan',
          version: 1,
          producedBy: 'planner',
          createdAt: '2026-01-01T10:00:03Z',
          sizeBytes: 256,
        },
        {
          ref: { type: 'canonical_specification', name: 'spec', version: 1, checksum: 'def456' },
          type: 'canonical_specification',
          name: 'spec',
          version: 1,
          producedBy: 'requirements_analyst',
          createdAt: '2026-01-01T10:00:04Z',
          sizeBytes: 512,
        },
      ],
      totalCount: 2,
      totalSizeBytes: 768,
      byType: { plan: 1, specification: 1 },
    };

    server.use(
      http.get('/api/runs/:runId/state', () =>
        HttpResponse.json({ ...runState, status: 'completed' } satisfies RunStateView),
      ),
      http.get('/api/runs/:runId/workflow', () => HttpResponse.json(workflow)),
      http.get('/api/runs/:runId/artifacts', () => HttpResponse.json(artifactsWithEntries)),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    expect(screen.getByRole('tab', { name: /Artifacts/i })).toBeTruthy();
  });

  it('triggers refreshRunData when a state_changed live event arrives', async () => {
    stateRequests = 0;
    workflowRequests = 0;

    mockUseEventStream.mockReturnValue({
      events: [
        {
          type: 'state_changed',
          timestamp: '2026-01-01T10:00:05Z',
          runId: 'run-live-123',
          data: { stateId: 'REFINEMENT' },
        },
      ],
      status: 'connected',
      clearEvents: vi.fn(),
    });

    server.use(
      http.get('/api/runs/:runId/state', () => {
        stateRequests += 1;
        return HttpResponse.json(runState);
      }),
      http.get('/api/runs/:runId/workflow', () => {
        workflowRequests += 1;
        return HttpResponse.json(workflow);
      }),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    await waitFor(
      () => {
        expect(stateRequests).toBeGreaterThan(1);
      },
      { timeout: 5_000 },
    );
    expect(workflowRequests).toBeGreaterThan(1);
  });

  it('refreshes usage when a worker_completed live event arrives', async () => {
    let usageRequests = 0;

    mockUseEventStream.mockReturnValue({
      events: [
        {
          type: 'worker_completed',
          timestamp: '2026-01-01T10:00:06Z',
          runId: 'run-live-123',
          data: { dispatchId: 'dispatch-1' },
        },
      ],
      status: 'connected',
      clearEvents: vi.fn(),
    });

    server.use(
      http.get('/api/runs/:runId/state', () => HttpResponse.json(runState)),
      http.get('/api/runs/:runId/workflow', () => HttpResponse.json(workflow)),
      http.get('/api/runs/:runId/usage', () => {
        usageRequests += 1;
        return HttpResponse.json(usage);
      }),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    await waitFor(
      () => {
        expect(usageRequests).toBeGreaterThan(1);
      },
      { timeout: 5_000 },
    );
  });

  it('renders config tab with ConfigPanel', async () => {
    const user = userEvent.setup();

    server.use(
      http.get('/api/runs/:runId/state', () => HttpResponse.json(runState)),
      http.get('/api/runs/:runId/workflow', () => HttpResponse.json(workflow)),
    );

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('run-live-123')).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    const configTab = screen.getByRole('tab', { name: /Config/i });
    await user.click(configTab);

    await waitFor(() => {
      expect(configTab.getAttribute('aria-selected')).toBe('true');
    });
  });
});
