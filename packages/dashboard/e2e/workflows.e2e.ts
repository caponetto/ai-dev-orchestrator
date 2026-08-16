import { expect, test } from './fixtures';

test.describe('Workflows page', () => {
  test('displays the workflow list', async ({ page }) => {
    await page.goto('/workflows');
    await expect(page.getByRole('option', { name: /default/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /review/ })).toBeVisible();
  });

  test('auto-selects the first workflow and renders graph', async ({ page }) => {
    await page.goto('/workflows');
    await expect(page.getByRole('option', { name: /default/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('clicking a different workflow updates selection and URL', async ({ page }) => {
    await page.goto('/workflows');
    await page.getByRole('option', { name: /review/ }).click();
    await expect(page.getByRole('option', { name: /review/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/selected=review/);
  });

  test('deep-linking with ?selected=review pre-selects the correct workflow', async ({ page }) => {
    await page.goto('/workflows?selected=review');
    await expect(page.getByRole('option', { name: /review/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('shows error state when workflows API returns 500', async ({ page }) => {
    await page.route('**/api/workflows', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('/workflows');
    await expect(page.getByText('Failed to load workflows')).toBeVisible();
  });

  test('shows empty state when no workflows are returned', async ({ page }) => {
    await page.route('**/api/workflows', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      }),
    );
    await page.goto('/workflows');
    await expect(page.getByText('No workflows found')).toBeVisible();
  });
});
