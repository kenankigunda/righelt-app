import { test, expect } from '@playwright/test';
import { createGameFromHome, makeAnyLegalMove } from '../support/app.mjs';

for (const supportsHover of [true, false]) test(`browser move submission follows ${supportsHover ? 'hover' : 'click'} destination selection`, async ({ page }) => {
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
  let applied;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/apply')) applied = request; });
  await makeAnyLegalMove(page);
  await expect.poll(() => Boolean(applied)).toBe(true);
  expect(applied.postDataJSON().protocolVersion).toBe(2);
  await expect(page.getByTestId('history-move-item')).toHaveCount(1);
});
