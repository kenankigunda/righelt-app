import { test, expect } from '@playwright/test';

test('early create waits for guest bootstrap without opening account sign-in', async ({ page }) => {
  let release, entered;
  const held = new Promise(resolve => { release = resolve; });
  const intercepted = new Promise(resolve => { entered = resolve; });
  const creates = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/shell/games') creates.push(request);
  });
  await page.route('**/api/shell/bootstrap', async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    expect((await response.json()).accountsRequired).toBe(false);
    entered();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.goto('/');
    await intercepted;
    await page.getByTestId('home-create-game').click();
    await expect(page.getByTestId('account-dialog')).not.toBeVisible();
    expect(creates).toHaveLength(0);
    const created = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/shell/games');
    release();
    await page.getByRole('button',{name:'Start a friend game',exact:true}).click();
    expect((await created).ok()).toBe(true);
    await expect(page).toHaveURL(/#\/game\//);
    await expect(page.getByTestId('game-role')).toContainText('Player 1');
    await expect(page.getByTestId('account-dialog')).not.toBeVisible();
    expect(creates).toHaveLength(1);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const input of ['pointer', 'keyboard']) test(`home refresh preserves ${input} activation already in progress`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const completedSections = new Set();
  page.on('response', async response => {
    const url = new URL(response.url());
    if (url.pathname !== '/api/shell/games' || !url.searchParams.has('section')) return;
    if (await response.finished() === null) completedSections.add(url.searchParams.get('section'));
  });
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
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  if (input === "pointer") { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); }
  else { await button.focus(); await page.keyboard.down("Space"); }
  try {
    release();
    await expect.poll(() => completedSections.size).toBe(2);
    // Account UI defers rendering during a held activation. Let response
    // microtasks and the next paint finish without requiring that deferred UI.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const connected = await page.evaluate(() => window.originalCreateButton.isConnected);
    await info.attach('create-node-after-refresh', { body: JSON.stringify({ connected }), contentType: 'application/json' });
    if (input === "keyboard") expect(await page.evaluate(() => document.activeElement === window.originalCreateButton)).toBe(true);
    expect(connected, 'A response must not detach the pressed create control').toBe(true);
    expect(creates).toHaveLength(0);
    if (input === "pointer") await page.mouse.up(); else await page.keyboard.up("Space");
    await expect(page.getByRole('dialog',{name:'Friend',exact:true})).toBeVisible();
    expect(creates).toHaveLength(0);
    await page.getByRole('button',{name:'Start a friend game',exact:true}).click();
    await expect.poll(() => creates.length).toBe(1);
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await expect(page.getByTestId('game-role')).toContainText('Player 1');
  } finally { release(); await page.mouse.up(); await page.keyboard.up("Space"); await page.unrouteAll({ behavior: 'ignoreErrors' }); }
});
