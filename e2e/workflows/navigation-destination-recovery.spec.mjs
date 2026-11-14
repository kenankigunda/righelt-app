import {test as base,expect} from '@playwright/test';
import {ownedContexts} from '../support/owned-contexts.mjs';
import {createGamesViaApi,getCurrentGameIdFromPage} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
const test=base.extend({ownedContext:async({browser},use)=>{const owned=ownedContexts(browser);try{await use(options=>owned.create(options));}finally{await owned.close();}}});
const mutation=request=>request.method()!=='GET' && /\/(apply|end-turn|commands)(?:\/|$)/.test(new URL(request.url()).pathname);

test('a held cold destination exposes delayed recovery, retries503reads and restores usable Home on Back',async({ownedContext,baseURL},info)=>{
 const context=await ownedContext({baseURL,viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage();
 // Exercise the supported HTTP recovery path while live transport is unavailable.
 await page.addInitScript(()=>{window.WebSocket=undefined;});
 await createGamesViaApi(page,9);await page.goto('/');
 const section=page.locator('[data-home-section-root="my"]');
 await section.locator('[data-action="home-page-next"]').tap();await expect(section).toContainText('Page 2 of');
 const card=section.locator('.mini-board-card-link-surface').last(),id=await card.getAttribute('data-game-id');
 let release,mode='hold',reads=0;const gate=new Promise(resolve=>release=resolve),writes=[];
 page.on('request',request=>{if(mutation(request))writes.push(request.url());});
 await page.route(url=>[`/api/shell/games/${id}`,`/api/shell/games/${id}/position`,`/api/shell/games/${id}/reconcile`].includes(url.pathname),async route=>{reads++;if(mode==='hold')await gate;if(mode==='healthy')await route.continue();else await route.fulfill({status:503,json:{error:'temporarily_unavailable'}});});
 try{
  await page.evaluate(()=>{window.destinationNoticeMountStates=[];new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===Node.ELEMENT_NODE&&node.matches?.('[data-testid="destination-load-notice"]')){const capture=()=>window.destinationNoticeMountStates.push({state:node.dataset.state,hidden:node.hidden,inert:node.hasAttribute('inert'),ariaHidden:node.getAttribute('aria-hidden')});capture();new MutationObserver(capture).observe(node,{attributes:true,attributeFilter:['data-state','hidden','inert','aria-hidden']});}}).observe(document.body,{childList:true});});
  await page.evaluate(()=>addEventListener('click',event=>{if(event.target.closest('.mini-board-card-link-surface'))window.departureY=scrollY;},{capture:true,once:true}));
  await card.tap();await expect.poll(()=>reads).toBeGreaterThan(0);
  const notice=page.getByTestId('destination-load-notice'),layer=page.locator('#shell-route-transition-layer');
  await page.waitForTimeout(1000);await expect(notice).not.toBeVisible();await expect(layer).toHaveAttribute('data-phase','covered');
  const swipe=layer.locator('.shell-route-transition-layer-swipe');await swipe.evaluate(node=>{window.retainedDestinationSwipe=node;window.retainedDestinationFieldClock=node.getAnimations({subtree:true}).find(animation=>animation.animationName==='shell-held-facet-pulse')??null;});
  await expect(notice).toBeVisible({timeout:5500});await expect(notice).toContainText('Opening your game');
  expect(await page.evaluate(()=>window.destinationNoticeMountStates.some(entry=>entry.state==='entering'&&!entry.hidden&&!entry.inert&&entry.ariaHidden===null))).toBe(true);
  await expect(notice).toHaveAttribute('data-presentation','quiet-field');await expect(notice.locator('.shell-game-alert')).toHaveCount(0);
  const mobileComposition=await notice.evaluate(node=>{const noticeRect=node.getBoundingClientRect(),content=node.querySelector('.destination-load-field-content').getBoundingClientRect();return {centerDelta:Math.abs((content.top+content.height/2)-(noticeRect.top+noticeRect.height/2)),width:content.width,viewport:innerWidth};});
  expect(mobileComposition.viewport).toBe(390);expect(mobileComposition.centerDelta).toBeLessThanOrEqual(1);expect(mobileComposition.width).toBeLessThanOrEqual(290);
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  const zoomedComposition=await notice.evaluate(node=>{const content=node.querySelector('.destination-load-field-content').getBoundingClientRect(),root=document.documentElement;return{left:content.left,right:content.right,top:content.top,bottom:content.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,overflow:root.scrollWidth-root.clientWidth};});
  expect(zoomedComposition.left).toBeGreaterThanOrEqual(0);expect(zoomedComposition.right).toBeLessThanOrEqual(zoomedComposition.viewportWidth);expect(zoomedComposition.top).toBeGreaterThanOrEqual(0);expect(zoomedComposition.bottom).toBeLessThanOrEqual(zoomedComposition.viewportHeight);expect(zoomedComposition.overflow).toBeLessThanOrEqual(1);
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  const entranceMotion=await swipe.evaluate(node=>({sameNode:node===window.retainedDestinationSwipe,sameClock:Boolean(window.retainedDestinationFieldClock)&&node.getAnimations({subtree:true}).includes(window.retainedDestinationFieldClock),time:window.retainedDestinationFieldClock?.currentTime??-1}));expect(entranceMotion).toMatchObject({sameNode:true,sameClock:true});expect(entranceMotion.time).toBeGreaterThan(0);
  await page.setViewportSize({width:1440,height:900});
  expect(await notice.evaluate(el=>Number(getComputedStyle(el).zIndex))).toBeGreaterThan(await layer.evaluate(el=>Number(getComputedStyle(el).zIndex)));
  await page.screenshot({path:info.outputPath('cold-held-status.png')});
  await expect(notice.getByRole('button',{name:'Retry',exact:true})).toBeVisible({timeout:13000});await expect(notice.getByRole('link',{name:'Home',exact:true})).toBeVisible();
  const retry=notice.getByRole('button',{name:'Retry',exact:true});
  for(let index=0;index<12 && !await retry.evaluate(el=>el===document.activeElement);index++)await page.keyboard.press(info.project.name==='webkit'?'Alt+Tab':'Tab');
  await expect(retry).toBeFocused();
  await retry.evaluate(el=>{window.retainedDestinationRetry=el;});const focusedRead=reads;
  await expect.poll(()=>reads,{timeout:8000}).toBeGreaterThan(focusedRead);
  await expect(retry).toBeFocused();expect(await retry.evaluate(el=>el===window.retainedDestinationRetry)).toBe(true);
  for(const control of [retry,notice.getByRole('link',{name:'Home',exact:true})])expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(notice.locator('[data-notification-activity]')).toHaveCount(0);
  mode='fail';release();await expect.poll(()=>reads).toBeGreaterThan(1);
  await expect(layer).toHaveAttribute('data-phase','covered');await expect(page.getByTestId('game-board')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('cold-503-recovery.png')});
  await page.evaluate(()=>{window.destinationNoticeStates=[];const node=document.querySelector('[data-testid="destination-load-notice"]'),capture=()=>window.destinationNoticeStates.push({state:node.dataset.state,phase:document.querySelector('#shell-route-transition-layer')?.dataset.phase,inert:node.hasAttribute('inert'),ariaHidden:node.getAttribute('aria-hidden'),activeInside:node.contains(document.activeElement)});new MutationObserver(capture).observe(node,{attributes:true,attributeFilter:['data-state','hidden','inert','aria-hidden']});});
  await notice.getByRole('button',{name:'Retry',exact:true}).tap();mode='healthy';
  await expect(page.getByTestId('game-board')).toBeVisible({timeout:15000});await expect(layer).toHaveAttribute('data-phase','idle');await expect(notice).not.toBeVisible();
  expect(await page.evaluate(()=>window.destinationNoticeStates.some(entry=>entry.state==='exiting'))).toBe(true);
  expect(await page.evaluate(()=>window.destinationNoticeStates.some(entry=>entry.state==='exiting'&&entry.inert&&entry.ariaHidden==='true'&&!entry.activeInside))).toBe(true);
  expect(writes).toEqual([]);
  await page.setViewportSize({width:390,height:844});
  let homeReads=0;await page.route(url=>url.pathname==='/api/shell/games',async route=>{homeReads++;await route.fulfill({status:503,json:{error:'temporarily_unavailable'}});});
  await page.goBack();await expect(section).toContainText('Page 2 of');await expect(layer).toHaveAttribute('data-phase','idle');
  await expect(card).toBeVisible();await expect(card).toBeFocused();await expect.poll(async()=>Math.abs(await page.evaluate(()=>scrollY-window.departureY))).toBeLessThanOrEqual(1);
  await expect.poll(()=>homeReads).toBeGreaterThan(1);await expect(notice).not.toBeVisible();
  await page.screenshot({path:info.outputPath('warm-home-503.png')});expect(writes).toEqual([]);
 }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('reduced motion bypasses the animated Quiet field with static readable non-authoritative feedback',async({ownedContext,baseURL},info)=>{
 test.skip(info.project.name!=='chromium','One native reduced-motion contract is sufficient.');
 const context=await ownedContext({baseURL,viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage();
 await page.addInitScript(()=>{window.WebSocket=undefined;});
 const [id]=await createGamesViaApi(page,1);await page.goto('/');let release;const gate=new Promise(resolve=>release=resolve),writes=[];
 page.on('request',request=>{if(mutation(request))writes.push(request.url());});
 await page.route(url=>[`/api/shell/games/${id}`,`/api/shell/games/${id}/position`,`/api/shell/games/${id}/reconcile`].includes(url.pathname),async route=>{await gate;await route.abort();});
 try{
  await page.locator(`[data-game-id="${id}"].mini-board-card-link-surface`).tap();
  const notice=page.getByTestId('destination-load-notice');await expect(notice).toBeVisible({timeout:5500});await expect(notice).toHaveAttribute('data-presentation','card');await expect(notice).toContainText('Opening your game');await expect(notice.locator('.shell-game-alert')).toHaveCount(1);await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-active','false');
  const presentation=await notice.evaluate(node=>{const rect=node.getBoundingClientRect(),animated=node.getAnimations({subtree:true}).filter(animation=>animation.playState!=='finished');return{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,animated:animated.length};});
  expect(presentation.animated).toBe(0);expect(presentation.left).toBeGreaterThanOrEqual(0);expect(presentation.right).toBeLessThanOrEqual(presentation.viewportWidth);expect(presentation.top).toBeGreaterThanOrEqual(0);expect(presentation.bottom).toBeLessThanOrEqual(presentation.viewportHeight);expect(writes).toEqual([]);
 }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('failed background reads retain a usable warm board without a blocking destination cover',async({ownedContext,baseURL},info)=>{
 const context=await ownedContext({baseURL,viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage();
 let reads=0,blockedSockets=0,failSockets=false;const sockets=[];
 await context.routeWebSocket(/.*/,socket=>{if(failSockets){blockedSockets++;socket.close({code:1011,reason:'Test transport unavailable'});}else{socket.connectToServer();sockets.push(socket);}});
 const writes=[],observed=[];page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/shell/games/'))observed.push({method:request.method(),path});});
 const [createdId]=await createGamesViaApi(page,1);await page.goto(`/#/game/${createdId}`);
 await page.bringToFront();await expect(page.getByTestId('game-board')).toBeVisible();
 await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase','idle');
 const id=await getCurrentGameIdFromPage(page);
 await page.bringToFront();
 await expect.poll(()=>page.evaluate(()=>window.__righeltLiveSyncMetrics?.activeSocketCount??0)).toBeGreaterThan(0);
 const before=await page.evaluate(readProjectedGame,{id,guest:true});
 const pieces=()=>page.getByTestId('game-board').locator('[data-piece-id]').evaluateAll(tokens=>tokens.map(token=>({id:token.dataset.pieceId,row:token.closest('.cell').dataset.row,col:token.closest('.cell').dataset.col})));const visibleBefore=await pieces();expect(visibleBefore.length).toBeGreaterThan(0);
 page.on('request',request=>{if(mutation(request))writes.push(request.url());});
 await page.route(url=>[`/api/shell/games/${id}`,`/api/shell/games/${id}/position`,`/api/shell/games/${id}/reconcile`].includes(url.pathname),async route=>{reads++;await route.fulfill({status:503,json:{error:'temporarily_unavailable'}});});
 failSockets=true;for(const socket of sockets){blockedSockets++;socket.close({code:1011,reason:'Test transport unavailable'});}
 await expect.poll(()=>blockedSockets).toBeGreaterThan(0);
 try{await expect.poll(()=>reads,{timeout:10000}).toBeGreaterThan(0);}finally{await info.attach('warm-read-observation',{body:JSON.stringify({id,observed,metrics:await page.evaluate(()=>window.__righeltLiveSyncMetrics)},null,2),contentType:'application/json'});}
 await expect(page.getByTestId('game-board')).toBeVisible();await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase','idle');await expect(page.getByTestId('destination-load-notice')).not.toBeVisible();
 const identity=await page.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));const response=await context.request.get(`/api/shell/games/${id}?identityId=${encodeURIComponent(identity)}`);expect(response.ok()).toBe(true);const {game:after}=await response.json();expect(await pieces()).toEqual(visibleBefore);expect(after.board.state).toEqual(before.board.state);expect(after.gameplayRevision).toBe(before.gameplayRevision);expect(writes).toEqual([]);
 await page.screenshot({path:info.outputPath('warm-board-503.png')});await page.unrouteAll({behavior:'wait'});
});

test('a confirmed missing destination offers a native Home exit without retry or motion',async({ownedContext,baseURL},info)=>{
 const context=await ownedContext({baseURL,viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage();
 await page.addInitScript(()=>{window.WebSocket=undefined;});
 const [id]=await createGamesViaApi(page,1);await page.goto('/');let reads=0;
 await page.route(url=>[`/api/shell/games/${id}`,`/api/shell/games/${id}/position`,`/api/shell/games/${id}/reconcile`].includes(url.pathname),async route=>{reads++;await route.fulfill({status:404,json:{error:'game_not_found'}});});
 await page.locator(`[data-game-id="${id}"].mini-board-card-link-surface`).tap();
 const notice=page.getByTestId('destination-load-notice');await expect(notice).toContainText('This game is no longer available');await expect(notice.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
 await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-active','false');
 await expect.poll(async()=>{const before=reads;await page.waitForTimeout(500);return reads-before;},{timeout:5000}).toBe(0);
 const count=reads;await page.waitForTimeout(1000);expect(reads).toBe(count);
 await page.screenshot({path:info.outputPath('missing-reduced-motion.png')});
 await notice.getByRole('link',{name:'Home',exact:true}).tap();await expect(page.getByTestId('home-create-game')).toBeVisible();await expect(notice).not.toBeVisible();
 await page.unrouteAll({behavior:'wait'});
});

test('an invalid persisted game is terminal and Home retires its cold recovery owner',async({ownedContext,baseURL})=>{
 const context=await ownedContext({baseURL,viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage();
 await page.addInitScript(()=>{window.WebSocket=undefined;});
 const [id]=await createGamesViaApi(page,1);await page.goto('/');let reads=0;
 await page.route(url=>[`/api/shell/games/${id}`,`/api/shell/games/${id}/position`,`/api/shell/games/${id}/reconcile`].includes(url.pathname),async route=>{reads++;await route.fulfill({status:500,json:{error:'invalid_persisted_game'}});});
 await page.locator(`[data-game-id="${id}"].mini-board-card-link-surface`).tap();
 const notice=page.getByTestId('destination-load-notice');await expect(notice).toContainText('We couldn’t safely open your game');
 await expect(notice.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
 const terminalReads=reads;await page.waitForTimeout(1000);expect(reads).toBe(terminalReads);
 await notice.getByRole('link',{name:'Home',exact:true}).tap();await expect(page.getByTestId('home-create-game')).toBeVisible();await expect(notice).not.toBeVisible();
 await page.waitForTimeout(1000);expect(reads).toBe(terminalReads);
 await page.unrouteAll({behavior:'wait'});
});

test('leaving through a focused Home control retires the stale notice and focus',async({ownedContext,baseURL})=>{
 const context=await ownedContext({baseURL,viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage();
 await page.addInitScript(()=>{window.WebSocket=undefined;});
 const [id]=await createGamesViaApi(page,1);await page.goto('/');
 await page.route(url=>[`/api/shell/games/${id}`,`/api/shell/games/${id}/position`,`/api/shell/games/${id}/reconcile`].includes(url.pathname),route=>route.fulfill({status:404,json:{error:'game_not_found'}}));
 await page.locator(`[data-game-id="${id}"].mini-board-card-link-surface`).tap();
 const notice=page.getByTestId('destination-load-notice'),home=notice.getByRole('link',{name:'Home',exact:true});
 await expect(notice).toContainText('This game is no longer available');await home.focus();await expect(home).toBeFocused();await home.tap();
 await expect(page.getByTestId('home-create-game')).toBeVisible();await expect(notice).not.toBeVisible();await expect(notice).toHaveAttribute('inert','');expect(await notice.evaluate(node=>node.contains(document.activeElement))).toBe(false);
 await page.unrouteAll({behavior:'wait'});
});

test('a cold Home resize keeps recovery ownership through a failed read and automatic retry',async({ownedContext,baseURL},info)=>{
 const context=await ownedContext({baseURL,viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage();
 const [createdId]=await createGamesViaApi(page,1);let release,mode='hold',reads=0;const gate=new Promise(resolve=>release=resolve),writes=[];
 page.on('request',request=>{if(mutation(request))writes.push(request.url());});
 await page.route(url=>url.pathname==='/api/shell/games',async route=>{reads++;if(mode==='hold')await gate;if(mode==='healthy')await route.continue();else await route.fulfill({status:503,json:{error:'temporarily_unavailable'}});});
 try{
  await page.goto('/');await expect.poll(()=>reads).toBeGreaterThan(0);await page.waitForTimeout(1000);await page.setViewportSize({width:1440,height:900});
  const notice=page.getByTestId('destination-load-notice');await expect(notice).toContainText('Opening your games',{timeout:5500});
  const held=reads;mode='fail';release();await expect.poll(()=>reads).toBeGreaterThan(held);await expect(notice).toBeVisible();
  await page.screenshot({path:info.outputPath('home-resized-503-recovery.png')});mode='healthy';
  await expect(page.locator(`[data-home-section-root="my"] .mini-board-card-link-surface[data-game-id="${createdId}"]`)).toBeVisible({timeout:15000});await expect(notice).not.toBeVisible();expect(writes).toEqual([]);
 }finally{release();await page.unrouteAll({behavior:'wait'});}
});
