import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {AUTH_CONTROL_ORIGIN} from './fixture.mjs';
import {waitForAccountStartup,openPlaySignIn,enterUsername} from './helpers.mjs';

test('cached Home survives a peer read failure and only a fresh native Start creates a game',async({page},info)=>{
  expect((await fetch(`${AUTH_CONTROL_ORIGIN}/reset-limits`,{method:'POST'})).ok).toBe(true);
  let creates=0;const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/shell/games')creates++;});
  await page.goto('/');await waitForAccountStartup(page);await openPlaySignIn(page);
  const account=page.getByTestId('account-dialog');
  await account.getByRole('button',{name:'Create account',exact:true}).click();
  await enterUsername(page,`Read_${Date.now().toString(36)}`);
  await account.getByLabel('Password',{exact:true}).fill('A Home recovery browser password 482');
  await account.getByRole('button',{name:'Create account & continue',exact:true}).click();
  const start=page.getByRole('button',{name:'Start a friend game',exact:true});
  await expect(start).toBeVisible();await expect(start).toBeEnabled();
  const initial=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/shell/games');
  await start.click();const first=await initial;expect(first.status()).toBe(200);
  const firstBody=await first.json();const firstId=firstBody.game.id;
  await page.getByRole('button',{name:'Close invite',exact:true}).click();
  await page.locator('.shell-header-title-link').click();
  const card=page.locator(`[data-home-section-root="my"] a[href*="${firstId}"]`).first();
  await expect(card).toBeVisible();
  await card.click();await expect(page.getByTestId('game-shell')).toBeVisible();
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',firstId);
  let failed=0,held=0,myReads=0,otherReads=0,checkpoint='routes-armed',releaseMy,releaseFirstOther,releaseRetry;
  const myFinished=new Set(),myOrdinals=new WeakMap();
  const firstMyGate=new Promise(resolve=>{releaseMy=resolve;});
  const firstOtherGate=new Promise(resolve=>{releaseFirstOther=resolve;});
  const retryGate=new Promise(resolve=>{releaseRetry=resolve;});
  page.on('response',response=>{
    const ordinal=myOrdinals.get(response.request());
    if(ordinal&&response.ok())void response.finished().then(error=>{if(!error)myFinished.add(ordinal);},()=>{});
  });
  await page.route('**/api/shell/games?**',async route=>{
    const section=new URL(route.request().url()).searchParams.get('section');
    if(section==='other'){
      otherReads++;
      if(otherReads===1){await firstOtherGate;failed++;await route.abort('connectionreset');return;}
      held++;await retryGate;await route.continue();return;
    }
    if(section==='my'){
      const ordinal=++myReads;myOrdinals.set(route.request(),ordinal);
      if(ordinal===1)await firstMyGate;
    }
    await route.continue();
  });
  try{
    // A real route transition starts the read. Capture only the NEW mounted
    // Home card, never require node identity across legitimate route unmount.
    await page.locator('.shell-header-title-link').click();
    await expect.poll(()=>({myReads,otherReads})).toEqual({myReads:1,otherReads:1});
    checkpoint='both-first-home-requests-held';
    await expect(card).toBeVisible();
    checkpoint='new-home-cached-card-visible';
    const node=await card.elementHandle(),before=await card.innerText();
    const count=await page.locator('[data-home-section-root="my"] .mini-board-card').count();
    releaseMy();await expect.poll(()=>myFinished.has(1)).toBe(true);
    expect(await node.evaluate(el=>el.isConnected)).toBe(true);
    expect(await card.innerText()).toBe(before);
    expect(await page.locator('[data-home-section-root="my"] .mini-board-card').count()).toBe(count);
    releaseFirstOther();
    await expect.poll(()=>({failed,held,myReady:myFinished.has(2)})).toEqual({failed:1,held:1,myReady:true});
    expect(myReads).toBe(2);expect(otherReads).toBe(2);expect(creates).toBe(1);
    expect(await node.evaluate(el=>el.isConnected)).toBe(true);
    expect(await card.innerText()).toBe(before);
    expect(await page.locator('[data-home-section-root="my"] .mini-board-card').count()).toBe(count);
    releaseRetry();
    await expect(page.getByTestId('home-create-game').first()).toBeEnabled();
    expect(creates).toBe(1);
    // End the fault episode before fresh native navigation can issue new reads.
    await page.unrouteAll({behavior:'wait'});
    await page.getByTestId('home-create-game').first().click();
    await expect(start).toBeVisible();await expect(start).toBeEnabled();
    const accepted=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/shell/games');
    await start.click();const response=await accepted;expect(response.status()).toBe(200);
    const body=await response.json(),command=response.request().postDataJSON();
    expect(body.game.id).toBe(command.gameId);expect(body.game.id).not.toBe(firstId);expect(creates).toBe(2);
    await writeFile(info.outputPath('home-read-recovery.json'),JSON.stringify({firstId,newGameId:body.game.id,failed,held,creates,cachedCardCount:count},null,2));
    await page.getByRole('button',{name:'Close invite',exact:true}).click();
    await page.screenshot({path:info.outputPath('home-read-recovery-created.png')});
    expect(pageErrors).toEqual([]);
  }finally{
    await writeFile(info.outputPath('home-read-checkpoint.json'),JSON.stringify({checkpoint,myReads,otherReads,failed,held,creates,myFinished:[...myFinished]},null,2)).catch(()=>console.warn('Home read checkpoint evidence incomplete'));
    releaseMy();releaseFirstOther();releaseRetry();await page.unrouteAll({behavior:'wait'});
  }
});
