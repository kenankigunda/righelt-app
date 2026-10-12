import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/browser-integration/support/loading.html');await page.waitForFunction(()=>window.fixtureReady);});
test('short operations stay quiet, delayed cue keeps label and dimensions, completion removes it',async({page})=>{
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
 const button=page.getByRole('button',{name:'Start a friend game'});
 const before=await button.boundingBox();
 await page.evaluate(()=>window.setPending(true));
 await expect(button).toHaveAttribute('data-loading-phase','quiet');
 await page.clock.runFor(150);
 await expect(button.locator('.loading-pieces')).not.toBeVisible();
 await page.evaluate(()=>window.setPending(false));
 await page.clock.runFor(100);
 await expect(button.locator('.loading-pieces')).toHaveCount(0);
 await page.evaluate(()=>window.setPending(true));await page.clock.runFor(201);
 await expect(button.locator('.loading-pieces')).toBeVisible();
 expect((await button.boundingBox()).width).toBe(before.width);
 await expect(button).toHaveAccessibleName('Start a friend game');
 await expect(button).toBeDisabled();
 await page.evaluate(()=>window.setPending(false));
 await expect(button.locator('.loading-pieces')).toHaveCount(0);
});
test('slow context is explanatory, cancellation clears timers and leaves surroundings intact',async({page})=>{
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
 await page.evaluate(()=>{window.heading=document.querySelector('h2');document.querySelector('#region').dataset.loadingState='pending';document.querySelector('#region').setAttribute('aria-busy','true');});
 await page.clock.runFor(5001);
 await expect(page.getByRole('status')).toHaveText('Your game is taking a little longer to load.');
 expect(await page.getByRole('status').evaluate(el=>Boolean(el.closest('[aria-busy="true"]')))).toBe(false);
 await expect(page.getByRole('button',{name:'Retry'})).toHaveCount(0);
 await page.evaluate(()=>document.querySelector('#region').dataset.loadingState='idle');
 await expect(page.getByRole('status')).toHaveCount(0);
 await page.clock.runFor(6000);
 expect(await page.evaluate(()=>window.heading===document.querySelector('h2'))).toBe(true);
 await expect(page.locator('.loading-pieces')).toHaveCount(0);
});
test('reduced motion, hidden state and unmount do not keep animation or stale status',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>window.setPending(true));
 await expect(page.locator('.loading-pieces')).toBeVisible();
 expect(await page.locator('.loading-pieces i').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 expect(await page.locator('.loading-pieces i').first().evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('paused');
 await page.evaluate(()=>document.querySelector('#start').remove());
 await expect(page.locator('.loading-pieces')).toHaveCount(0);
});
test('closing a pending opponent introduction retires its clock before the cue appears',async({page})=>{
 await page.waitForFunction(()=>window.controllersReady);await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
 await page.evaluate(()=>{window.story.open('friend');document.querySelector('[data-story-play]').click();});
 await expect(page.locator('[data-story-play]')).toHaveAttribute('data-loading-phase','quiet');
 await page.evaluate(()=>window.story.close());await page.clock.runFor(6000);
 await expect(page.locator('dialog .loading-pieces')).toHaveCount(0);
 await expect(page.locator('dialog .loading-context')).toHaveCount(0);
 await page.evaluate(()=>{window.finishStart({state:'started'});window.story.open('friend');});
 await expect(page.getByRole('dialog',{name:'Friend',exact:true}).locator('[data-story-play]')).toBeEnabled();
 await expect(page.getByRole('dialog',{name:'Friend',exact:true}).locator('[data-story-play]')).not.toHaveAttribute('data-loading-phase');
});
test('real rematch and profile controllers expose slow feedback then retire it on completion',async({page})=>{
 await page.waitForFunction(()=>window.controllersReady);await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
 await page.evaluate(()=>{window.rematch.open({opponent:'friend',rematchSide:'p1'});document.querySelector('[data-rematch-start]').click();});
 await page.clock.runFor(5001);
 await expect(page.getByText('Starting your game is taking a little longer than usual.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Start game',exact:true})).toBeDisabled();
 await page.evaluate(()=>window.finishRematch());
 await expect(page.getByRole('dialog')).not.toBeVisible();
 await expect(page.locator('.loading-context')).toHaveCount(0);
 await page.evaluate(()=>{void window.profiles.open('loading_player',document.querySelector('[data-profile-key]'));});
 await page.clock.runFor(5001);
 await expect(page.locator('.loading-context').filter({hasText:'This profile is taking a little longer to load.'})).toBeVisible();
 await page.evaluate(()=>window.finishProfile());
 await expect(page.getByTestId('public-profile')).toHaveText('Joined January 2026');
 await expect(page.locator('.loading-context')).toHaveCount(0);
});
test('replacing a pending region preserves its episode and does not invent a new delay',async({page})=>{
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
 await page.evaluate(()=>document.querySelector('#region').dataset.loadingState='pending');
 await page.clock.runFor(4900);
 await page.evaluate(()=>{const old=document.querySelector('#region');const next=old.cloneNode(true);next.querySelector('.loading-pieces')?.remove();old.replaceWith(next);});
 await page.clock.runFor(101);
 await expect(page.getByRole('status')).toHaveText('Your game is taking a little longer to load.');
 await page.evaluate(()=>document.querySelector('#region').remove());
 await page.clock.runFor(6000);
 await expect(page.locator('.loading-context')).toHaveCount(0);
});
test('recovery can own its context without a second ordinary-loading announcement',async({page})=>{
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
 await page.evaluate(()=>{const region=document.querySelector('#region');region.dataset.loadingContext='external';region.dataset.loadingState='pending';});
 await page.clock.runFor(6000);
 await expect(page.locator('#region > .loading-pieces')).toBeVisible();
 await expect(page.getByRole('status')).toHaveCount(0);
});

