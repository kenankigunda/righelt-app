import { test, expect } from '@playwright/test';
import { createGameFromHome, makeAnyLegalMove } from '../support/app.mjs';

for (const supportsHover of [true, false]) test.describe(supportsHover ? 'hover client' : 'touch client', () => {
  test.use({ hasTouch: !supportsHover });
  test(`browser preview submits once after ${supportsHover ? 'hover' : 'click'} destination confirmation`, async ({ page, browserName }) => {
  await page.addInitScript(supportsHover => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = native(query);
      if (query === '(any-hover: hover)') Object.defineProperty(result, 'matches', { value: supportsHover });
      return result;
    };
  }, supportsHover);
  await createGameFromHome(page);
  // Firefox and WebKit emit native touch events with hasTouch while reporting zero points.
  if (supportsHover || browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.maxTouchPoints > 0)).toBe(!supportsHover);
  }
  await page.evaluate(() => {
    window.boardTouchEvents = [];
    document.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-testid="game-board"]')) {
        window.boardTouchEvents.push({ pointerType: event.pointerType, trusted: event.isTrusted });
      }
    });
  });
  await expect(page.locator('html')).toHaveAttribute('data-hover-capability', supportsHover ? 'hover' : 'none');
  const applied = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/apply')) applied.push(request); });
  await makeAnyLegalMove(page, 'p1', { touch: !supportsHover });
  if (!supportsHover) {
    expect(await page.evaluate(() => window.boardTouchEvents)).toEqual([
      { pointerType: 'touch', trusted: true },
      { pointerType: 'touch', trusted: true },
      { pointerType: 'touch', trusted: true },
    ]);
  }
  await expect.poll(() => applied.length).toBe(1);
  expect(applied[0].postDataJSON().protocolVersion).toBe(2);
  await expect(page.getByTestId('history-move-item')).toHaveCount(1);
  });
});
