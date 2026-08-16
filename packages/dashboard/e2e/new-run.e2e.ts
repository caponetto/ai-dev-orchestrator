import { expect, test } from './fixtures';

test.describe('New run page', () => {
  test('shows page title and description', async ({ page }) => {
    await page.goto('/runs/new');
    await expect(page.getByRole('heading', { name: 'New Run' })).toBeVisible();
    await expect(page.getByText('Describe the task for the orchestrator')).toBeVisible();
  });

  test('has a prompt textarea', async ({ page }) => {
    await page.goto('/runs/new');
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeFocused();
  });

  test('shows workflow selector with options from API', async ({ page }) => {
    await page.goto('/runs/new');
    await expect(page.getByText('Workflow', { exact: true })).toBeVisible();

    const trigger = page.getByRole('combobox');
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByRole('option')).toHaveCount(2);
  });

  test('shows repository context field pre-filled from server-info', async ({ page }) => {
    await page.goto('/runs/new');
    await expect(page.getByText('Repository Context')).toBeVisible();

    const repoInput = page.locator('input[type="text"]');
    await expect(repoInput).toHaveValue('/home/user/my-project');
  });

  test('Start Run button is disabled when prompt is empty', async ({ page }) => {
    await page.goto('/runs/new');

    const startButton = page.getByRole('button', { name: 'Start Run' });
    await expect(startButton).toBeDisabled();
  });

  test('Start Run button is enabled when prompt is filled', async ({ page }) => {
    await page.goto('/runs/new');

    await page.locator('textarea').fill('Build a user authentication system');
    const startButton = page.getByRole('button', { name: 'Start Run' });
    await expect(startButton).toBeEnabled();
  });

  test('Cancel button navigates back to runs list', async ({ page }) => {
    await page.goto('/runs/new');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/runs$/);
  });

  test('submitting navigates to the new run detail page', async ({ page }) => {
    await page.goto('/runs/new');

    await page.locator('textarea').fill('Build a REST API');
    await page.getByRole('button', { name: 'Start Run' }).click();

    await expect(page).toHaveURL(/\/runs\/run-003$/);
  });

  test('shows error when submission fails', async ({ page }) => {
    await page.route('**/api/runs', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'Workflow not found' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/runs/new');
    await page.locator('textarea').fill('Some task');
    await page.getByRole('button', { name: 'Start Run' }).click();

    await expect(page.getByText('Workflow not found')).toBeVisible();
  });

  test('shows Run Configuration toggle at the bottom', async ({ page }) => {
    await page.goto('/runs/new');
    await expect(page.getByText('Run Configuration')).toBeVisible({ timeout: 10_000 });
  });

  test('expanding Run Configuration shows settings sections', async ({ page }) => {
    await page.goto('/runs/new');

    await page.getByText('Run Configuration').click({ timeout: 10_000 });
    await expect(page.getByText('Permission Policy')).toBeVisible();
  });

  test('workflow preview graph is shown when a workflow is selected', async ({ page }) => {
    await page.goto('/runs/new');

    await expect(page.locator('.react-flow')).toBeVisible();
  });
});
