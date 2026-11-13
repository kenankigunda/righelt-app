import {test,expect} from '@playwright/test';
import {openDirectGameLink,requestPlayerJoin,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
import {ACTION_CONTRACT_HEADER,ACTION_CONTRACT_VERSION,LIVE_HISTORY,commandFingerprint} from '../../apps/web/generated/packages/shared-types/src/sync-protocol.js';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';

const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const assertUnchanged=(before,after)=>{
 expect(after.gameplayRevision).toBe(before.gameplayRevision);
 expect(after.board.state).toEqual(before.board.state);
 expect(after.moves.map(move=>({id:move.moveId,undone:move.undone}))).toEqual(before.moves.map(move=>({id:move.moveId,undone:move.undone})));
};

for(const width of [390,1440])test(`arriving opponent turn uses the responsive incoming host at ${width}px`,async({page:opponent,request,baseURL},info)=>{
  await opponent.setViewportSize({width,height:900});
  const ownerId='id-incomingowner',bootstrap=await request.get('/api/shell/bootstrap'),storageGeneration=bootstrap.headers()[STORAGE_GENERATION_HEADER.toLowerCase()];
  expect(bootstrap.ok()).toBe(true);
  const headers={[ACTION_CONTRACT_HEADER]:String(ACTION_CONTRACT_VERSION),[LIVE_HISTORY.requestHeader]:LIVE_HISTORY.requestValue,...(storageGeneration?{[STORAGE_GENERATION_HEADER]:storageGeneration}:{})};
  const created=await request.post('/api/shell/games',{headers,data:{identityId:ownerId,selfPlayMode:false}});expect(created.ok()).toBe(true);
  const gameId=(await created.json()).game.id,gameHash=`#/game/${encodeURIComponent(gameId)}`;
  await openDirectGameLink(opponent,baseURL,gameHash);await requestPlayerJoin(opponent);
  const requesterIdentityId=await opponent.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));expect(requesterIdentityId).toBeTruthy();
  const approved=await request.post(`/api/shell/games/${gameId}/approve`,{headers,data:{protocolVersion:2,identityId:ownerId,requesterIdentityId}});expect(approved.ok()).toBe(true);
  await expect(opponent.getByTestId('game-role')).toContainText('Guest 2');
  await switchGamePanel(opponent,'board');

  const focusOwner=opponent.getByTestId('game-board');await focusOwner.focus();await expect(focusOwner).toBeFocused();
  const projection=await request.get(`/api/shell/games/${gameId}?identityId=${ownerId}`,{headers});expect(projection.ok()).toBe(true);
  const initial=(await projection.json()).game,action=initial.legalActions.find(candidate=>candidate.type==='move'&&candidate.from&&candidate.to);expect(action).toBeTruthy();
  const command={protocolVersion:2,actionContractVersion:ACTION_CONTRACT_VERSION,gameId,identityId:ownerId,clientCommandId:`v2:${crypto.randomUUID()}`,submittedAt:Date.now(),kind:'action',payload:{action,notation:'MOVE'},expectedState:initial.board.state,expectedGameplayRevision:initial.gameplayRevision};
  command.fingerprint=await commandFingerprint(command);
  const applied=await request.post(`/api/shell/games/${gameId}/apply`,{headers,data:command});expect(applied.ok()).toBe(true);
  expect((await applied.json()).commandOutcomes).toContainEqual(expect.objectContaining({clientCommandId:command.clientCommandId,outcome:'accepted'}));

  const incoming=opponent.locator('[data-incoming-context]');await expect(incoming).toHaveCount(1);await expect(incoming).toBeVisible();
  await expect(incoming).toHaveAttribute('aria-live','off');await expect(incoming).toContainText('Guest 1 moved');
  await expect(incoming.locator('.board-preview-coordinate-chip')).toHaveCount(2);
  await expect(focusOwner).toBeFocused();
  const announcement=opponent.locator('body > .sr-only[role="status"][aria-live="polite"][aria-atomic="true"]').filter({hasText:'Guest 1 moved'});await expect(announcement).toHaveCount(1);
  const replay=incoming.getByRole('button',{name:'Show me again',exact:true});await expect(replay).toBeEnabled();

  if(width===1440){
   await expect(incoming).toHaveClass(/history-incoming/);await expect(incoming.locator('xpath=ancestor::li[contains(@class,"history-incoming-container")]')).toHaveCount(1);
   await expect(incoming.locator('xpath=ancestor::*[@data-game-panel="history"]')).toHaveCount(1);
   await expect(opponent.locator('.incoming-move-flyout')).toHaveCount(0);
  }else{
   const flyout=opponent.getByRole('complementary',{name:'Previous turn',exact:true});await expect(flyout).toHaveAttribute('data-expanded','true');
   await expect(opponent.locator('.history-incoming')).toHaveCount(0);
   const nav=opponent.locator('.shell-mobile-tabbar');await expect(nav).toHaveAttribute('data-visible','false');
   await test.step('mobile flyout collapse preserves focus ownership',async()=>{
    const collapse=flyout.getByRole('button',{name:'Hide previous turn',exact:true});await collapse.focus();await expect(collapse).toBeFocused();await collapse.dispatchEvent('click');
    const expand=flyout.getByRole('button',{name:'Show previous turn',exact:true});await expect(expand).toBeFocused();await expect(flyout).toHaveAttribute('data-expanded','false');
    await expand.press('Enter');await expect(collapse).toBeFocused();await expect(flyout).toHaveAttribute('data-expanded','true');
    await collapse.press('Enter');await expect(expand).toBeFocused();await expect(flyout).toHaveAttribute('data-expanded','false');
    await expand.press('Enter');await expect(collapse).toBeFocused();await expect(flyout).toHaveAttribute('data-expanded','true');
   },{timeout:15000});
   await test.step('mobile History activation retains the flyout',async()=>{
    const reveal=opponent.getByRole('button',{name:'Show game navigation',exact:true}),historyTab=nav.locator('[data-action="switch-game-panel"][data-panel="history"]');
    const geometry=()=>opponent.evaluate(()=>{
     const rect=node=>node?.getBoundingClientRect().toJSON()??null,nav=document.querySelector('.shell-mobile-tabbar'),flyout=document.querySelector('.incoming-move-flyout');
     const tabs=[...document.querySelectorAll('[data-action="switch-game-panel"][data-panel="history"]')].map(node=>{const bounds=node.getBoundingClientRect(),style=getComputedStyle(node);return {rect:bounds.toJSON(),display:style.display,visibility:style.visibility,opacity:style.opacity,inViewport:bounds.right>0&&bounds.bottom>0&&bounds.left<innerWidth&&bounds.top<innerHeight,navVisible:node.closest('.shell-mobile-tabbar')?.dataset.visible??null};});
     return {viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY},nav:rect(nav),flyout:rect(flyout),tabs};
    });
    const expandedHit=await flyout.evaluate(node=>{const nav=document.querySelector('.shell-mobile-tabbar'),toggle=node.querySelector('[data-action="toggle-incoming-narration"]'),r=toggle.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {flyoutZ:Number(getComputedStyle(node).zIndex),navZ:Number(getComputedStyle(nav).zIndex),owned:hit===toggle||toggle.contains(hit)};});
    expect(expandedHit.owned).toBe(true);expect(expandedHit.flyoutZ).toBeGreaterThan(expandedHit.navZ);
    await flyout.getByRole('button',{name:'Hide previous turn',exact:true}).click();await expect(flyout).toHaveAttribute('data-expanded','false');
    const collapsedHit=await reveal.evaluate(button=>{const flyout=document.querySelector('.incoming-move-flyout'),r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {flyoutZ:Number(getComputedStyle(flyout).zIndex),navZ:Number(getComputedStyle(button.closest('.shell-mobile-tabbar')).zIndex),owned:hit===button||button.contains(hit)};});
    expect(collapsedHit.owned).toBe(true);expect(collapsedHit.navZ).toBeGreaterThan(collapsedHit.flyoutZ);
    await reveal.click();await expect(nav).toHaveAttribute('data-visible','true');
    const immediate=await geometry();await info.attach('mobile navigation geometry after reveal',{body:JSON.stringify(immediate),contentType:'application/json'});expect(immediate.tabs).toHaveLength(1);
    await expect.poll(async()=> (await geometry()).tabs.filter(tab=>tab.display!=='none'&&tab.visibility==='visible'&&Number(tab.opacity)>0&&tab.inViewport).length,{message:'Expected the sole History tab to finish entering the viewport'}).toBe(1);
    await info.attach('mobile navigation geometry settled',{body:JSON.stringify(await geometry()),contentType:'application/json'});
    await historyTab.click({noWaitAfter:true});await expect(historyTab).toHaveAttribute('aria-pressed','true');await expect(opponent.locator('[data-mobile-panel="history"]')).toHaveAttribute('data-active','true');await expect(flyout).toBeVisible();
   },{timeout:15000});
   await test.step('collapsed mobile flyout stays viewport-fixed below navigation',async()=>{
    const geometry=await flyout.evaluate(node=>{
     const rect=node.getBoundingClientRect(),nav=document.querySelector('.shell-mobile-tabbar'),navRect=nav.getBoundingClientRect();
     return {position:getComputedStyle(node).position,left:rect.left,right:rect.right,bottom:rect.bottom,viewport:{width:innerWidth,height:innerHeight},navVisible:nav.dataset.visible,overlap:navRect.bottom>rect.top&&navRect.top<rect.bottom,z:{flyout:Number(getComputedStyle(node).zIndex),nav:Number(getComputedStyle(nav).zIndex)}};
    });
    expect(geometry).toMatchObject({position:'fixed',navVisible:'true',overlap:true});
    expect(geometry.left).toBeCloseTo(0,3);expect(geometry.right).toBeCloseTo(geometry.viewport.width,3);expect(geometry.bottom).toBeCloseTo(geometry.viewport.height,3);
    expect(geometry.z.nav).toBeGreaterThan(geometry.z.flyout);
   },{timeout:15000});
  }

  await test.step('replay returns to Board without mutating authority',async()=>{
   const beforeReplay=await projected(opponent,gameId);await opponent.emulateMedia({reducedMotion:'reduce'});
   if(width===390){const mobileFlyout=opponent.getByRole('complementary',{name:'Previous turn',exact:true});await switchGamePanel(opponent,'board');const expand=mobileFlyout.getByRole('button',{name:'Show previous turn',exact:true});await expand.focus();await expand.press('Enter');await expect(mobileFlyout).toHaveAttribute('data-expanded','true');await replay.click();}else await replay.click();
   await expect(opponent.locator('.computer-replay')).toBeVisible();
   if(width===390)await switchGamePanel(opponent,'board');
   const next=opponent.getByRole('button',{name:'Next',exact:true});await expect(next).toBeVisible();await next.click();await expect(opponent.locator('.computer-replay')).toHaveCount(0);
   assertUnchanged(beforeReplay,await projected(opponent,gameId));
  },{timeout:15000});
});
