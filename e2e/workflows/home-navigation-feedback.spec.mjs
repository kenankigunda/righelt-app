import { test, expect } from '@playwright/test';
import { createIsolatedPage, createGamesViaApi, closeContextQuietly } from '../support/app.mjs';

for (const reducedMotion of ['no-preference', 'reduce']) test(`Home resets while browser history restores each visit (${reducedMotion})`, async ({ browser }, testInfo) => {
  const { context, page } = await createIsolatedPage(browser);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion });
    await createGamesViaApi(page, 9);
    await page.goto('/');
    const section = page.locator('[data-home-section-root="my"]');
    await section.locator('[data-action="home-page-next"]').click();
    await expect(section).toContainText('Page 2 of');
    await expect.poll(() => section.evaluate(element => Math.abs(element.getBoundingClientRect().top))).toBeLessThan(2);
    await page.evaluate(() => {
      window.routeMotion = [];
      const layer = document.querySelector('#shell-route-transition-layer');
      new MutationObserver(() => {
        if (layer.dataset.phase === 'covering') {
          const swipe = layer.querySelector('.shell-route-transition-layer-swipe');
          window.routeMotion.push({ direction: layer.dataset.direction, opacity: getComputedStyle(swipe).opacity, display: getComputedStyle(swipe).display });
        }
      }).observe(layer, { attributes: true });
      window.scrollTo({ top: 240, behavior: 'instant' });
    });
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(240);
    const card = section.locator('.mini-board-card-link-surface').last();
    await page.evaluate(() => addEventListener('click', event => {
      if (event.target.closest('.mini-board-card-link-surface')) window.departureScroll = scrollY;
    }, { capture: true, once: true }));
    await card.click();
    const departureScroll = await page.evaluate(() => window.departureScroll);
    expect(departureScroll).toBeGreaterThan(0);
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase', 'idle');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('#app')).toHaveAttribute('data-shell-game-panel', 'board');

    await page.goBack();
    await expect(section).toContainText('Page 2 of');
    await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase', 'idle');
    await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - departureScroll)).toBeLessThanOrEqual(1);
    await expect(card).toBeFocused();

    await page.goForward();
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase', 'idle');
    await page.getByRole('link', { name: 'Righelt', exact: true }).click();
    await expect(section).toContainText('Page 2 of');
    await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase', 'idle');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    const motion = await page.evaluate(() => window.routeMotion);
    if (reducedMotion === 'reduce') expect(motion).toHaveLength(0);
    else {
      expect(motion.some(frame => frame.direction === 'forward')).toBe(true);
      expect(motion.some(frame => frame.direction === 'back')).toBe(true);
      expect(motion.every(frame => Number(frame.opacity) === .94 && frame.display !== 'none')).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`home-navigation-${reducedMotion}.png`) });
  } finally { await closeContextQuietly(context); }
});

test('Back restores same-URL visits after passive utility dismissal and rapid reversal settles forward', async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);
  try {
    await page.setViewportSize({ width: 390, height: 600 });
    await createGamesViaApi(page, 1);
    await page.goto('/');
    await page.locator('[data-home-section-root="my"] .mini-board-card-link-surface').first().click();
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase', 'idle');
    const gameHash = await page.evaluate(() => location.hash);
    await page.evaluate(() => scrollTo({ top: 30, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(30);
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await page.locator('[data-action="open-scenarios"]').click();
    await expect(page.locator('[data-flyout="scenarios"]')).toBeVisible();
    await page.locator('.board-heading:visible').click();
    await expect(page.locator('[data-flyout="scenarios"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(gameHash);
    await page.evaluate(() => scrollTo({ top: 70, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(70);
    await page.evaluate(() => addEventListener('popstate', event => { window.utilityReturnY = event.state?.righeltVisit?.view?.y; }, { once: true }));
    await page.goBack();
    const returnY = await page.evaluate(() => window.utilityReturnY);
    expect(Number.isFinite(returnY)).toBe(true);
    expect(returnY).not.toBe(70);
    await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - returnY)).toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(gameHash);

    // Start a back transition and reverse before its cover settles.
    await page.evaluate(() => {
      window.rapidDirections = [];
      const layer = document.querySelector('#shell-route-transition-layer');
      new MutationObserver(() => { if (layer.dataset.phase === 'covering') window.rapidDirections.push(layer.dataset.direction); }).observe(layer, { attributes: true });
      addEventListener('hashchange', () => history.forward(), { once: true });
      history.back();
    });
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(gameHash);
    await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase', 'idle');
    await expect(page.locator('#app')).toHaveAttribute('data-shell-route', 'game');
    await expect.poll(() => page.evaluate(() => window.rapidDirections.includes('forward'))).toBe(true);
  } finally { await closeContextQuietly(context); }
});
