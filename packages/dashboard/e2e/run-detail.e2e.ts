import { expect, test } from './fixtures';

test.describe('Run detail page — completed run', () => {
  test('shows run header with run ID', async ({ page }) => {
    await page.goto('/runs/run-001');
    await expect(page.getByRole('main').getByText('run-001', { exact: true })).toBeVisible();
  });

  test('shows run status badge', async ({ page }) => {
    await page.goto('/runs/run-001');
    await expect(page.getByText('COMPLETED', { exact: true })).toBeVisible();
  });

  test('shows elapsed time', async ({ page }) => {
    await page.goto('/runs/run-001');
    await expect(page.getByText('Elapsed')).toBeVisible();
  });

  test('shows repository context', async ({ page }) => {
    await page.goto('/runs/run-001');
    await expect(page.getByText('Context')).toBeVisible();
    await expect(page.getByText('my-project')).toBeVisible();
  });

  test('shows workflow graph in Workflow tab', async ({ page }) => {
    await page.goto('/runs/run-001');
    await page.getByRole('tab', { name: 'Workflow' }).click();
    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('shows settings content in Settings tab', async ({ page }) => {
    await page.goto('/runs/run-001');
    await page.getByRole('tab', { name: 'Config' }).click();
    await expect(page.getByText('Iteration Limits')).toBeVisible();
  });

  test('shows role table in Settings tab', async ({ page }) => {
    await page.goto('/runs/run-001');
    await page.getByRole('tab', { name: 'Config' }).click();
    await expect(page.getByText('Planner')).toBeVisible();
    await expect(page.getByText('Developer')).toBeVisible();
  });

  test('completed run shows iteration limits', async ({ page }) => {
    await page.goto('/runs/run-001');
    await page.getByRole('tab', { name: 'Config' }).click();
    await expect(page.getByText('Iteration Limits')).toBeVisible();
  });

  test('completed run shows quality gates', async ({ page }) => {
    await page.goto('/runs/run-001');
    await page.getByRole('tab', { name: 'Config' }).click();
    await expect(page.getByText('Implementation Review')).toBeVisible();
  });

  test('completed run shows artifacts panel', async ({ page }) => {
    await page.goto('/runs/run-001');
    await page.getByRole('tab', { name: /Artifacts/ }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText('Plan').first()).toBeVisible();
  });

  test('shows artifact entries from mock data', async ({ page }) => {
    await page.goto('/runs/run-001');
    await page.getByRole('tab', { name: /Artifacts/ }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText('Plan').first()).toBeVisible();
    await expect(panel.getByText('Implementation').first()).toBeVisible();
  });

  test('shows artifact version buttons', async ({ page }) => {
    await page.goto('/runs/run-001');
    await page.getByRole('tab', { name: /Artifacts/ }).click();
    await expect(page.getByText('v1').first()).toBeVisible();
  });

  test('completed run shows budget in header', async ({ page }) => {
    await page.goto('/runs/run-001');
    await expect(page.getByText('Budget')).toBeVisible();
  });

  test('shows token usage in the header', async ({ page }) => {
    await page.goto('/runs/run-001');
    await expect(page.getByText('Tokens').first()).toBeVisible();
  });
});

test.describe('Run detail page — running run', () => {
  test('shows Abort button for running runs', async ({ page }) => {
    await page.goto('/runs/run-002');
    await expect(page.getByRole('button', { name: 'Abort' })).toBeVisible();
  });

  test('Abort button opens confirmation modal', async ({ page }) => {
    await page.goto('/runs/run-002');
    await page.getByRole('button', { name: 'Abort' }).click();

    await expect(page.getByRole('heading', { name: 'Abort Run' })).toBeVisible();
    await expect(page.getByPlaceholder(/security requirements/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abort Run' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('cancel in abort modal closes it', async ({ page }) => {
    await page.goto('/runs/run-002');
    await page.getByRole('button', { name: 'Abort' }).click();
    await expect(page.getByRole('heading', { name: 'Abort Run' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Abort Run' })).not.toBeVisible();
  });

  test('does not show Retry or Rerun buttons for running runs', async ({ page }) => {
    await page.goto('/runs/run-002');
    await expect(page.getByRole('button', { name: 'Retry' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Rerun' })).not.toBeVisible();
  });
});

test.describe('Run detail page — completed run actions', () => {
  test('shows Rerun button for completed runs', async ({ page }) => {
    await page.goto('/runs/run-001');
    await expect(page.getByRole('button', { name: 'Rerun' })).toBeVisible();
  });

  test('does not show Abort button for completed runs', async ({ page }) => {
    await page.goto('/runs/run-001');
    await expect(page.getByRole('button', { name: 'Abort' })).not.toBeVisible();
  });

  test('Rerun button opens confirmation modal', async ({ page }) => {
    await page.goto('/runs/run-001');
    await page.getByRole('button', { name: 'Rerun' }).click();

    await expect(page.getByText('Rerun Workflow')).toBeVisible();
    await expect(page.getByText('same prompt, workflow, and context')).toBeVisible();
  });

  test('cancel in rerun modal closes it', async ({ page }) => {
    await page.goto('/runs/run-001');
    await page.getByRole('button', { name: 'Rerun' }).click();
    await expect(page.getByText('Rerun Workflow')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Rerun Workflow')).not.toBeVisible();
  });
});

test.describe('Run detail page — failed run actions', () => {
  test('shows Retry and Rerun buttons for failed runs', async ({ page }) => {
    await page.unroute('**/api/runs/*/state');
    await page.route('**/api/runs/*/state', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          runId: 'run-fail',
          status: 'failed',
          currentState: 'implementation',
          previousState: 'planning',
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          stateEnteredAt: new Date(Date.now() - 45_000).toISOString(),
          elapsedMs: 45_000,
          transitionCount: 1,
          repoRoot: '/home/user/my-project',
          isWaitingForHuman: false,
        }),
      }),
    );

    await page.goto('/runs/run-fail');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rerun' })).toBeVisible();
  });

  test('Retry opens confirmation modal', async ({ page }) => {
    await page.unroute('**/api/runs/*/state');
    await page.route('**/api/runs/*/state', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          runId: 'run-fail',
          status: 'failed',
          currentState: 'implementation',
          previousState: 'planning',
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          stateEnteredAt: new Date(Date.now() - 45_000).toISOString(),
          elapsedMs: 45_000,
          transitionCount: 1,
          repoRoot: '/home/user/my-project',
          isWaitingForHuman: false,
        }),
      }),
    );

    await page.goto('/runs/run-fail');
    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByRole('heading', { name: 'Retry Run' })).toBeVisible();
    await expect(page.getByText('re-run the workflow')).toBeVisible();
  });
});

test.describe('Run detail page — error and loading states', () => {
  test('shows error when no data is returned', async ({ page }) => {
    await page.unroute('**/api/runs/*/state');
    await page.unroute('**/api/runs/*/workflow');
    await page.unroute('**/api/runs/*/artifacts');
    await page.unroute('**/api/runs/*/usage');
    await page.unroute('**/api/runs/*/config');
    await page.route('**/api/runs/*/state', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );
    await page.route('**/api/runs/*/workflow', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );
    await page.route('**/api/runs/*/artifacts', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );
    await page.route('**/api/runs/*/usage', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );
    await page.route('**/api/runs/*/config', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );

    await page.goto('/runs/run-nonexistent');
    await expect(page.getByText('No data found for this run')).toBeVisible();
  });
});

test.describe('Run detail page — waiting for human', () => {
  test('shows awaiting approval badge when waiting for human', async ({ page }) => {
    await page.unroute('**/api/runs/*/state');
    await page.route('**/api/runs/*/state', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          runId: 'run-waiting',
          status: 'waiting',
          currentState: 'implementation',
          previousState: 'planning',
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          stateEnteredAt: new Date(Date.now() - 30_000).toISOString(),
          elapsedMs: 30_000,
          transitionCount: 1,
          repoRoot: '/home/user/my-project',
          isWaitingForHuman: true,
        }),
      }),
    );

    await page.goto('/runs/run-waiting');
    await expect(page.getByText('Awaiting human approval')).toBeVisible();
  });

  test('shows budget exceeded badge when budget exhausted', async ({ page }) => {
    await page.unroute('**/api/runs/*/state');
    await page.route('**/api/runs/*/state', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          runId: 'run-budget',
          status: 'waiting',
          currentState: 'implementation',
          previousState: 'planning',
          startedAt: new Date(Date.now() - 120_000).toISOString(),
          stateEnteredAt: new Date(Date.now() - 60_000).toISOString(),
          elapsedMs: 60_000,
          transitionCount: 1,
          repoRoot: '/home/user/my-project',
          isWaitingForHuman: true,
          waitingContext: {
            reason: 'budget_exhausted',
            requiredInput: 'approval',
            requestingState: 'implementation',
            autoResumeSafe: false,
            presentedArtifacts: [],
            waitingSince: new Date(Date.now() - 60_000).toISOString(),
            budgetExhaustion: {
              limitType: 'token',
              current: 100_000,
              limit: 80_000,
              cumulativeTokens: 100_000,
            },
          },
        }),
      }),
    );

    await page.unroute('**/api/runs/*/usage');
    await page.route('**/api/runs/*/usage', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          runId: 'run-budget',
          totalInputTokens: 60_000,
          totalOutputTokens: 40_000,
          totalTokens: 100_000,
          byRole: [],
          budgetSummary: {
            configuredMaxTokens: 80_000,
            budgetExceeded: true,
            alertThresholds: [0.5, 0.8],
            crossedThresholds: [0.5, 0.8],
          },
        }),
      }),
    );

    await page.goto('/runs/run-budget');
    await expect(page.getByText(/Budget exceeded/)).toBeVisible();
  });
});
