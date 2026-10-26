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

async function assertUndoIntent(envelope,{gameId,moveId,identityId,beforeState,beforeRevision,actionContractVersion}){
 assert.ok(typeof identityId==='string'&&identityId.trim().length,'Expected human identity is required');
 assert.equal(envelope.identityId,identityId,'Undo must be submitted by the expected human');
 assert.equal(operationValues({postDataJSON:()=>envelope}).targetMoveId,moveId,'Undo must target the selected human decision');
 if(envelope.kind==='shared'){
  assert.equal(isSyncCommand(envelope),true,'Captured undo must be a valid immutable command');
  assert.equal(envelope.gameId,gameId);assert.equal(envelope.payload.operation,'revert-request');
  assert.ok(actionContractVersion===null||[2,3].includes(actionContractVersion),'An explicit supported source-selected action version is required');
  assert.equal(envelope.actionContractVersion,actionContractVersion===null?undefined:actionContractVersion,'Undo action contract must match the candidate source');
  assert.equal(envelope.predecessor,undefined,'Current UI shared commands must not introduce an unverified dependency');
  assert.equal(envelope.payload.action,undefined,'Shared undo must not carry a gameplay action');
  assert.ok(Number.isSafeInteger(beforeRevision)&&beforeRevision>=0,'Pre-undo authoritative revision is required');
  assert.equal(envelope.expectedGameplayRevision,beforeRevision,'Undo must bind the observed authoritative revision');
  assert.deepEqual(envelope.expectedState,beforeState);
  assert.equal(envelope.fingerprint,await commandFingerprint(envelope),'Captured undo fingerprint must bind its exact intent');
 }else assert.equal(envelope.kind,undefined);
}

export async function assertUndoReceipt(body,envelope,{gameId,moveId,identityId,initialState,beforeState,beforeRevision,actionContractVersion}){
 await assertUndoIntent(envelope,{gameId,moveId,identityId,beforeState,beforeRevision,actionContractVersion});
 assert.equal(body.ok,true);
 if(envelope.kind==='shared'){
  assert.equal(isReconcileResponse(body,gameId,[envelope]),true,'Undo acknowledgement must bind the captured command');
  const receipts=body.commandOutcomes.filter(outcome=>outcome.clientCommandId===envelope.clientCommandId);
  assert.equal(receipts.length,1,'The submitted undo command must have exactly one own receipt');
  const receipt=receipts[0];assert.equal(isCommandOutcome(receipt,envelope),true);
  assert.equal(receipt.gameId,gameId);assert.equal(receipt.identityId,identityId);
  assert.equal(receipt.fingerprint,envelope.fingerprint);assert.equal(receipt.outcome,'accepted');
 }else assert.equal(body.autoApproved,true);
 assert.equal(body.game?.id,gameId);
 assert.equal(body.game.lastRestoration?.decisionId,moveId);
 assert.deepEqual(body.game.board.state,initialState);
 assert.equal(body.game.moves.filter(move=>!move.undone).length,0);
}

export async function undoBeforeHumanMove(page,{gameId,moveId,identityId,initialState,beforeState,beforeRevision,undoLabel,actionContractVersion}){
 assert.ok(actionContractVersion===null||[2,3].includes(actionContractVersion),'An explicit supported source-selected action version is required');
 assert.ok(['Undo back to this move','Undo before this move'].includes(undoLabel),'An explicit supported source-selected undo label is required');
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
 await expect(control).toHaveAccessibleName(undoLabel);
 await expect(control).toBeVisible();await expect(control).toBeEnabled();
 const requests=[],responses=[];
 const isUndoRequest=request=>{
  const route=new URL(request.url()).pathname;
  return (route===`/api/shell/games/${encodeURIComponent(gameId)}/shared`||route===`/api/shell/games/${encodeURIComponent(gameId)}/revert-request`)&&isOperationRequest(request,'revert-request');
 };
 const observeRequest=request=>{if(isUndoRequest(request))requests.push(request);};
 const observe=response=>{
  if(isUndoRequest(response.request()))responses.push(response);
 };
 page.on('request',observeRequest);page.on('response',observe);
 try{
  await control.click();
  await expect.poll(()=>requests.length,{message:'The selected row must submit its own undo command'}).toBe(1);
  const submitted=requests[0],envelope=submitted.postDataJSON();
  if(new URL(submitted.url()).pathname.endsWith('/shared'))assert.equal(envelope.kind,'shared');
  await assertUndoIntent(envelope,{gameId,moveId,identityId,beforeState,beforeRevision,actionContractVersion});
  let body;
  if(envelope.kind==='shared'){
   // Live receipts legitimately cancel the original HTTP response. Always use
   // durable reconciliation for this already validated current-UI command,
   // rather than retrying the write. Reconcile can persist rejections for bad
   // contracts, dependencies or future revisions: those must fail above first.
   const headers=Object.fromEntries(Object.entries(submitted.headers()).filter(([name])=>name.startsWith('x-righelt-')));
   await expect.poll(async()=>{
    const reply=await page.evaluate(async({gameId,envelope,headers})=>{
     const response=await fetch(`/api/shell/games/${encodeURIComponent(gameId)}/reconcile`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({protocolVersion:2,identityId:envelope.identityId,knownSnapshotEventSeq:0,commands:[envelope]})});
     return {status:response.status,body:await response.json()};
    },{gameId,envelope,headers});
    assert.equal(reply.status,200);body=reply.body;
    assert.equal(isReconcileResponse(body,gameId,[envelope]),true,'Every receipt observation must validate its exact command before interpreting outcomes');
    return body.commandOutcomes?.some(outcome=>outcome.clientCommandId===envelope.clientCommandId&&outcome.outcome!=='unknown')??false;
   },{message:'The exact submitted undo command must have a durable terminal receipt'}).toBe(true);
  }else{
   await expect.poll(()=>responses.length,{message:'Legacy undo must receive its explicit server approval'}).toBe(1);
   assert.equal(responses[0].status(),200);body=await responses[0].json();
  }
  await assertUndoReceipt(body,envelope,{gameId,moveId,identityId,initialState,beforeState,beforeRevision,actionContractVersion});
 }finally{page.off('request',observeRequest);page.off('response',observe);}
}
