import { test, expect } from '@playwright/test';

test('early opponent introduction survives initial guest session adoption', async ({ page }) => {
  let release, entered, releaseModel, modelEntered;
  const held = new Promise(resolve => { release = resolve; });
  const intercepted = new Promise(resolve => { entered = resolve; });
  const modelHeld = new Promise(resolve => { releaseModel = resolve; });
  const modelIntercepted = new Promise(resolve => { modelEntered = resolve; });
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
  await page.route('**/computer/models/*.onnx', async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    modelEntered();
    await modelHeld;
    await route.fulfill({ response });
  });
  try {
    await page.goto('/');
    await intercepted;
    const trigger = page.locator('button[data-opponent="babs"]');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Babs', exact: true });
    await expect(dialog).not.toBeVisible();
    expect(creates).toHaveLength(0);
    release();
    await expect(dialog).toBeVisible();
    await modelIntercepted;
    await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-story-play]')).toBeDisabled();
    await expect(dialog.locator('[data-story-readiness]')).toHaveAttribute('data-loading-state', 'pending');
    await expect(page.getByTestId('account-dialog')).not.toBeVisible();
    expect(creates).toHaveLength(0);
    releaseModel();
    await expect(dialog.locator('[data-story-play]')).toBeEnabled();
    await expect(dialog.locator('[data-story-readiness]')).toHaveText('Ready to play');
    expect(creates).toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  } finally {
    release();
    releaseModel();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('logical early-create intent waits for guest bootstrap without opening account sign-in', async ({ page }, info) => {
  let entered, rejectAdmission;
  const intercepted = new Promise((resolve, reject) => { entered = resolve; rejectAdmission = reject; });
  // Observe a route failure immediately, including while navigation is pending.
  void intercepted.catch(() => {});
  const creates = [];
  let bootstrapRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/shell/games') creates.push(request);
  });
  await page.route('**/api/shell/bootstrap', async route => {
    let settled = false;
    try {
      bootstrapRequests++;
      expect(bootstrapRequests, 'Intent must precede the first bootstrap response, not a retry').toBe(1);
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      expect((await response.json()).accountsRequired).toBe(false);
      // This case proves logical intent admission. Execute at the actual held
      // response barrier so pointer scrolling cannot consume the real five-second budget.
      // Separate pointer journeys retain trusted input and geometry coverage.
      const admission = await page.evaluate(() => {
        const button = document.querySelector('[data-testid="home-create-game"]');
        const visible = element => Boolean(element?.isConnected && element.getClientRects().length
          && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none');
        if (!(button instanceof HTMLButtonElement) || !visible(button)
          || button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true' || button.closest('[inert]'))
          throw Error('A visible enabled Home create control is required for early intent');
        const activatedAt = performance.now();
        button.click();
        return {kind: 'logical-early-create-intent', activatedAt, target: button.dataset.testid,
          visible: true, enabled: true, accountDialogVisible: visible(document.querySelector('[data-testid="account-dialog"]'))};
      });
      expect(admission.accountDialogVisible).toBe(false);
      expect(creates).toHaveLength(0);
      expect(route.request().failure(), 'Initial bootstrap must still be pending at intent admission').toBeNull();
      await route.fulfill({ response });
      settled = true;
      entered(admission);
    } catch (error) {
      rejectAdmission(error);
      if (!settled) {
        try { await route.abort('failed'); settled = true; } catch { /* Preserve the original admission failure. */ }
      }
    }
  });
  let primaryError;
  try {
    const [, admission] = await Promise.all([page.goto('/'), intercepted]);
    await info.attach('early-create-intent-admission', {body: JSON.stringify(admission), contentType: 'application/json'});
    await expect(page.getByTestId('account-dialog')).not.toBeVisible();
    expect(creates).toHaveLength(0);
    const created = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/shell/games');
    await expect(page.getByRole('dialog',{name:'Friend',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Start a friend game',exact:true}).click();
    expect((await created).ok()).toBe(true);
    await expect(page).toHaveURL(/#\/game\//);
    await expect(page.getByTestId('game-role')).toContainText('Player 1');
    await expect(page.getByTestId('account-dialog')).not.toBeVisible();
    expect(creates).toHaveLength(1);
    expect(bootstrapRequests).toBe(1);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try { await page.unrouteAll({ behavior: 'wait' }); }
    catch (error) { if (!primaryError) throw error; }
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

// The real Home read has a five-second request bound. Keep that bound intact;
// the renderer fixture separately exercises naturally prolonged slow notices.
test('cold Home loading keeps its bounded card until a read succeeds',async({page},info)=>{
 await page.setViewportSize({width:390,height:800});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let release,entered=false;const held=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/shell/games?**',async route=>{
  const url=new URL(route.request().url());
  if(url.searchParams.get('section')!=='my')return route.continue();
  const response=await route.fetch();expect(response.ok()).toBe(true);entered=true;
  await held;await route.fulfill({response});
 });
 try{
  await page.goto('/');await expect.poll(()=>entered).toBe(true);
  const card=page.locator('[data-testid="home-section-skeleton"][data-home-section-root="my"]');
  await expect(card).toBeVisible();await page.evaluate(()=>document.fonts.ready);
  await expect(card).toHaveAttribute('data-loading-phase','visible');
  const before=await card.evaluate(node=>{
   const cue=node.querySelector(':scope > .loading-pieces'),clock=cue.querySelector('i').getAnimations()[0];
   const rect=node.getBoundingClientRect().toJSON();window.boundedHomeFrames=[];
   const sample=()=>{if(!node.isConnected)return;window.boundedHomeFrames.push({rect:node.getBoundingClientRect().toJSON(),same:node.querySelector(':scope > .loading-pieces')===cue&&cue.querySelector('i').getAnimations()[0]===clock,time:clock.currentTime,inlineContext:Boolean(node.querySelector('.loading-context'))});requestAnimationFrame(sample);};sample();
   return {rect,time:clock.currentTime,at:performance.now()};
  });
  // A cold destination stays covered until an actual read succeeds. Its
  // foreground recovery controls remain outside the stable pending card.
  const recovery=page.getByTestId('destination-load-notice');
  await expect(recovery).toBeVisible({timeout:7000});
  await expect(recovery.getByRole('button',{name:'Retry',exact:true})).toBeVisible({timeout:13000});
  await expect(recovery.getByRole('link',{name:'Home',exact:true})).toHaveAttribute('href','#/');
  await expect(card).toHaveCount(1);
  const frames=await page.evaluate(()=>window.boundedHomeFrames);
  const blockedSlowNotices=await page.getByTestId('slow-loading-notice').count();
  await info.attach('mounted-home-bounded-layout',{body:JSON.stringify({before,frames,blockedSlowNotices}),contentType:'application/json'});
  expect(frames.length).toBeGreaterThan(2);
  for(const frame of frames){expect(frame.rect).toEqual(before.rect);expect(frame.same).toBe(true);expect(frame.inlineContext).toBe(false);}
  expect(frames.at(-1).time).toBeGreaterThan(before.time);
  release();await expect(card).toHaveCount(0);await expect(recovery).toBeHidden();
  await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase','idle');
  await expect(page.getByTestId('slow-loading-notice')).toHaveCount(0);
  expect(blockedSlowNotices).toBe(0);expect(errors).toEqual([]);
 }finally{release();await page.unrouteAll({behavior:'wait'});}
});
