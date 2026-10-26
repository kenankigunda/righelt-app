import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {isOperationRequest,operationValues} from '../../e2e/support/shared-request.mjs';
import {selectGamePanel} from './browser-navigation.mjs';
import {isSyncCommand,isCommandOutcome,isReconcileResponse,commandFingerprint} from '../../packages/shared-types/src/sync-protocol.ts';

export function humanMoveForUndo(initial,accepted,action){
 const existing=new Set(initial.moves.map(move=>move.moveId));
 const human=accepted.moves.filter(move=>!existing.has(move.moveId)&&!move.undone&&!move.computerProof);
 assert.equal(human.length,1,'Exactly one newly accepted human decision must precede the computer');
 assert.ok(human[0].moveId,'Human decision must have an immutable ID');
 assert.deepEqual(human[0].action,action);
 assert.deepEqual(human[0].selectionSnapshot,initial.board.state);
 return human[0];
}

export async function assertUndoReceipt(body,envelope,{gameId,moveId,identityId,initialState}){
 assert.ok(typeof identityId==='string'&&identityId.trim().length,'Expected human identity is required');
 assert.equal(envelope.identityId,identityId,'Undo must be submitted by the expected human');
 assert.equal(operationValues({postDataJSON:()=>envelope}).targetMoveId,moveId,'Undo must target the selected human decision');
 assert.equal(body.ok,true);
 if(envelope.kind==='shared'){
  assert.equal(isSyncCommand(envelope),true,'Captured undo must be a valid immutable command');
  assert.equal(envelope.gameId,gameId);assert.equal(envelope.payload.operation,'revert-request');
  assert.equal(envelope.fingerprint,await commandFingerprint(envelope),'Captured undo fingerprint must bind its exact intent');
  assert.equal(body.accepted,true);
  assert.equal(body.clientCommandId,envelope.clientCommandId);
  assert.equal(isReconcileResponse(body,gameId,[envelope]),true,'Undo acknowledgement must bind the captured command');
  const receipts=body.commandOutcomes.filter(outcome=>outcome.clientCommandId===envelope.clientCommandId);
  assert.equal(receipts.length,1,'The submitted undo command must have exactly one own receipt');
  const receipt=receipts[0];assert.equal(isCommandOutcome(receipt,envelope),true);
  assert.equal(receipt.gameId,gameId);assert.equal(receipt.identityId,identityId);
  assert.equal(receipt.fingerprint,envelope.fingerprint);assert.equal(receipt.outcome,'accepted');
 }else{assert.equal(envelope.kind,undefined);assert.equal(body.autoApproved,true);}
 assert.equal(body.game?.id,gameId);
 assert.equal(body.game.lastRestoration?.decisionId,moveId);
 assert.deepEqual(body.game.board.state,initialState);
 assert.equal(body.game.moves.filter(move=>!move.undone).length,0);
}

export async function undoBeforeHumanMove(page,{gameId,moveId,identityId,initialState}){
 assert.ok(typeof gameId==='string'&&gameId.trim().length,'Game ID is required before browser activity');
 assert.ok(typeof moveId==='string'&&moveId.length,'Human decision ID is required before browser activity');
 assert.ok(typeof identityId==='string'&&identityId.trim().length,'Human identity is required before browser activity');
 await selectGamePanel(page,'history');
 const row=page.locator(`[data-testid="history-move-item"][data-move-id=${JSON.stringify(moveId)}]`);
 await expect(row).toHaveCount(1);
 await row.locator('.history-item-info').click();
 const control=row.locator('[data-action="revert-to-move"]');
 await expect(control).toHaveCount(1);
 await expect(control).toHaveAttribute('data-game-id',gameId);
 await expect(control).toHaveAttribute('data-move-id',moveId);
 await expect(control).toHaveAccessibleName('Undo before this move');
 await expect(control).toBeVisible();await expect(control).toBeEnabled();
 const responses=[];
 const observe=response=>{
  const request=response.request(),route=new URL(request.url()).pathname;
  if((route===`/api/shell/games/${encodeURIComponent(gameId)}/shared`||route===`/api/shell/games/${encodeURIComponent(gameId)}/revert-request`)&&isOperationRequest(request,'revert-request'))responses.push(response);
 };
 page.on('response',observe);
 try{
  await control.click();
  await expect.poll(()=>responses.length,{message:'The selected row undo must receive one server acknowledgement'}).toBe(1);
  const response=responses[0];assert.equal(response.status(),200);
  const envelope=response.request().postDataJSON();
  if(new URL(response.url()).pathname.endsWith('/shared'))assert.equal(envelope.kind,'shared');
  await assertUndoReceipt(await response.json(),envelope,{gameId,moveId,identityId,initialState});
 }finally{page.off('response',observe);}
}
