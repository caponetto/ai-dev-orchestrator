import type { Page } from '@playwright/test';
import { test as base } from '@playwright/test';

export const mockData = {
  runs: [
    {
      runId: 'run-001',
      repository: '/home/user/my-project',
      repoRoot: '/home/user/my-project',
      workflow: 'default',
      status: 'completed',
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      completedAt: new Date(Date.now() - 3_480_000).toISOString(),
      durationMs: 120_000,
      totalArtifacts: 4,
      totalTokens: 23_000,
      totalInputTokens: 15_000,
      totalOutputTokens: 8_000,
      finalState: 'completed',
    },
    {
      runId: 'run-002',
      repository: '/home/user/other-repo',
      repoRoot: '/home/user/other-repo',
      workflow: 'review',
      status: 'running',
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 60_000,
      totalArtifacts: 1,
      totalTokens: 7_000,
      totalInputTokens: 5_000,
      totalOutputTokens: 2_000,
      finalState: 'implementation',
    },
  ],

  runState: (runId: string) => ({
    runId,
    status: runId === 'run-002' ? 'running' : 'completed',
    currentState: runId === 'run-002' ? 'implementation' : 'completed',
    previousState: 'planning',
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    stateEnteredAt: new Date(Date.now() - 3_540_000).toISOString(),
    elapsedMs: runId === 'run-002' ? 60_000 : 120_000,
    transitionCount: 2,
    repoRoot: runId === 'run-001' ? '/home/user/my-project' : '/home/user/other-repo',
    isWaitingForHuman: false,
  }),

  workflow: {
    runId: 'run-001',
    currentState: 'completed',
    visitedStates: ['planning', 'implementation', 'completed'],
    stateHistory: ['planning', 'implementation', 'completed'],
    states: [
      {
        id: 'planning',
        label: 'planning',
        type: 'action',
        roles: ['planner'],
        current: false,
        visited: true,
        timeSpentMs: 60_000,
        visitCount: 1,
      },
      {
        id: 'implementation',
        label: 'implementation',
        type: 'action',
        roles: ['developer'],
        current: false,
        visited: true,
        timeSpentMs: 60_000,
        visitCount: 1,
      },
      {
        id: 'completed',
        label: 'completed',
        type: 'terminal',
        roles: [],
        current: true,
        visited: true,
        timeSpentMs: 0,
        visitCount: 1,
      },
    ],
    transitions: [],
  },

  artifacts: {
    runId: 'run-001',
    artifacts: [
      {
        ref: { type: 'plan', name: 'main', version: 1, checksum: 'abc123' },
        type: 'plan',
        name: 'main',
        version: 1,
        producedBy: 'planner',
        createdAt: new Date(Date.now() - 3_540_000).toISOString(),
        sizeBytes: 2048,
        verdict: 'approved',
      },
      {
        ref: { type: 'implementation', name: 'implementation', version: 1, checksum: 'def456' },
        type: 'implementation',
        name: 'implementation',
        version: 1,
        producedBy: 'developer',
        createdAt: new Date(Date.now() - 3_480_000).toISOString(),
        sizeBytes: 8192,
        verdict: 'approved',
      },
    ],
    totalCount: 2,
    totalSizeBytes: 10_240,
    byType: { plan: 1, implementation: 1 },
  },

  usage: {
    runId: 'run-001',
    totalInputTokens: 15_000,
    totalOutputTokens: 8_000,
    totalTokens: 23_000,
    byRole: [
      {
        role: 'planner',
        inputTokens: 5_000,
        outputTokens: 3_000,
        dispatches: 1,
        totalDurationMs: 30_000,
      },
      {
        role: 'developer',
        inputTokens: 10_000,
        outputTokens: 5_000,
        dispatches: 2,
        totalDurationMs: 60_000,
      },
    ],
    budgetSummary: {
      configuredMaxTokens: 100_000,
      budgetExceeded: false,
      alertThresholds: [0.5, 0.8],
      crossedThresholds: [],
    },
  },

  config: {
    workflow: 'default',
    sources: ['Build a REST API for user management'],
    roles: [
      { role: 'planner', runner: 'claude-code', model: 'claude-sonnet-4-20250514' },
      { role: 'developer', runner: 'claude-code', model: 'claude-sonnet-4-20250514' },
    ],
    iterationLimits: { maxReviewIterations: 3, maxJudgeArbitrations: 2 },
    budget: { maxTokensPerRun: 100_000 },
    qualityGates: {
      specificationReadiness: { minCompletenessScore: 0.8 },
      implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
    },
  },

  health: {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeMs: 123_456_000,
    host: '127.0.0.1',
    port: 9100,
    clients: 2,
    subsystems: [
      {
        name: 'journal-storage',
        status: 'healthy',
        message: 'OK',
        consecutiveFailures: 0,
        lastCheckedAt: new Date().toISOString(),
      },
      {
        name: 'manifest-store',
        status: 'healthy',
        message: 'OK',
        consecutiveFailures: 0,
        lastCheckedAt: new Date().toISOString(),
      },
      {
        name: 'artifact-store',
        status: 'healthy',
        message: 'OK',
        consecutiveFailures: 0,
        lastCheckedAt: new Date().toISOString(),
      },
    ],
    runStats: {
      total: 5,
      active: 1,
      completed: 3,
      failed: 1,
      avgDurationMs: null,
      latestRun: null,
    },
  },

  workflows: [
    { name: 'default', description: 'Default workflow', version: '1.0.0', stateCount: 3 },
    { name: 'review', description: 'Code review workflow', version: '1.0.0', stateCount: 2 },
  ],

  settings: {
    roles: { assignments: {} },
    governance: {
      permissionPolicy: { defaultAction: 'ask_human' },
      iterationLimits: {
        defaults: {
          maxReviewIterations: 3,
          maxJudgeArbitrations: 2,
          maxClarificationRounds: 3,
          maxAcceptanceIterations: 5,
        },
      },
      qualityGates: {
        specificationReadiness: { minCompletenessScore: 0.8 },
        implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
      },
      budget: { maxTokensPerRun: 100_000 },
    },
    runtime: { logLevel: 'info' },
    availableRunners: ['claude-code', 'cursor'],
    modelsByRunner: { 'claude-code': ['claude-sonnet-4-20250514'], cursor: [] },
  },
};

