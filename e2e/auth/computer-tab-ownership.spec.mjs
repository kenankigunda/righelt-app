import {test,expect} from '@playwright/test';
import {AUTH_CONTROL_ORIGIN} from './fixture.mjs';
import {enterUsername,signOutAndOpenSignIn,waitForAccountStartup} from './helpers.mjs';
import {readProjectedGame,waitForOpponentReady} from '../support/computer-projection.mjs';
import {isOperationRequest,operationValues} from '../support/shared-request.mjs';

const projected=(page,id)=>page.evaluate(readProjectedGame,{id});
const createsGame=response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST';

test('same-tab relogin cannot reuse the old lease and Resume here acknowledges fresh ownership',async({page,context},info)=>{
 test.setTimeout(120000);
 expect((await fetch(`${AUTH_CONTROL_ORIGIN}/reset-limits`,{method:'POST'})).ok).toBe(true);
 const username=`Lease_${Date.now().toString(36)}`,password='A local lease recovery password 482';
 await page.goto('/');await waitForAccountStartup(page);
 await page.getByRole('button',{name:'Play both sides',exact:true}).click();
 const dialog=page.getByTestId('account-dialog');
 await dialog.getByRole('button',{name:'Create account',exact:true}).click();
 await enterUsername(page,username);await dialog.getByLabel('Password',{exact:true}).fill(password);
 const creation=page.waitForResponse(createsGame);
 await dialog.getByRole('button',{name:'Create account & continue',exact:true}).click();
 const registered=await creation;expect(registered.ok()).toBe(true);
 await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',(await registered.json()).game.id);
 await page.evaluate(()=>{location.hash='#/';});await waitForAccountStartup(page);
 await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const computerCreation=page.waitForResponse(createsGame);
 await page.getByRole('button',{name:'Play Babs',exact:true}).click();
 const response=await computerCreation;expect(response.ok()).toBe(true);const game=(await response.json()).game;
 await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',game.id);
 const card=label=>page.getByRole('button',{name:`Babs, Blue, ${label}`,exact:true});
 await expect(card('Active here')).toBeVisible();
 const tabMarker=await page.evaluate(()=>window.leaseTabMarker=crypto.randomUUID());
 const oldContext=await page.evaluate(async()=>{const response=await fetch('/api/auth/session');if(!response.ok)throw Error('Session read failed');return (await response.json()).contextId;});
 // Lose only best-effort release. The old private auth context stays on the
 // authoritative lease, while logout/login and control receipts remain real.
 await context.route(/\/(shared|computer-control)$/,async route=>{
  if(isOperationRequest(route.request(),'computer-control')&&operationValues(route.request())?.action==='release')return route.abort();
  return route.continue();
 });
 let computerSubmissions=0;
 const observeComputerSubmission=request=>{
  if(request.method()==='POST'&&/\/(apply|end-turn)$/.test(new URL(request.url()).pathname)&&request.postDataJSON()?.payload?.computer)computerSubmissions++;
 };
 page.on('request',observeComputerSubmission);
 try{
  await page.getByTestId('account-open').click();
  await expect.poll(async()=>{const current=await projected(page,game.id);return current.computer.lease.expiresAt-Date.now();}).toBeGreaterThan(10000);
  const before=await projected(page,game.id);expect(before.computer.lease).not.toHaveProperty('authContextId');
  await signOutAndOpenSignIn(page);await enterUsername(page,username);await dialog.getByLabel('Password',{exact:true}).fill(password);
  const login=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/login'&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'Sign in',exact:true}).click();expect((await login).ok()).toBe(true);
  await expect(dialog).not.toBeVisible();await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',game.id);
  expect(await page.evaluate(()=>window.leaseTabMarker)).toBe(tabMarker);
  const newContext=await page.evaluate(async()=>{const response=await fetch('/api/auth/session');if(!response.ok)throw Error('Session read failed');return (await response.json()).contextId;});
  expect(newContext).not.toBe(oldContext);
  const retained=await projected(page,game.id);
  expect(retained.computer.generation).toBe(before.computer.generation);expect(retained.computer.lease.deviceId).toBe(before.computer.lease.deviceId);
  expect(retained.computer.lease.expiresAt).toBeGreaterThan(Date.now());expect(retained.computer.lease).not.toHaveProperty('authContextId');
  expect(retained.gameplayRevision).toBe(before.gameplayRevision);expect(retained.moves).toEqual(before.moves);
  expect(computerSubmissions).toBe(0);
  await expect(card('Waiting for a turn')).toBeVisible();await expect(card('Active here')).toHaveCount(0);
  await card('Waiting for a turn').press('Enter');const resume=page.getByRole('button',{name:'Resume here',exact:true});await expect(resume).toBeEnabled();
  const resumeRequest=page.waitForRequest(request=>isOperationRequest(request,'computer-control')&&operationValues(request)?.action==='resume-here');
  await resume.focus();await resume.press('Enter');const command=(await resumeRequest).postDataJSON();expect(command.kind).toBe('shared');
  await expect(card('Active here')).toBeVisible();await expect(card('Active here')).toHaveAttribute('aria-expanded','true');await expect(card('Active here')).toBeFocused();await expect(resume).toHaveCount(0);
  const after=await projected(page,game.id);
  expect(after.computer.generation).toBeGreaterThan(before.computer.generation);expect(after.computer.lease.deviceId).toBe(before.computer.lease.deviceId);
  expect(after.computer.seats).toEqual(before.computer.seats);expect(after.computer.modelId).toBe(before.computer.modelId);
  expect(after.gameplayRevision).toBe(before.gameplayRevision);expect(after.moves).toEqual(before.moves);
  expect(computerSubmissions).toBe(0);
  await page.screenshot({path:info.outputPath('computer-current-session-active.png')});
 }finally{page.off('request',observeComputerSubmission);await context.unrouteAll({behavior:'wait'});}
});
