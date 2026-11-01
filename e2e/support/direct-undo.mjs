import {expect} from '@playwright/test';
import {switchGamePanel} from './app.mjs';
import {readProjectedGame} from './computer-projection.mjs';
export const readUndoGame=(page,id,guest)=>page.evaluate(readProjectedGame,{id,guest});
export const expectNoUndoApproval=async page=>{
 await expect(page.locator('[data-action="accept-revert-request"],[data-action="reject-revert-request"],[data-action="rescind-revert-request"]')).toHaveCount(0);
 await expect(page.getByText('Undo request accepted',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Waiting for undo approval',{exact:true})).toHaveCount(0);
};
export async function undoWithHeldReceipt(page,{gameId,targetMove,guest=true,beforeClick=async()=>{},afterClick=async()=>{}}){
 let release,command;const held=new Promise(resolve=>release=resolve),sent=[];
 const routeHandler=async route=>{
  const body=route.request().postDataJSON();
  if(body?.gameId===gameId&&body.payload?.operation==='revert-request'){
   sent.push(body);command??=body;await held;
  }
  await route.continue();
 };
 await page.context().route('**/shared',routeHandler);
 try{
  await switchGamePanel(page,'history');
  const row=page.locator(`[data-testid="history-move-item"][data-move-id="${targetMove.moveId}"]`);
  await row.locator('.history-item-info').click();
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
  return {command,sent,game};
 }finally{release();if(!page.isClosed())await page.context().unroute('**/shared',routeHandler);}
}
