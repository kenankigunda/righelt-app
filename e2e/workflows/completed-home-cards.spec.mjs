import {test as base,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {importScenarioGame,switchGamePanel} from '../support/app.mjs';
import {CURRENT_COMPUTER_MODEL} from '../../packages/shared-types/src/computer-play.ts';
const catalog=JSON.parse(readFileSync(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
const terminal=catalog.scenarios.find(row=>row.title==='Capture supply point to win by unsupplying the commander');
const request=(page,path,body)=>page.evaluate(async({path,body})=>{
 const identityId=localStorage.getItem('righelt.identity.id.v1');
 const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identityId,protocolVersion:2,...body})});
 const value=await response.json();if(!response.ok)throw Error(`${path}: ${response.status}`);return value;
},{path,body});
const test=base.extend({homeGames:[async({page,baseURL},use)=>{
 const {gameId:sourceId}=await importScenarioGame(page,terminal,baseURL,{open:false});
 const source=await page.evaluate(async id=>{
  const identityId=localStorage.getItem('righelt.identity.id.v1');
  const response=await fetch(`/api/shell/games/${id}?identityId=${encodeURIComponent(identityId)}`);
  if(!response.ok)throw Error('Expected confirmed terminal source');return(await response.json()).game;
 },sourceId);
 expect(source.board.state.outcome.status).toBe('p1_win');
 const {game:win}=await request(page,'/api/shell/history/branch',{sourceGameId:sourceId,sourceGameplayRevision:source.gameplayRevision,creatorSide:'p1',computer:{p1:null,p2:'tau'},computerModelId:CURRENT_COMPUTER_MODEL.id});
 const {game:loss}=await request(page,'/api/shell/history/branch',{sourceGameId:sourceId,sourceGameplayRevision:source.gameplayRevision,creatorSide:'p2',computer:{p1:'tau',p2:null},computerModelId:CURRENT_COMPUTER_MODEL.id});
 const {game:ongoing}=await request(page,'/api/shell/games',{selfPlayMode:true});
 // Seed through real APIs, then make the next native entry a fresh document.
 // Same-hash navigation would retain Home's pre-seed, already-hydrated list.
 await page.goto('about:blank');
 await use({source,win,loss,ongoing});
},{timeout:60000}]});
for(const width of [390,1440])test(`Home separates completed games and names confirmed winners at ${width}px`,async({page,homeGames},info)=>{
 await page.setViewportSize({width,height:1100});await page.goto('/#/');
 const completed=page.locator('[data-home-section-root="completed"]');
 const active=page.locator('[data-home-section-root="my"]');
 await expect(completed.getByRole('heading',{name:'Your completed games',exact:true})).toBeVisible();
 await expect(completed.getByText('3 games',{exact:true})).toBeVisible();
 const card=id=>completed.locator(`a[data-game-id="${id}"]`);
 await expect(card(homeGames.win.id)).toContainText('You won');
 await expect(card(homeGames.loss.id)).toContainText('Tau won');await expect(card(homeGames.loss.id)).toContainText('You lost');
 const lossLines=await card(homeGames.loss.id).locator('.home-card-result').evaluate(node=>({headlineBottom:node.querySelector('strong').getBoundingClientRect().bottom,detailTop:node.querySelector('.small').getBoundingClientRect().top}));
 expect(lossLines.detailTop).toBeGreaterThanOrEqual(lossLines.headlineBottom-1);
 await expect(card(homeGames.source.id)).toContainText('Red won');
 for(const game of [homeGames.source,homeGames.win,homeGames.loss]){
  await expect(card(game.id)).toContainText('Review game');
  await expect(card(game.id).locator('.connection-status-icon')).toHaveCount(0);
  await expect(card(game.id).locator('button,a,[tabindex]')).toHaveCount(0);
  const square=await card(game.id).locator('.mini-board-preview-board .cell').first().boundingBox();
  expect(Math.abs(square.width-square.height)).toBeLessThanOrEqual(1);
  await expect(active.locator(`a[data-game-id="${game.id}"]`)).toHaveCount(0);
 }
 await expect(active.locator(`a[data-game-id="${homeGames.ongoing.id}"]`)).toBeVisible();
 await expect(card(homeGames.loss.id).locator('..')).toHaveAttribute('data-winner-side','p1');
 const sectionOrder=await page.locator('.home-refresh > section').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-home-section-root')??(node.classList.contains('home-start')?'start':'other')));
 expect(sectionOrder.indexOf('completed')).toBeGreaterThan(sectionOrder.indexOf('start'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('home-completed-winner-lines.png'),fullPage:true});
 await card(homeGames.loss.id).focus();await page.keyboard.press('Enter');
 await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',homeGames.loss.id);
 await expect(page.locator('#shell-board-turn-indicator')).toHaveText('Game complete');
 await expect(page.locator('#shell-board-preview-label [data-board-message-action="pass"]')).toHaveCount(0);
});


