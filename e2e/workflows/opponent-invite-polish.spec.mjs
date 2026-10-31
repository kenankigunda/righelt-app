import {test,expect} from '@playwright/test';
import {waitForLegacyIdentity,continueFriendIntroduction,switchGamePanel} from '../support/app.mjs';

test('the initial invitation survives a viewer and closes once its friend joins',async({page,browser,baseURL},info)=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>new Promise(resolve=>window.finishInviteCopy=resolve)}}));
 const contexts=[];
 try{
  await page.goto('/');await waitForLegacyIdentity(page);
  await page.getByTestId('home-create-game').click();await continueFriendIntroduction(page,{friendIntroduction:true});
  const dialog=page.getByRole('dialog',{name:'Invite a friend',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-invite-role="viewer"]')).toHaveCount(0);
  const gameId=decodeURIComponent(new URL(page.url()).hash.match(/^#\/game\/([^?]+)/)[1]);
  const game=await page.evaluate(async id=>{
   const identityId=localStorage.getItem('righelt.identity.id.v1');return(await(await fetch(`/api/shell/games/${id}?identityId=${encodeURIComponent(identityId)}`)).json()).game;
  },gameId);
  const viewerContext=await browser.newContext({baseURL,viewport:{width:390,height:844}});contexts.push(viewerContext);const viewer=await viewerContext.newPage();
  await viewer.goto(`/#/invite/${game.inviteTokens.viewer}?as=viewer`);await viewer.getByTestId('invite-join-viewer').click();await expect(viewer.getByTestId('game-role')).toContainText('Viewer');
  await expect(dialog).toBeVisible();await expect(dialog.locator('[data-invite-role="viewer"]')).toHaveCount(0);
  await dialog.locator('[data-action="share-invite"]').click();await expect.poll(()=>page.evaluate(()=>typeof window.finishInviteCopy)).toBe('function');
  const friendContext=await browser.newContext({baseURL,viewport:{width:390,height:844}});contexts.push(friendContext);const friend=await friendContext.newPage();
  await friend.goto(`/#/invite/${game.inviteToken}?as=blue`);const join=friend.getByRole('button',{name:'Play as Blue',exact:true});await expect(join).toBeEnabled();
  expect(await join.evaluate(e=>getComputedStyle(e).getPropertyValue('--action-color').trim()===getComputedStyle(e).getPropertyValue('--player-p2').trim())).toBe(true);
  await join.click();await expect(friend.getByTestId('game-role')).toContainText('Player 2');
  await expect(dialog).toHaveCount(0);await expect(page.getByTestId('game-board')).toBeVisible();
  await expect.poll(()=>page.locator('#shell-board .cell').first().evaluate(e=>document.activeElement===e)).toBe(true);
  await page.evaluate(()=>window.finishInviteCopy());await expect(dialog).toHaveCount(0);await expect(page.getByText('Link copied! Ready to share.',{exact:true})).toHaveCount(0);
  await switchGamePanel(page,'players');await expect(page.getByTestId('copy-viewer-invite')).toBeEnabled();
  const friendIdentity=await friend.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));expect(friendIdentity).toBeTruthy();
  await expect.poll(()=>page.evaluate(async id=>{
   const identityId=localStorage.getItem('righelt.identity.id.v1');
   const body=await(await fetch(`/api/shell/games/${id}?identityId=${encodeURIComponent(identityId)}`)).json();
   return body.game?.player2?.identityId;
  },gameId)).toBe(friendIdentity);
  await expect(page.getByTestId('participant-player-2')).toHaveText('Guest 2');
  await page.screenshot({path:info.outputPath('friend-joined-players.png')});
  await switchGamePanel(page,'history');
  const readContract=await page.evaluate(async id=>{
   const identityId=localStorage.getItem('righelt.identity.id.v1');
   const readGame=async()=> (await(await fetch(`/api/shell/games/${id}?identityId=${encodeURIComponent(identityId)}`)).json()).game;
   const before=await readGame();const revision=before.gameplayRevision;
   const read=async values=>{const response=await fetch(`/api/shell/games/${id}/decision-history`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identityId,protocolVersion:2,mode:'additional',historyRevision:revision,...values})});return {status:response.status,body:await response.json()};};
   const metadata=await read({metadataOnly:true}),stale=await read({metadataOnly:true,historyRevision:revision-1}),malformed=await read({cursor:{eventSeq:'bad',ordinal:0}});
   const after=await readGame();return {metadata,stale,malformed,unchanged:JSON.stringify(before)===JSON.stringify(after)};
  },gameId);
  expect(readContract.metadata.status).toBe(200);expect(readContract.metadata.body.available).toBe(false);expect(readContract.metadata.body.items).toEqual([]);expect(readContract.metadata.body).not.toHaveProperty('notes');
  expect(readContract.stale.status).toBe(409);expect(readContract.stale.body.error).toBe('history_changed');expect(readContract.malformed.status).toBe(400);expect(readContract.malformed.body.error).toBe('invalid_history_cursor');expect(readContract.unchanged).toBe(true);
  await expect(page.getByRole('button',{name:/More game history|Load more history/})).toHaveCount(0);
 }finally{for(const context of contexts)await context.close();}
});

