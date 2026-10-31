import {test as base,expect} from '@playwright/test';
import {AUTH_CONTROL_ORIGIN} from './fixture.mjs';
import {waitForOpponentReady} from '../support/computer-projection.mjs';
import {submitPlayableAction} from '../support/app.mjs';
import {isOperationRequest,operationValues} from '../support/shared-request.mjs';
import {undoWithHeldReceipt,readUndoGame,expectNoUndoApproval} from '../support/direct-undo.mjs';
const test=base.extend({registeredPage:[async({page},use)=>{
 expect((await fetch(`${AUTH_CONTROL_ORIGIN}/reset-limits`,{method:'POST'})).ok).toBe(true);
 await page.goto('/');await page.getByRole('button',{name:'Play both sides',exact:true}).click();
 const account=page.getByTestId('account-dialog');await account.getByRole('button',{name:'Create account',exact:true}).click();
 await account.getByLabel('Username',{exact:true}).fill(`Undo_${Date.now().toString(36)}`);await account.getByLabel('Password',{exact:true}).fill('A direct Undo password 482');
 await account.getByRole('button',{name:'Create account & continue',exact:true}).click();await expect(page.getByTestId('game-shell')).toBeVisible();await page.goto('/#/');await use(page);
 },{timeout:60000}]});

test('computer Undo waits for an admitted move and never asks its human owner for approval',async({registeredPage:page,context},info)=>{
 await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const created=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/shell/games');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const response=await created;expect(response.status()).toBe(200);const initial=(await response.json()).game;
 await expect(page.locator('[data-computer-activity="here"]')).toHaveText('Active here');
 let releaseComputer;const held=new Promise(resolve=>releaseComputer=resolve),computerCommands=[],resumes=[];
 const computerRoute=async route=>{const body=route.request().postDataJSON();if(body?.gameId===initial.id&&body.payload?.computer){computerCommands.push(body);await held;}await route.continue();};
 await context.route('**/apply',computerRoute);
 page.on('request',request=>{if(isOperationRequest(request,'computer-control')&&operationValues(request).action==='resume')resumes.push(request.postDataJSON());});
 try{
  await submitPlayableAction(page,initial.legalActions.find(action=>action.from&&action.to));await expect.poll(async()=>(await readUndoGame(page,initial.id,false)).moves.filter(move=>!move.undone&&!move.computerProof).length).toBe(1);const afterHuman=await readUndoGame(page,initial.id,false);
  if(afterHuman.canEndTurn)await page.locator('[data-board-preview-action="end-turn"]').click();
  await expect.poll(()=>computerCommands.length,{timeout:30000}).toBeGreaterThan(0);
  const human=(await readUndoGame(page,initial.id,false)).moves.find(move=>!move.undone&&!move.computerProof);expect(human?.selectionSnapshot).toBeTruthy();
  const proof=await undoWithHeldReceipt(page,{gameId:initial.id,targetMove:human,guest:false,beforeClick:async undoButton=>{
   // Unresolved admitted gameplay disables Undo; never force or queue its click.
   await expect(undoButton).toBeDisabled();await expectNoUndoApproval(page);releaseComputer();
   await expect.poll(async()=>(await readUndoGame(page,initial.id,false)).moves.some(move=>move.clientCommandId===computerCommands[0].clientCommandId)).toBe(true);
   await expect(undoButton).toBeEnabled();
  }});
  await expect.poll(async()=>(await readUndoGame(page,initial.id,false)).computer.paused).toBe(false);
  await expect.poll(()=>resumes.length).toBeGreaterThan(0);expect(new Set(resumes.map(command=>command.clientCommandId)).size).toBe(1);
  expect(new Set(computerCommands.map(command=>command.clientCommandId)).size).toBe(1);for(const command of computerCommands)expect(command).toEqual(computerCommands[0]);
  expect(proof.game.moves.filter(move=>move.undone)).toHaveLength(2);
  await page.screenshot({path:info.outputPath('computer-direct-undo.png')});await info.attach('computer-direct-undo-command',{body:JSON.stringify({undoId:proof.command.clientCommandId,computerId:computerCommands[0].clientCommandId,resumeId:resumes[0].clientCommandId}),contentType:'application/json'});
 }finally{releaseComputer();if(!page.isClosed())await context.unroute('**/apply',computerRoute);}
});
