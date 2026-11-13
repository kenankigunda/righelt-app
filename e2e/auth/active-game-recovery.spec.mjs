import {test,expect} from '@playwright/test';
import {AUTH_CONTROL_ORIGIN} from './fixture.mjs';
import {switchGamePanel} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
import {isOperationRequest} from '../support/shared-request.mjs';

const projected=(page,id)=>page.evaluate(readProjectedGame,{id});

test('active account game restores socket authority after a mid-game transport interruption',async({page})=>{
 expect((await fetch(`${AUTH_CONTROL_ORIGIN}/reset-limits`,{method:'POST'})).ok).toBe(true);
 let blocked=false,socketCount=0,currentSocket;
 let observeRecoveryWrites=false;
 const gameplayWrites=[];
 page.on('request',request=>{
  if(observeRecoveryWrites&&(isOperationRequest(request,'apply')||isOperationRequest(request,'end-turn')))gameplayWrites.push(request);
 });
 await page.routeWebSocket(/\/api\/shell\/games\//,socket=>{
  socketCount++;currentSocket=socket;const server=socket.connectToServer();
  server.onMessage(message=>{if(!blocked)socket.send(message);});
 });
 try{
  await page.goto('/');
  await page.getByRole('button',{name:'Play both sides',exact:true}).click();
  const account=page.getByTestId('account-dialog'),username=`Recovery_${Date.now().toString(36)}`;
  await account.getByRole('button',{name:'Create account',exact:true}).click();
  await account.getByLabel('Username',{exact:true}).fill(username);
  await account.getByLabel('Password',{exact:true}).fill('An account recovery password 482');
  await account.getByRole('button',{name:'Create account & continue',exact:true}).click();
  await expect(page.getByTestId('game-shell')).toBeVisible();
  await switchGamePanel(page,'board');
  const accountEntry=page.getByRole('button',{name:'Account',exact:true});
  await expect(accountEntry).toHaveAttribute('data-authenticated','true');
  await expect(page.getByTestId('game-role')).toContainText('both players');
  await expect(page.locator('[data-board-preview-action="pass"]')).toBeEnabled();
  const gameId=await page.getByTestId('game-shell').getAttribute('data-game-id');
  expect(gameId).toMatch(/^game-/);
  const initial=await projected(page,gameId);
  const setupMove=page.waitForRequest(request=>isOperationRequest(request,'apply'));
  await page.locator('[data-board-preview-action="pass"]').click();
  expect((await setupMove).postDataJSON().payload.action.type).toBe('pass');
  await expect.poll(async()=>(await projected(page,gameId)).moves.length,{message:'The account-owned setup move must be acknowledged before transport loss'}).toBe(initial.moves.length+1);
  const settled=await projected(page,gameId);
  expect(settled.gameplayRevision).toBeGreaterThan(initial.gameplayRevision);
  observeRecoveryWrites=true;
  const initialSocketCount=socketCount;

  blocked=true;await currentSocket.close({code:1012,reason:'Account recovery acceptance'});
  await expect.poll(()=>socketCount).toBeGreaterThan(initialSocketCount);
  await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toBeVisible();
  await expect(page.locator('[data-board-preview-action]:enabled')).toHaveCount(0);

  blocked=false;const blockedSocket=currentSocket;await blockedSocket.close({code:1012,reason:'Resume account recovery'});
  await expect.poll(()=>socketCount).toBeGreaterThan(initialSocketCount+1);
  await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0,{timeout:15_000});
  await expect(page.locator('[data-board-preview-action="pass"]')).toBeEnabled();
  await expect(accountEntry).toHaveAttribute('data-authenticated','true');
  const recovered=await projected(page,gameId);
  expect(recovered.gameplayRevision).toBe(settled.gameplayRevision);
  expect(recovered.moves).toEqual(settled.moves);
  expect(gameplayWrites).toHaveLength(0);
 }finally{
  blocked=false;await page.unrouteAll({behavior:'ignoreErrors'});
 }
});