test('a centered wide action replaces its icon in place without moving its label',async({page})=>{
 await page.waitForFunction(()=>window.controllersReady);
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
 await page.evaluate(()=>window.story.open('friend'));
 const button=page.getByRole('dialog',{name:'Friend',exact:true}).locator('[data-story-play]');
 await button.evaluate(el=>el.style.width='100%');
 const icon=await button.locator('svg').boundingBox();const before=await button.boundingBox();
 await button.evaluate(el=>el.click());await page.clock.runFor(201);
 const cue=await button.locator('.loading-pieces').boundingBox();
 expect(Math.abs(cue.x+cue.width/2-icon.x-icon.width/2)).toBeLessThan(1);
 expect((await button.boundingBox()).width).toBe(before.width);
 await expect(button).toHaveAccessibleName('Start a friend game');
 await expect(button.locator('svg')).not.toBeVisible();
});


test('unknown home content reserves one row at phone, medium and wide widths', async ({page}) => {
  await page.goto('/browser-integration/support/loading.html');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(()=>{
    document.querySelector('main').style.maxWidth='1200px';
    document.querySelector('main').innerHTML='<section class="panel"><div class="mini-board-card-list mini-board-card-list-skeleton">'+Array.from({length:3},()=>'<article class="mini-board-card mini-board-card-skeleton"><div class="skeleton-board"></div></article>').join('')+'</div></section><button id="available">Start something new</button>';
  });
  for(const [width,available] of [[390,1200],[768,1200],[1024,1200],[1366,1200],[1366,842]]){
    await page.setViewportSize({width,height:844});
    await page.locator("main").evaluate((el,size)=>el.style.maxWidth=`${size}px`,available);
    const rows=await page.locator('.mini-board-card-skeleton:visible').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
    expect(new Set(rows).size).toBe(1);
    await expect(page.locator('#available')).toBeInViewport();
  }
});
