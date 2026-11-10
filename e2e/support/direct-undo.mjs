import {expect} from '@playwright/test';
import {switchGamePanel} from './app.mjs';
import {readProjectedGame} from './computer-projection.mjs';
export const readUndoGame=(page,id,guest)=>page.evaluate(readProjectedGame,{id,guest});
export async function selectRecordedUndoMove(row,move){
 if(await row.getAttribute('aria-current')!=='true')await row.locator(':scope > .history-move-hit').click();
 await expect(row).toHaveAttribute('aria-current','true');
 await expect(row).toHaveClass(/is-selected/);
 const page=row.page();
 const layout=await page.locator('#app').getAttribute('data-shell-layout-mode');
 expect(['narrow','wide']).toContain(layout);
 if(layout==='narrow')await expect(row.getByTestId('history-inline-preview')).toBeVisible();
 else{
  const moveNumber=(await row.getAttribute('aria-label'))?.match(/ · Move (\d+):/);
  expect(moveNumber).not.toBeNull();
  await expect(page.locator('.board-heading:not(.board-heading-sizing)')).toHaveText(`Board - Move ${moveNumber[1]}`);
  await expect(page.locator('#shell-game-alerts [data-alert-stack-card].is-active [data-board-context] .board-context-content')).toBeVisible();
  expect(move?.snapshot?.pieces?.length).toBeGreaterThan(0);
  await expect(row).toHaveAttribute('data-move-id',move.moveId);
  const board=page.getByTestId('game-board');await expect(board).toBeVisible();
  const expected=move.snapshot.pieces.map(piece=>({id:piece.id,...piece.position})).sort((a,b)=>a.id.localeCompare(b.id));
  await expect.poll(()=>board.locator('.piece-token[data-piece-id]:not(.move-ghost):not(.history-destruction-piece)').evaluateAll(tokens=>tokens.map(token=>({id:token.dataset.pieceId,row:Number(token.closest('.cell').dataset.row),col:Number(token.closest('.cell').dataset.col)})).sort((a,b)=>a.id.localeCompare(b.id)))).toEqual(expected);
 }
}
export const expectNoUndoApproval=async page=>{
 await expect(page.locator('[data-action="accept-revert-request"],[data-action="reject-revert-request"],[data-action="rescind-revert-request"]')).toHaveCount(0);
 await expect(page.getByText('Undo request accepted',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Waiting for undo approval',{exact:true})).toHaveCount(0);
};
export async function undoWithHeldReceipt(page,{gameId,targetMove,guest=true,beforeClick=async()=>{},afterClick=async()=>{}}){
 let release,command,receipt;const held=new Promise(resolve=>release=resolve),sent=[];
 const routeHandler=async route=>{
  const body=route.request().postDataJSON();
  if(body?.gameId===gameId&&body.payload?.operation==='revert-request'){
   sent.push(body);command??=body;await held;
  }
  await route.continue();
  if(body?.gameId===gameId&&body.payload?.operation==='revert-request'){
   const response=await route.request().response();
   expect(response?.status()).toBe(200);
   const result=await response.json();
   const accepted=result.commandOutcomes?.find(row=>row.clientCommandId===body.clientCommandId);
   expect(accepted).toMatchObject({gameId,identityId:body.identityId,clientCommandId:body.clientCommandId,fingerprint:body.fingerprint,outcome:'accepted'});
   expect(Number.isSafeInteger(accepted.eventSeq)&&accepted.eventSeq>0).toBe(true);
   receipt??=accepted;
  }
 };
 await page.context().route('**/shared',routeHandler);
 try{
  await switchGamePanel(page,'history');
  const row=page.locator(`[data-testid="history-move-item"][data-move-id="${targetMove.moveId}"]`);
  await selectRecordedUndoMove(row,targetMove);
  const undoButton=row.getByRole('button',{name:'Undo before this move',exact:true});
  await beforeClick(undoButton);await undoButton.click();
  await afterClick();await expect.poll(()=>Boolean(command)).toBe(true);
  await expectNoUndoApproval(page);
  release();
  await expect.poll(async()=>{
   const game=await readUndoGame(page,gameId,guest);
   return {active:game.moves.filter(move=>!move.undone).map(move=>move.moveId),state:game.board.state,pending:game.pendingRevertRequest};
  }).toEqual({active:[],state:targetMove.selectionSnapshot,pending:null});
  const game=await readUndoGame(page,gameId,guest);
  expect(game.notifications.filter(note=>note==='Undo applied')).toHaveLength(1);
  expect(game.notifications.some(note=>/accepted the undo request/i.test(note))).toBe(false);
  for(const body of sent)expect(body).toEqual(command);
  await expectNoUndoApproval(page);await switchGamePanel(page,'board');
  await expect.poll(()=>Boolean(receipt)).toBe(true);
  expect(game.lastRestoration?.undoEventSeq).toBe(receipt.eventSeq);
  return {command,sent,game,receipt};
 }finally{release();if(!page.isClosed())await page.context().unroute('**/shared',routeHandler);}
}
