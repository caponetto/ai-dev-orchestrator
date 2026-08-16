import { expect, test } from './fixtures';

test.describe('App navigation', () => {
  test('root redirects to /runs', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/runs$/);
  });

  test('sidebar links navigate between pages', async ({ page }) => {
    await page.goto('/runs');

    const nav = page.getByLabel('Main navigation');
    await nav.getByRole('link', { name: 'Workflows' }).click();
    await expect(page).toHaveURL(/\/workflows/);

    await nav.getByRole('link', { name: 'Runs' }).click();
    await expect(page).toHaveURL(/\/runs$/);
  });

  test('unknown routes show 404 page', async ({ page }) => {
    await page.goto('/this-does-not-exist');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByText('Page not found')).toBeVisible();
  });

  test('404 page has a link back to home', async ({ page }) => {
    await page.goto('/this-does-not-exist');
    await page.getByRole('link', { name: 'Go Home' }).click();
    await expect(page).toHaveURL(/\/runs$/);
  });
});
