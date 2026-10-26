import { test, expect } from '@playwright/test';
import { createGameFromHome } from '../support/app.mjs';

const invitationFor = (page,gameId) => page.evaluate(async id=>{
  const identityId=localStorage.getItem('righelt.identity.id.v1');
  const response=await fetch(`/api/shell/games/${encodeURIComponent(id)}?identityId=${encodeURIComponent(identityId)}`);
  if(!response.ok)throw Error(`Fixture game read failed: ${response.status}`);
  const {game}=await response.json();return {viewer:game.inviteTokens.viewer,player:game.inviteToken};
},gameId);

test('an invitation lookup timeout exposes Retry and Home, then one manual retry opens the real invitation',async({page,browser,baseURL},info)=>{
  const {gameId}=await createGameFromHome(page),invite=await invitationFor(page,gameId);
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844}}),viewer=await context.newPage();
  let reads=0,releaseFirst,releaseRetry;
  const writes=[];
  viewer.on('request',request=>{
    const path=new URL(request.url()).pathname,method=request.method();
    const readOnlyPost=method==='POST'&&/^\/api\/shell\/games\/[^/]+\/(?:reconcile|decision-history)$/.test(path);
    if(method!=='GET'&&path.startsWith('/api/shell/')&&!readOnlyPost)writes.push({method,path});
  });
  await viewer.route('**/api/shell/invites/*',route=>{
    reads++;
    if(reads===1)return new Promise(resolve=>{releaseFirst=()=>{void route.abort().catch(()=>{}).finally(resolve);};});
    if(reads===2)return new Promise((resolve,reject)=>{releaseRetry=()=>{void route.continue().then(resolve,reject);};});
    return route.continue();
  });
  try{
    await viewer.goto(`/#/invite/${encodeURIComponent(invite.viewer)}?as=viewer`);
    // The real transport keeps its existing five-second deadline. This new
    // assertion allows that deadline plus ordinary startup/render delivery.
    const recovery=viewer.getByTestId('invite-load-recovery');await expect(recovery).toBeVisible({timeout:10000});
    expect(reads).toBe(1);await expect(recovery.getByRole('status')).toHaveText('We couldn’t load your invitation');
    await expect(recovery).not.toContainText(/request_timeout|HTTP|network/);
    releaseFirst();
    const before=await recovery.locator('xpath=..').boundingBox();
    await recovery.getByRole('button',{name:'Retry',exact:true}).dblclick();
    await expect(recovery.getByRole('button',{name:'Retry',exact:true})).toBeDisabled();await expect(recovery.getByRole('link',{name:'Home',exact:true})).toBeVisible();
    expect(reads).toBe(2);expect(await recovery.locator('xpath=..').boundingBox()).toEqual(before);
    releaseRetry();
    await expect(viewer.getByTestId('invite-join-viewer')).toBeEnabled();await expect(recovery).toHaveCount(0);expect(reads).toBe(2);expect(writes).toEqual([]);
    await viewer.getByTestId('invite-join-viewer').click();await expect(viewer.getByTestId('game-role')).toContainText('Viewer');
    await viewer.screenshot({path:info.outputPath('invitation-recovered.png')});
  }finally{releaseFirst?.();releaseRetry?.();await context.close();}
});

test('a confirmed missing invitation offers Home without a retry loop',async({page})=>{
  let reads=0;page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/shell/invites/'))reads++;});
  await page.goto(`/#/invite/missing-invitation-${Date.now().toString(36)}`);
  const recovery=page.getByTestId('invite-load-recovery');await expect(recovery).toBeVisible();
  await expect(recovery.getByRole('heading',{name:'Invitation unavailable',exact:true})).toBeVisible();await expect(recovery.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);expect(reads).toBe(1);
  await recovery.getByRole('link',{name:'Home',exact:true}).click();await expect(page.getByTestId('home-create-game')).toBeVisible();expect(reads).toBe(1);
});

test('a late successful lookup cannot replace a different current invitation',async({page,browser,baseURL})=>{
  const {gameId}=await createGameFromHome(page),invite=await invitationFor(page,gameId);
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844}}),viewer=await context.newPage();
  let releaseFirst,firstRequest,delayedResponse;
  const observed=new Promise(resolve=>delayedResponse=resolve);
  await viewer.route(`**/api/shell/invites/${encodeURIComponent(invite.viewer)}`,async route=>{
    firstRequest=route.request();const response=await route.fetch();expect(response.status()).toBe(200);
    await new Promise(resolve=>{releaseFirst=resolve;delayedResponse();});
    await route.fulfill({response});
  });
  try{
    await viewer.goto(`/#/invite/${encodeURIComponent(invite.viewer)}?as=viewer`);await observed;
    await viewer.goto(`/#/invite/${encodeURIComponent(invite.player)}?as=blue`);
    await expect(viewer.getByRole('button',{name:'Play as Blue',exact:true})).toBeEnabled();
    const delivered=viewer.waitForResponse(response=>response.request()===firstRequest);releaseFirst();expect((await delivered).status()).toBe(200);
    await expect(viewer.getByRole('button',{name:'Play as Blue',exact:true})).toBeEnabled();await expect(viewer.getByTestId('invite-load-recovery')).toHaveCount(0);
  }finally{releaseFirst?.();await context.close();}
});