test('an acknowledged Undo moves its Home card and counts without stealing focus or scrolling',async({page,context,homeGames},info)=>{
 const homeDiagnostics=[];
 page.on('console',message=>{try{const value=JSON.parse(message.text());if(value.event?.startsWith('home_'))homeDiagnostics.push(value);}catch{}});
 await page.addInitScript(()=>{window.__RIGHELT_VERBOSE_CLIENT_LOGS=true;});
 await page.setViewportSize({width:1440,height:1100});
 await page.goto(`/#/game/${homeGames.source.id}`);await switchGamePanel(page,'history');
 const move=page.getByTestId('history-move-item').last();await move.locator('.history-item-info').click();
 const undo=move.locator('[data-action="revert-to-move"]');await expect(undo).toBeEnabled();
 let release,heldCommand;
 const hold=new Promise(resolve=>release=resolve);
 await context.route('**/shared',async route=>{
  const body=route.request().postDataJSON();
  if(body?.gameId===homeGames.source.id&&body.payload?.operation==='revert-request'){heldCommand=body;await hold;}
  await route.continue();
 });
 try{
  await undo.click();await expect.poll(()=>Boolean(heldCommand)).toBe(true);
  await page.locator('.shell-header-title-link').click();
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  const completed=page.locator('[data-home-section-root="completed"]');
  const card=completed.locator(`a[data-game-id="${homeGames.source.id}"]`);
  await expect(completed.getByText('3 games',{exact:true})).toBeVisible();
  await expect(card).toContainText('Red won');
  await card.focus();const before=await card.evaluate(node=>({scrollY,cardTop:node.getBoundingClientRect().top,sectionTop:node.closest('[data-home-section-root]').getBoundingClientRect().top}));
  release();
  await expect(completed.getByText('2 games',{exact:true})).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.locator(`[data-home-section-root="my"] a[data-game-id="${homeGames.source.id}"]`)).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.activeElement.closest('[data-home-section-root]')?.getAttribute('data-home-section-root'))).toBe('completed');
  await expect(page.locator('#shell-sync-announcement')).toHaveText('Your game lists were updated.');
  const after=await page.evaluate(()=>({scrollY,cardTop:document.activeElement.getBoundingClientRect().top,sectionTop:document.activeElement.closest('[data-home-section-root]').getBoundingClientRect().top}));
  writeFileSync(info.outputPath('home-reading-position.json'),JSON.stringify({before,after},null,2));
  await info.attach('home-reading-position',{contentType:'application/json',path:info.outputPath('home-reading-position.json')});
  expect(Math.abs(after.sectionTop-before.sectionTop)).toBeLessThanOrEqual(1);
  const identityId=await page.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));
  const result=await page.request.get(`/api/shell/games/${homeGames.source.id}?identityId=${encodeURIComponent(identityId)}`);
  expect(result.ok()).toBe(true);const game=(await result.json()).game;
  expect(game.board.state.outcome.status).toBe('ongoing');expect(game.lastRestoration).toBeTruthy();
  await page.screenshot({path:info.outputPath('home-undo-reopens-with-stable-focus.png'),fullPage:true});
 }finally{release();writeFileSync(info.outputPath('home-cache-diagnostics.json'),JSON.stringify(homeDiagnostics,null,2));await info.attach('home-cache-diagnostics',{contentType:'application/json',path:info.outputPath('home-cache-diagnostics.json')});await context.unrouteAll({behavior:'wait'});}
});


test('completed list failures have independent recovery while ongoing cards remain available',async({page,context,homeGames})=>{
 let failed=true;
 await context.route('**/api/shell/games?**',async route=>{
  if(new URL(route.request().url()).searchParams.get('section')==='completed'&&failed)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'temporary_unavailable'})});
  else await route.continue();
 });
 try{
  await page.goto('/#/');
  const completed=page.locator('[data-home-section-root="completed"]');
  await expect(completed.getByText("We couldn't load these games.",{exact:true})).toBeVisible();
  await expect(page.locator(`[data-home-section-root="my"] a[data-game-id="${homeGames.ongoing.id}"]`)).toBeVisible();
  failed=false;
  const retry=completed.getByRole('button',{name:'Try again',exact:true});await retry.focus();await page.keyboard.press('Enter');
  await expect(completed.getByText('3 games',{exact:true})).toBeVisible();
  await expect(completed.locator('a[data-game-id]')).toHaveCount(3);
  await expect.poll(()=>page.evaluate(()=>document.activeElement.closest('[data-home-section-root]')?.getAttribute('data-home-section-root'))).toBe('completed');
 }finally{await context.unrouteAll({behavior:'wait'});}
});

test('a completed section stays in its loading state until a known zero result',async({page,context})=>{
 let release;
 const hold=new Promise(resolve=>release=resolve);
 await context.route('**/api/shell/games?**',async route=>{
  if(new URL(route.request().url()).searchParams.get('section')==='completed')await hold;
  await route.continue();
 });
 try{
  await page.goto('/#/');
  const completed=page.locator('[data-home-section-root="completed"]');
  await expect(completed).toBeVisible();
  await expect(completed.getByRole('heading',{name:'Your completed games',exact:true})).toBeVisible();
  const response=page.waitForResponse(value=>new URL(value.url()).pathname==='/api/shell/games'&&new URL(value.url()).searchParams.get('section')==='completed');
  release();expect((await(await response).json()).totalGames).toBe(0);
  await expect(completed).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Start something new',exact:true})).toBeVisible();
 }finally{release();await context.unrouteAll({behavior:'wait'});}
});
