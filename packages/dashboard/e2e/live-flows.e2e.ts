import { expect } from '@playwright/test';

import { test } from './live-server';

const runId = 'browser-live';
const messageId = 'browser-request';

test('live output and completion reach the browser without refresh', async ({ page, live }) => {
  await page.goto(`/runs/${runId}`);
  await live.control('log', { content: 'Live browser progress' });
  await expect(page.getByText('Live browser progress', { exact: true })).toBeVisible();
  await live.control('complete');
  await expect(page.getByText('COMPLETED', { exact: true })).toBeVisible();
  expect(
    await (await page.request.get(`${live.url}/api/runs/${runId}/state`)).json(),
  ).toMatchObject({ currentState: 'DONE' });
});

test('switching runs isolates output and incoming events', async ({ page, live }) => {
  await live.control('log', { content: 'Only first run' });
  await live.control('log', { runId: 'browser-other', content: 'Only second run' });
  await page.goto(`/runs/${runId}`);
  await expect(page.getByText('Only first run', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Runs', exact: true })
    .click();
  await page.getByTestId('runs-table').getByText('browser-other', { exact: true }).click();
  await expect(page.getByText('Only second run', { exact: true })).toBeVisible();
  await live.control('log', { content: 'Late first run event' });
  await live.control('log', { runId: 'browser-other', content: 'Second run still active' });
  await expect(page.getByText('Second run still active', { exact: true })).toBeVisible();
  await expect(page.getByText('Only first run', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Late first run event', { exact: true })).toHaveCount(0);
});

for (const granted of [true, false]) {
  test(`permission ${granted ? 'approval' : 'denial'} persists and reaches the agent`, async ({
    page,
    live,
  }) => {
    await live.control('request', { messageId, kind: 'permission' });
    await page.goto(`/runs/${runId}`);
    await page.getByRole('button', { name: granted ? 'Approve' : 'Deny', exact: true }).click();
    await expect
      .poll(() => live.control('read-response', { messageId }))
      .toMatchObject({ payload: { granted } });
    expect(await live.control('consume', { messageId, kind: 'permission' })).toMatchObject({
      payload: { granted },
    });
    await expect(
      page.getByText(`Agent continued after ${messageId}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  });
}

test('live clarification accepts text and persists it before agent continuation', async ({
  page,
  live,
}) => {
  await live.control('request', { messageId, kind: 'clarification' });
  await page.goto(`/runs/${runId}`);
  await page.getByRole('textbox', { name: 'Clarification answer' }).fill('Blue');
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect
    .poll(() => live.control('read-response', { messageId }))
    .toMatchObject({ payload: { answer: 'Blue' } });
  await live.control('consume', { messageId, kind: 'clarification' });
  await expect(page.getByText(`Agent continued after ${messageId}`, { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Which color should the fixture use?', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send answer', exact: true })).toHaveCount(0);
});

test('reload preserves a pending request and its later durable resolution', async ({
  page,
  live,
}) => {
  await live.control('request', { messageId, kind: 'permission' });
  await page.goto(`/runs/${runId}`);
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => live.control('read-response', { messageId })).not.toBeNull();
  await live.control('consume', { messageId, kind: 'permission' });
  await page.reload();
  await expect(page.getByText(/Write File — granted/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});

test('native stream reconnect replays history without duplicating output', async ({
  page,
  live,
}) => {
  await page.goto(`/runs/${runId}`);
  await live.control('log', { content: 'Before disconnect' });
  await expect(page.getByText('Before disconnect', { exact: true })).toBeVisible();
  expect(await live.control('disconnect-streams')).toBeGreaterThan(0);
  await expect(page.getByText('reconnecting...', { exact: true })).toBeVisible();
  await live.control('log', { content: 'While disconnected' });
  await expect(page.getByText('While disconnected', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Before disconnect', { exact: true })).toHaveCount(1);
  await expect(page.getByText('While disconnected', { exact: true })).toHaveCount(1);
});

test('competing tabs preserve the first decision and update stale controls', async ({
  page,
  context,
  live,
}) => {
  const other = await context.newPage();
  await live.control('request', { messageId, kind: 'permission' });
  await page.goto(`/runs/${runId}`);
  await other.goto(`/runs/${runId}`);
  await expect(other.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect
    .poll(() => live.control('read-response', { messageId }))
    .toMatchObject({ payload: { granted: false } });
  await other.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText(/different|conflict|already/i);
  await live.control('consume', { messageId, kind: 'permission' });
  await expect(other.getByText(/Write File — denied/)).toBeVisible();
  await expect(other.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  expect(await live.control('read-response', { messageId })).toMatchObject({
    payload: { granted: false },
  });
});

test('a request that expires while displayed cannot produce a decision', async ({ page, live }) => {
  await live.control('request', { messageId, kind: 'permission' });
  await page.goto(`/runs/${runId}`);
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await live.control('expire', { messageId });
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/expired/i);
  expect(await live.control('read-response', { messageId })).toBeNull();
});

test('storage rejection displays an error and allows a successful retry', async ({
  page,
  live,
}) => {
  await live.control('request', { messageId, kind: 'permission' });
  await page.goto(`/runs/${runId}`);
  await live.control('fail-next-response');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to store live response');
  expect(await live.control('read-response', { messageId })).toBeNull();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect
    .poll(() => live.control('read-response', { messageId }))
    .toMatchObject({ payload: { granted: true } });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('interrupted submission restores controls and can be retried', async ({ page, live }) => {
  await live.control('request', { messageId, kind: 'permission' });
  await page.goto(`/runs/${runId}`);
  await page.route('**/permissions/*', (route) => route.abort('connectionreset'), { times: 1 });
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await live.control('read-response', { messageId })).toBeNull();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect
    .poll(() => live.control('read-response', { messageId }))
    .toMatchObject({ payload: { granted: true } });
});

test('retry after a lost acknowledgement preserves the original persisted decision', async ({
  page,
  live,
}) => {
  await live.control('request', { messageId, kind: 'permission' });
  await page.goto(`/runs/${runId}`);
  await page.route(
    '**/permissions/*',
    async (route) => {
      const response = await route.fetch({
        url: `${live.url}/api/runs/${runId}/permissions/${messageId}`,
      });
      expect(response.status()).toBe(200);
      await route.abort('connectionreset');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const original = await live.control('read-response', { messageId });
  expect(original).toMatchObject({ payload: { granted: true } });
  const acknowledgement = page.waitForResponse(
    (response) => response.url().includes(`/permissions/${messageId}`) && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  expect(await (await acknowledgement).json()).toEqual({ ok: true, outcome: 'already_responded' });
  expect(await live.control('read-response', { messageId })).toEqual(original);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
