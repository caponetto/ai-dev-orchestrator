import { expect, test } from './fixtures';

test.describe('Health page', () => {
  test('displays overall system health status', async ({ page }) => {
    await page.goto('/health');
    await expect(page.getByText('System Health')).toBeVisible();
    await expect(page.getByText('Healthy', { exact: true })).toBeVisible();
  });

  test('shows subsystem cards', async ({ page }) => {
    await page.goto('/health');
    await expect(page.getByText('Journal Storage')).toBeVisible();
    await expect(page.getByText('Manifest Store')).toBeVisible();
    await expect(page.getByText('Artifact Store')).toBeVisible();
  });

  test('shows SSE client count', async ({ page }) => {
    await page.goto('/health');
    await expect(page.getByText('SSE Clients')).toBeVisible();
    await expect(page.getByText('connected')).toBeVisible();
  });

  test('shows API server info', async ({ page }) => {
    await page.goto('/health');
    await expect(page.getByText('API Server')).toBeVisible();
    await expect(page.getByText('Running')).toBeVisible();
  });

  test('displays uptime', async ({ page }) => {
    await page.goto('/health');
    await expect(page.getByText(/Uptime:/)).toBeVisible();
  });

  test('shows error state when health API fails', async ({ page }) => {
    await page.route('**/api/health', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );

    await page.goto('/health');
    await expect(page.getByText('Failed to load health')).toBeVisible();
  });

  test('shows subsystem status indicators', async ({ page }) => {
    await page.goto('/health');
    const subsystemsSection = page.locator('text=Subsystems').locator('..');
    await expect(subsystemsSection).toBeVisible();
  });

  test('shows degraded subsystem status', async ({ page }) => {
    await page.route('**/api/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'degraded',
          timestamp: new Date().toISOString(),
          uptimeMs: 60_000,
          host: '127.0.0.1',
          port: 9100,
          clients: 1,
          subsystems: [
            {
              name: 'journal-storage',
              status: 'degraded',
              message: 'High latency detected',
              consecutiveFailures: 2,
              lastCheckedAt: new Date().toISOString(),
            },
          ],
          runStats: {
            total: 1,
            active: 0,
            completed: 1,
            failed: 0,
            avgDurationMs: null,
            latestRun: null,
          },
        }),
      }),
    );

    await page.goto('/health');
    await expect(page.getByText('degraded').first()).toBeVisible();
    await expect(page.getByText('Failures: 2')).toBeVisible();
  });
});
