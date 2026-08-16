import { expect, test } from './fixtures';

test.describe('Run list page', () => {
  test('displays the runs table with mock data', async ({ page }) => {
    await page.goto('/runs');
    const table = page.getByTestId('runs-table');
    await expect(table.getByText('run-001')).toBeVisible();
    await expect(table.getByText('run-002')).toBeVisible();
  });

  test('shows run metadata columns', async ({ page }) => {
    await page.goto('/runs');

    const headers = page.locator('thead th');
    await expect(headers.getByText('Run ID')).toBeVisible();
    await expect(headers.getByText('Status')).toBeVisible();
    await expect(headers.getByText('Workflow')).toBeVisible();
    await expect(headers.getByText('Duration')).toBeVisible();
    await expect(headers.getByText('Artifacts')).toBeVisible();
  });

  test('has a New Run button that navigates to create page', async ({ page }) => {
    await page.goto('/runs');

    await page.getByRole('button', { name: 'New Run' }).click();
    await expect(page).toHaveURL(/\/runs\/new$/);
  });

  test('clicking a row navigates to run detail', async ({ page }) => {
    await page.goto('/runs');

    await page.getByTestId('runs-table').getByText('run-001').click();
    await expect(page).toHaveURL(/\/runs\/run-001$/);
  });

  test('column sorting toggles direction', async ({ page }) => {
    await page.goto('/runs');

    const statusColumn = page.getByRole('columnheader', { name: /Status/ });
    await statusColumn.click();
    await expect(statusColumn.getByText('▼')).toBeVisible();

    await statusColumn.click();
    await expect(statusColumn.getByText('▲')).toBeVisible();
  });

  test('shows empty state when no runs exist', async ({ page }) => {
    await page.route('**/api/runs', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
      return route.continue();
    });

    await page.goto('/runs');
    await expect(page.getByText('No runs yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Run' })).toBeVisible();
  });

  test('shows error state when API fails', async ({ page }) => {
    await page.route('**/api/runs', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      }
      return route.continue();
    });

    await page.goto('/runs');
    await expect(page.getByText('Failed to load runs')).toBeVisible();
    await expect(page.getByText('Make sure the backend is running')).toBeVisible();
  });

  test('checkbox selects a run and shows Delete Selected button', async ({ page }) => {
    await page.goto('/runs');
    await expect(page.getByTestId('runs-table').getByText('run-001')).toBeVisible();

    const firstCheckbox = page.locator('tbody tr').first().getByRole('checkbox');
    await firstCheckbox.click();

    await expect(page.getByRole('button', { name: /Delete \(/ })).toBeVisible();
  });

  test('select-all checkbox toggles all rows', async ({ page }) => {
    await page.goto('/runs');
    await expect(page.getByTestId('runs-table').getByText('run-001')).toBeVisible();

    const selectAll = page.locator('thead').getByRole('checkbox');
    await selectAll.click();

    await expect(page.getByRole('button', { name: /Delete \(2\)/ })).toBeVisible();

    await selectAll.click();
    await expect(page.getByRole('button', { name: /Delete \(/ })).not.toBeVisible();
  });

  test('delete flow shows confirmation modal', async ({ page }) => {
    await page.goto('/runs');
    await expect(page.getByTestId('runs-table').getByText('run-001')).toBeVisible();

    const firstCheckbox = page.locator('tbody tr').first().getByRole('checkbox');
    await firstCheckbox.click();
    await page.getByRole('button', { name: /Delete \(/ }).click();

    await expect(page.getByText('Delete Runs')).toBeVisible();
    await expect(page.getByText('Are you sure you want to delete')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  });

  test('cancel in delete modal closes it', async ({ page }) => {
    await page.goto('/runs');
    await expect(page.getByTestId('runs-table').getByText('run-001')).toBeVisible();

    const firstCheckbox = page.locator('tbody tr').first().getByRole('checkbox');
    await firstCheckbox.click();
    await page.getByRole('button', { name: /Delete \(/ }).click();

    await expect(page.getByText('Delete Runs')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Delete Runs')).not.toBeVisible();
  });

  test('shows workflow column for each run', async ({ page }) => {
    await page.goto('/runs');
    await expect(page.locator('tbody').getByText('default')).toBeVisible();
    await expect(page.locator('tbody').getByText('review')).toBeVisible();
  });
});
