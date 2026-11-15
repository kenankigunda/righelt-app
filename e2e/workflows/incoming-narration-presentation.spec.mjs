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

  await expect(focusOwner).toBeFocused();
  const incoming=opponent.locator('[data-incoming-context]');

  if(width===1440){
   await expect(incoming).toHaveCount(1);await expect(incoming).toBeVisible();
   await expect(incoming).toHaveAttribute('aria-live','off');await expect(incoming).toContainText('Guest 1 moved');
   await expect(incoming.locator('.board-preview-coordinate-chip')).toHaveCount(2);
   const announcement=opponent.locator('body > .sr-only[role="status"][aria-live="polite"][aria-atomic="true"]').filter({hasText:'Guest 1 moved'});await expect(announcement).toHaveCount(1);
   const replay=incoming.getByRole('button',{name:'Show me again',exact:true});await expect(replay).toBeEnabled();
   await expect(incoming).toHaveClass(/history-incoming/);await expect(incoming.locator('xpath=ancestor::li[contains(@class,"history-incoming-container")]')).toHaveCount(1);
   await expect(incoming.locator('xpath=ancestor::*[@data-game-panel="history"]')).toHaveCount(1);
   await expect(opponent.locator('.incoming-move-flyout')).toHaveCount(0);
   await test.step('replay returns to Board without mutating authority',async()=>{
    const beforeReplay=await projected(opponent,gameId);await opponent.emulateMedia({reducedMotion:'reduce'});await replay.click();
    await expect(opponent.locator('.computer-replay')).toBeVisible();
    const next=opponent.getByRole('button',{name:'Next',exact:true});await expect(next).toBeVisible();await next.click();await expect(opponent.locator('.computer-replay')).toHaveCount(0);
    assertUnchanged(beforeReplay,await projected(opponent,gameId));
   },{timeout:15000});
  }else{
   for(const panel of ['board','history','players']){
    await switchGamePanel(opponent,panel);
    await expect(opponent.locator('[data-incoming-context],.incoming-move-flyout,.history-incoming,[data-action="toggle-incoming-narration"]')).toHaveCount(0);
   }
   await switchGamePanel(opponent,'board');
   await expect(opponent.locator('.shell-mobile-tabbar')).toHaveAttribute('data-visible','true');
   await expect(opponent.locator('.previous-turn-source,.previous-turn-target,.previous-turn-deletion').first()).toBeVisible();
   await expect(opponent.locator('[data-legend-entry="previousTurn"]')).toBeVisible();
  }
});
