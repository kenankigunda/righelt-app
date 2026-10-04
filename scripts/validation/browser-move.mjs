import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {makeAnyLegalMove,getHistoryMoveCount} from '../../e2e/support/app.mjs';

// Kept separate so contract failures can be injected without running a stack.
export async function provePreviewConfirmation(driver){
 const before=await driver.history();
 await driver.source();
 await driver.destination();
 await driver.preview();
 assert.equal(driver.writes(),0,'Preview must not submit an action');
 assert.equal(await driver.history(),before,'Preview must not change history');
 await driver.destination();
 await driver.committed(before+1);
 assert.equal(driver.writes(),1,'Confirmation must submit exactly one action');
 assert.equal(await driver.history(),before+1,'Confirmation must add exactly one move');
}

export async function observeGameApplies(page,gameId,run){
 let writes=0;
 const pathname=`/api/shell/games/${encodeURIComponent(gameId)}/apply`;
 const observe=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===pathname)writes++;};
 page.on('request',observe);
 try{return await run(()=>writes);}finally{page.off('request',observe);}
}

export async function makeValidationMove(page,{movePreview},ownerClass='p1'){
 assert.equal(typeof movePreview,'boolean','Candidate movePreview capability must be explicit');
 if(!movePreview)return makeAnyLegalMove(page,ownerClass);
 const {gameId,action}=await page.evaluate(async()=>{
  const identity=localStorage.getItem('righelt.identity.id.v1');
  const match=location.hash.match(/^#\/game\/([^?]+)/);
  if(!identity||!match)throw Error('Browser move requires the guest identity and game route');
  const gameId=decodeURIComponent(match[1]);
  const response=await fetch(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identity)}`,{cache:'no-store'});
  if(!response.ok)throw Error(`Authoritative legal action: ${response.status}`);
  const game=(await response.json()).game;
  const action=game?.legalActions?.find(action=>action.type==='move'&&action.from&&action.to);
  if(game?.id!==gameId||!action)throw Error('Authoritative game has no legal browser move');
  return {gameId,action};
 });
 const touch=await page.evaluate(()=>navigator.maxTouchPoints>0);
 const activate=locator=>touch?locator.tap():locator.click();
 const boardTab=page.locator('[data-action="switch-game-panel"][data-panel="board"]');
 if(await boardTab.isVisible())await activate(boardTab);
 const cell=position=>page.locator(`[data-testid="game-board"] .cell[data-row="${position.row}"][data-col="${position.col}"]`);
 await observeGameApplies(page,gameId,writes=>provePreviewConfirmation({
  history:()=>getHistoryMoveCount(page),writes,
  source:()=>activate(cell(action.from)),destination:()=>activate(cell(action.to)),
  preview:async()=>{
   await expect(page.locator('#shell-board-preview-label')).toBeVisible();
   await expect(page.locator('#shell-board-preview-label')).toContainText('Preview. Activate this destination again to play.');
  },
  committed:expected=>expect.poll(()=>getHistoryMoveCount(page)).toBe(expected),
 }));
}
