import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/browser-integration/support/computer-entry.html');
  await page.waitForFunction(() => window.fixtureReady);
});

test('preparation preserves usable controls and stable loading until real readiness', async ({ page }) => {
  await page.clock.install({ time: Date.now() });
  await page.clock.pauseAt(Date.now() + 1);
  await page.locator('#open').click();
  const start = page.getByRole('button', { name: 'Start game', exact: true });
  const status = page.getByRole('status');
  await expect(start).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Player 2 · Blue', exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: 'Player 2 · Blue', exact: true }).check();
  await page.evaluate(() => window.requests[0].progress({ phase: 'fetching-model', received: 50, total: 100 }));
  await page.clock.runFor(200);
  await expect(status.locator('.loading-pieces')).toBeVisible();
  await page.clock.runFor(4799);
  await expect(status).not.toContainText('bytes');
  await page.clock.runFor(1);
  await expect(status).toContainText('50 of 100 bytes');
  await expect(start).toHaveText('Start game');
  await page.evaluate(() => window.requests[0].resolve());
  await expect(start).toBeEnabled();
  await expect(status).toContainText('Ready to play');
  await expect(status.locator('.loading-pieces')).toHaveCount(0);
  await start.click();
  expect(await page.evaluate(() => window.created)).toEqual([{ opponent: 'babs', side: 'p2' }]);
});

test('preparation failure, retry and dismissal never create or enable a stale game', async ({ page }) => {
  await page.locator('#open').click();
  await page.evaluate(() => window.requests[0].reject(Error('model-checksum')));
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => window.created)).toEqual([]);
  await page.locator('#open').click();
  await page.evaluate(() => window.requests[1].resolve());
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Opponent', exact: true }).selectOption('friend');
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeEnabled();
  await page.evaluate(() => window.requests[2].resolve());
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  expect(await page.evaluate(() => window.created)).toEqual([{ opponent: 'friend', side: 'p1' }]);
  expect(await page.evaluate(() => window.cancelled)).toBeGreaterThanOrEqual(2);
});