test('a pending friend request surfaces approval without prematurely settling the invitation',async({page,browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844}});
 try{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await waitForLegacyIdentity(page);await page.getByTestId('home-create-game').click();await continueFriendIntroduction(page,{friendIntroduction:true});
  await expect(page.getByRole('dialog',{name:'Invite a friend',exact:true})).toBeVisible();
  const guest=await context.newPage();await guest.goto(page.url());await guest.getByTestId('invite-join-player').click();
  await expect(guest.getByRole('heading',{name:'Waiting for approval',exact:true})).toBeVisible();
  await expect(page.getByTestId('approval-gate')).toBeVisible();await expect(page.getByTestId('accept-request')).toBeEnabled();
  for(const control of [page.getByTestId('accept-request'),page.getByTestId('ignore-request')])await expect(control.locator('svg path')).toHaveAttribute('d',/.+/);
  await page.getByTestId('accept-request').click();await expect(guest.getByTestId('game-role')).toContainText('Player 2');
  await expect(page.getByTestId('approval-gate')).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Invite a friend',exact:true})).toHaveCount(0);
  await expect(page.getByTestId('game-board')).toBeVisible();
 }finally{await context.close();}
});

test('join failures stay visible for manual retry and late failures cannot follow a different visit',async({page,browser,baseURL},info)=>{
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844}});
 let guest,primaryError;
 try{
  await page.goto('/');await waitForLegacyIdentity(page);await page.getByTestId('home-create-game').click();await continueFriendIntroduction(page,{friendIntroduction:true});
  await expect(page.getByRole('dialog',{name:'Invite a friend',exact:true})).toBeVisible();
  const gameId=decodeURIComponent(new URL(page.url()).hash.match(/^#\/game\/([^?]+)/)[1]);
  const token=await page.evaluate(async id=>{const identityId=localStorage.getItem('righelt.identity.id.v1');return(await(await fetch(`/api/shell/games/${id}?identityId=${encodeURIComponent(identityId)}`)).json()).game.inviteToken;},gameId);
  guest=await context.newPage();
  await guest.addInitScript(()=>{
   const records=window.inviteFocusObservations=[];
   const record=event=>{if(records.length<200)records.push({type:event.type,at:performance.now(),focused:document.hasFocus(),hidden:document.hidden,activeAction:document.activeElement?.getAttribute('data-action')??null,activeTag:document.activeElement?.tagName??null});};
   for(const type of ['focus','blur'])window.addEventListener(type,record);
   for(const type of ['focusin','focusout'])document.addEventListener(type,record);
  });
  const invite=`/#/invite/${token}?as=blue`;await guest.goto(invite);
  let requests=0,release;let attempt='fast-reject';
  const focusFailureCode='invite_focus_failure_before_keyup';
  await guest.route('**/api/shell/games/*/join',async route=>{
   requests++;
   if(attempt==='fast-reject'){await route.fulfill({status:503,json:{ok:false,error:focusFailureCode}});return;}
   if(attempt==='reset'){await route.abort('connectionreset');return;}
   if(attempt==='reject'||attempt==='stale'){
    await new Promise(resolve=>release=resolve);await route.fulfill({status:503,json:{ok:false,error:'temporarily_unavailable'}});return;
   }
   await route.continue();
  });
  const join=guest.getByRole('button',{name:'Play as Blue',exact:true}),error=guest.getByRole('dialog').getByTestId('join-failure');
  // Element.focus alone does not activate a separate native browser window.
  // Establish keyboard focus before testing its retention across a failure.
  await guest.bringToFront();await expect.poll(()=>guest.evaluate(()=>document.hasFocus()&&!document.hidden)).toBe(true);
  await join.focus();
  // Complete the fast failure while Enter still defers DOM replacement. Focus
  // must survive the actual keyup render, not a request-finally timing window.
  await guest.keyboard.down('Enter');
  try { await expect.poll(()=>guest.evaluate(()=>window.__righeltLastError)).toBe(focusFailureCode); }
  finally { await guest.keyboard.up('Enter'); }
  await expect(error).toHaveText('Could not join. Try again');await expect(join).toBeEnabled();await expect(join).toBeFocused();expect(requests).toBe(1);await guest.screenshot({path:info.outputPath('join-failure-focused.png')});
  await expect(error).not.toHaveAttribute('data-loading-state',/.+/);await guest.setViewportSize({width:391,height:844});await expect(error).toHaveText('Could not join. Try again');expect(requests).toBe(1);
  attempt='reset';await join.press('Enter');await expect(error).toHaveText('Could not join. Try again');await expect(join).toBeFocused();expect(requests).toBe(2);
  attempt='reject';await join.press('Enter');await expect(join).toBeDisabled();await expect(error).toHaveCount(0);await expect.poll(()=>typeof release).toBe('function');release();
  await expect(error).toHaveText('Could not join. Try again');await expect(join).toBeFocused();expect(requests).toBe(3);
  attempt='stale';release=undefined;await join.press('Enter');await expect.poll(()=>typeof release).toBe('function');
  await guest.getByRole('link',{name:'Back home',exact:true}).click();await expect(guest.getByTestId('home-create-game')).toBeVisible();release();
  await expect(error).toHaveCount(0);await expect(guest.getByTestId('home-create-game')).toBeVisible();expect(requests).toBe(4);
  await guest.goto(invite);await expect(join).toBeEnabled();await expect(error).toHaveCount(0);
  attempt='success';await join.click();await expect(guest.getByTestId('game-role')).toContainText('Player 2');await expect(error).toHaveCount(0);expect(requests).toBe(5);
 }catch(error){primaryError=error;throw error;}finally{
  try{if(guest)await info.attach('Guest invite native focus',{body:JSON.stringify(await guest.evaluate(()=>({focused:document.hasFocus(),hidden:document.hidden,activeAction:document.activeElement?.getAttribute('data-action')??null,activeTag:document.activeElement?.tagName??null,events:window.inviteFocusObservations})).catch(error=>({readError:String(error)})),null,2),contentType:'application/json'});}
  catch(error){if(!primaryError)throw error;info.annotations.push({type:'diagnostic capture failure',description:String(error)});}
  finally{await context.close();}
 }
});
