import {test as base,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {submitPlayableAction,createGameFromHome,openDirectGameLink,requestPlayerJoin,acceptPendingRequest,switchGamePanel,closeContextQuietly} from '../support/app.mjs';
import {waitForPlayableBoard} from '../../scripts/validation/browser-navigation.mjs';
import {undoWithHeldReceipt,readUndoGame} from '../support/direct-undo.mjs';
const test=base.extend({otherPlayer:async({browser,baseURL},use)=>{const context=await browser.newContext({baseURL,viewport:{width:390,height:844}});try{await use(await context.newPage());}finally{await closeContextQuietly(context);}}});
const terminal=JSON.parse(readFileSync(new URL('../../apps/web/scenarios/catalog.json',import.meta.url))).scenarios.find(item=>item.title==='Capture supply point to win by unsupplying the commander');
for(const completed of [false,true])test(`self-play Undo is direct while its receipt is pending (${completed?'completed':'live'})`,async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 const created=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/shell/games');
 await page.getByRole('button',{name:'Play both sides',exact:true}).click();const response=await created;expect(response.status()).toBe(200);const initial=(await response.json()).game;
 await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',initial.id);await waitForPlayableBoard(page);
 if(completed){
  const imported=await page.evaluate(async({scenario,id})=>{
   const response=await fetch('/api/shell/scenarios/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:2,identityId:localStorage.getItem('righelt.identity.id.v1'),targetGameId:id,scenario})});
   return {status:response.status,body:await response.json()};
  },{scenario:terminal,id:initial.id});
  expect(imported.status).toBe(200);await expect(page.getByTestId('game-result')).toBeVisible();await page.getByRole('button',{name:'Review game',exact:true}).click();
 }else {await submitPlayableAction(page,initial.legalActions.find(action=>action.from&&action.to));await expect.poll(async()=>(await readUndoGame(page,initial.id,true)).moves.filter(move=>!move.undone).length).toBe(1);}
 const before=await readUndoGame(page,initial.id,true),target=before.moves.find(move=>!move.undone);expect(target?.selectionSnapshot).toBeTruthy();
 const proof=await undoWithHeldReceipt(page,{gameId:initial.id,targetMove:target});
 expect(proof.game.board.state.outcome.status).toBe('ongoing');
 await page.screenshot({path:info.outputPath(`direct-undo-${completed?'completed':'live'}.png`)});
 await info.attach('direct-undo-command',{body:JSON.stringify({commandId:proof.command.clientCommandId,submissions:proof.sent.length,completed}),contentType:'application/json'});
});

test('another human still must approve Undo',async({page,otherPlayer,baseURL})=>{
 await page.setViewportSize({width:390,height:844});const {gameId,gameHash}=await createGameFromHome(page);
 await openDirectGameLink(otherPlayer,baseURL,gameHash);await requestPlayerJoin(otherPlayer);await acceptPendingRequest(page);
 const initial=await readUndoGame(page,gameId,true);await submitPlayableAction(page,initial.legalActions.find(action=>action.from&&action.to));await expect.poll(async()=>(await readUndoGame(page,gameId,true)).moves.filter(move=>!move.undone).length).toBe(1);
 const before=await readUndoGame(page,gameId,true),move=before.moves.find(item=>!item.undone);expect(move).toBeTruthy();
 await switchGamePanel(page,'history');const row=page.locator(`[data-testid="history-move-item"][data-move-id="${move.moveId}"]`);await row.locator('.history-item-info').click();await row.getByRole('button',{name:'Undo before this move',exact:true}).click();
 await expect(page.locator('[data-action="rescind-revert-request"]')).toBeVisible();await expect(otherPlayer.locator('[data-action="accept-revert-request"]')).toBeVisible();
 const waiting=await readUndoGame(page,gameId,true);expect(waiting.board.state).toEqual(before.board.state);expect(waiting.moves.filter(item=>!item.undone)).toHaveLength(1);expect(waiting.pendingRevertRequest.targetMoveId).toBe(move.moveId);
 await otherPlayer.locator('[data-action="accept-revert-request"]').click();await expect.poll(async()=>(await readUndoGame(page,gameId,true)).moves.filter(item=>!item.undone).length).toBe(0);
 await expect(page.locator('[data-action="rescind-revert-request"]')).toHaveCount(0);
});
