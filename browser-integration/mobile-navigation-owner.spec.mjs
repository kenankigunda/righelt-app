import { test, expect } from '@playwright/test';
import { boardActionTraversalKey } from '../e2e/support/native-board-keyboard.mjs';

// Product-owner integration. Native input and the production owner/CSS stay real.
// Only the clock is advanced on this isolated page, never on the retained game.
for (const protection of ['hover', 'keyboard']) test(`mobile navigation protects ${protection} ownership across idle expiry`, async ({ page, browserName }, info) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.route('**/mobile-navigation-owner-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/apps/web/styles.css"><link rel="stylesheet" href="/apps/web/shell/shell.css"><link rel="stylesheet" href="/apps/web/shell/refresh.css"><link rel="stylesheet" href="/apps/web/shell/board-ux.css"></head><body>
<main id="app" data-shell-route="game" data-shell-layout-mode="narrow"><button id="outside">Outside navigation</button>
<nav class="shell-mobile-tabbar" aria-label="Game panels" data-visible="true">
<button type="button" class="mobile-nav-reveal" data-mobile-nav-reveal aria-label="Show game navigation" aria-expanded="true"></button>
<div class="mobile-nav-controls" data-mobile-nav-controls><button type="button" class="shell-mobile-tab" data-panel="players">Players</button><button type="button" class="shell-mobile-tab" data-panel="board">Board</button><button type="button" class="shell-mobile-tab" data-panel="history">History</button></div></nav></main></body></html>` }));
  await page.goto('/mobile-navigation-owner-fixture');
  await page.clock.install();
  const idleMs = await page.evaluate(async () => {
    const { mountMobileNavigation, MOBILE_NAVIGATION } = await import('/apps/web/shell/mobile-navigation.js');
    window.navigationOwner = mountMobileNavigation({ window, document, isNarrow: () => document.querySelector('#app').dataset.shellLayoutMode === 'narrow' });
    window.navigationOwner.sync();
    return MOBILE_NAVIGATION.idleMs;
  });
  expect(idleMs).toBe(3000);
  const observations = [];
  const sample = async phase => {
    const row = await page.locator('.shell-mobile-tabbar').evaluate(nav => ({
      now: Date.now(), hover: nav.matches(':hover'), hoverMedia: matchMedia('(hover:hover)').matches,
      keyboardFocus: nav.contains(document.activeElement) && document.activeElement.matches(':focus-visible'),
      visible: nav.dataset.visible, inert: nav.querySelector('[data-mobile-nav-controls]').inert,
      expanded: nav.querySelector('[data-mobile-nav-reveal]').getAttribute('aria-expanded'), scrollY
    }));
    observations.push({ phase, ...row });
    return row;
  };
  try {
    const outside = page.locator('#outside');
    await outside.click();
    if (protection === 'hover') {
      await page.getByRole('button', { name: 'Show game navigation', exact: true }).click();
      await page.locator('[data-panel="board"]').hover();
    } else {
      await page.keyboard.press(boardActionTraversalKey({ platform: process.platform, browserName }));
      await expect(page.getByRole('button', { name: 'Show game navigation', exact: true })).toBeFocused();
    }
    const before = await sample('owned-before-expiry');
    expect(before.visible).toBe('true');
    expect(before.inert).toBe(false);
    expect(before.expanded).toBe('true');
    if (protection === 'hover') {
      expect(before.hover).toBe(true);
      expect(before.hoverMedia).toBe(true);
      expect(before.keyboardFocus).toBe(false);
    } else {
      expect(before.hover).toBe(false);
      expect(before.keyboardFocus).toBe(true);
    }
    await page.clock.runFor(idleMs + 1);
    const owned = await sample('owned-after-expiry');
    expect(owned.now - before.now).toBeGreaterThanOrEqual(idleMs + 1);
    expect(owned.scrollY).toBe(before.scrollY);
    expect(owned.visible).toBe('true');
    expect(owned.inert).toBe(false);
    expect(owned.expanded).toBe('true');
    expect(protection === 'hover' ? owned.hover && owned.hoverMedia : owned.keyboardFocus).toBe(true);
    // Negative control: the same real owner must hide after ownership is removed.
    await outside.click();
    const released = await sample('released-before-expiry');
    expect(released.hover).toBe(false);
    expect(released.keyboardFocus).toBe(false);
    await page.clock.runFor(idleMs + 1);
    const hidden = await sample('released-after-expiry');
    expect(hidden.now - released.now).toBeGreaterThanOrEqual(idleMs + 1);
    expect(hidden.visible).toBe('false');
    expect(hidden.inert).toBe(true);
    expect(hidden.expanded).toBe('false');
  } finally {
    await info.attach('navigation-owner-observations', { body: JSON.stringify({ protection, idleMs, observations }), contentType: 'application/json' });
    await page.evaluate(() => window.navigationOwner.destroy());
  }
});