async function setupDefaultMocks(page: Page) {
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData.health),
    }),
  );

  await page.route('**/api/runs', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockData.runs),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, runId: 'run-003' }),
    });
  });

  await page.route('**/api/runs/*/state', (route) => {
    const url = route.request().url();
    const runId = url.match(/\/api\/runs\/([^/]+)\/state/)?.[1] ?? 'run-001';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData.runState(runId)),
    });
  });

  await page.route('**/api/runs/*/workflow', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData.workflow),
    }),
  );

  await page.route('**/api/runs/*/artifacts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData.artifacts),
    }),
  );

  await page.route('**/api/runs/*/usage', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData.usage),
    }),
  );

  await page.route('**/api/runs/*/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData.config),
    }),
  );

  await page.route('**/api/runs/*/live-requests', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  await page.route('**/api/runs/*/abort', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    }),
  );

  await page.route('**/api/runs/*/retry', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    }),
  );

  await page.route('**/api/runs/*', (route) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    }
    return route.continue();
  });

  await page.route('**/api/workflows', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData.workflows),
    }),
  );

  await page.route('**/api/workflows/*/preview', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData.workflow),
    }),
  );

  await page.route('**/api/server-info', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cwd: '/home/user/my-project' }),
    }),
  );

  await page.route('**/api/settings', (route) => {
    if (route.request().method() === 'PUT') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData.settings),
    });
  });

  await page.route('**/api/permission-approvals', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  await page.route('**/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    }),
  );

  await page.route('**/api/runs/*/agent-stream', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    }),
  );
}

/**
 * Intercepts dashboard API calls and returns canned JSON responses so e2e
 * tests can run against the Vite dev server alone (no dashboard-server).
 */
export const test = base.extend<{ mockApi: void }>({
  mockApi: [
    async ({ page }, use) => {
      await setupDefaultMocks(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
