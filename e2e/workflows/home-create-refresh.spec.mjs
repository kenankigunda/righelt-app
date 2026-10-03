import { test, expect } from '@playwright/test';

for (const input of ['pointer', 'keyboard']) test(`home refresh preserves ${input} activation already in progress`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/shell/games?**', async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  const creates = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/shell/games') creates.push(request); });
  await page.goto('/');
  const button = page.getByTestId('home-create-game');
  await expect(button).toBeVisible();
  await expect(page.getByTestId('home-section-skeleton').first()).toBeVisible();
  await button.evaluate(element => { window.originalCreateButton = element; });
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  if (input === "pointer") { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); }
  else { await button.focus(); await page.keyboard.down("Space"); }
  try {
    release();
    await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
    const connected = await page.evaluate(() => window.originalCreateButton.isConnected);
    await info.attach('create-node-after-refresh', { body: JSON.stringify({ connected }), contentType: 'application/json' });
    if (input === "keyboard") expect(await page.evaluate(() => document.activeElement === window.originalCreateButton)).toBe(true);
    if (input === "pointer") await page.mouse.up(); else await page.keyboard.up("Space");
    expect(connected, 'A response must not detach the pressed create control').toBe(true);
    await expect.poll(() => creates.length).toBe(1);
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await expect(page.getByTestId('game-role')).toContainText('Player 1');
  } finally { release(); await page.mouse.up(); await page.keyboard.up("Space"); await page.unrouteAll({ behavior: 'ignoreErrors' }); }
});
