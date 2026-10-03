import { test, expect } from '@playwright/test';
import { createGameFromHome, makeAnyLegalMove } from '../support/app.mjs';

for (const supportsHover of [true, false]) test(`browser preview submits once after ${supportsHover ? 'hover' : 'click'} destination confirmation`, async ({ page }) => {
  await page.addInitScript(supportsHover => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = native(query);
      if (query === '(any-hover: hover)') Object.defineProperty(result, 'matches', { value: supportsHover });
      return result;
    };
  }, supportsHover);
  await createGameFromHome(page);
  await expect(page.locator('html')).toHaveAttribute('data-hover-capability', supportsHover ? 'hover' : 'none');
  const applied = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/apply')) applied.push(request); });
  await makeAnyLegalMove(page);
  await expect.poll(() => applied.length).toBe(1);
  expect(applied[0].postDataJSON().protocolVersion).toBe(2);
  await expect(page.getByTestId('history-move-item')).toHaveCount(1);
});
