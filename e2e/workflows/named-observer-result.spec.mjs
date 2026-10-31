import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';
import {openDirectGameLink,joinAsViewer,switchGamePanel,waitForLegacyIdentity} from '../support/app.mjs';

// Real server import, guest identities and viewer admission; result text is
// never injected into the DOM and no browser-side engine computes the result.
test('a guest observer sees named results while the two-sided owner retains winner color and rematch semantics',async({page,browser,baseURL},info)=>{
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844}});
 const viewer=await context.newPage(),errors=[],pendingSnapshots=new Set();
 const isSnapshot=request=>new URL(request.url()).pathname.endsWith('/decision-snapshot');
 viewer.on('request',request=>{if(isSnapshot(request))pendingSnapshots.add(request);});
 viewer.on('requestfinished',request=>pendingSnapshots.delete(request));
 viewer.on('requestfailed',request=>pendingSnapshots.delete(request));
 for(const client of [page,viewer])client.on('pageerror',error=>errors.push(error.message));
 const read=(client,id)=>client.evaluate(async id=>{
  const identityId=localStorage.getItem('righelt.identity.id.v1');
  const response=await fetch(`/api/shell/games/${encodeURIComponent(id)}?identityId=${encodeURIComponent(identityId)}`);
  if(!response.ok)throw Error(`Result read failed: ${response.status}`);
  return(await response.json()).game;
 },id);
 const unchanged=(before,after)=>{
  expect(after.gameplayRevision).toBe(before.gameplayRevision);
  expect(after.board.state).toEqual(before.board.state);
  expect(after.moves).toEqual(before.moves);expect(after.turns).toEqual(before.turns);
 };
 const openResult=async client=>{
  await switchGamePanel(client,'history');
  await client.getByRole('button',{name:'View result',exact:true}).click();
  await expect(client.getByTestId('game-result')).toBeVisible();
 };
 try {
  await page.goto('/');await expect(page.getByTestId('home-create-game')).toBeVisible();await waitForLegacyIdentity(page);
  const creation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');
  await page.locator('button[data-action="create-self-play"]').click();
  const created=await creation;expect(created.status()).toBe(200);const source=(await created.json()).game;
  expect(source.selfPlayMode).toBe(true);expect(source.player1.identityId).toBe(source.player2.identityId);
  const catalog=JSON.parse(await readFile(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
  const scenario=catalog.scenarios.find(item=>item.title==='Capture supply point to win by unsupplying the commander');expect(scenario).toBeTruthy();
  const game=await page.evaluate(async({scenario,sourceGameId,header})=>{
   const bootstrap=await fetch('/api/shell/bootstrap');if(!bootstrap.ok)throw Error(`Bootstrap failed: ${bootstrap.status}`);
   const generation=bootstrap.headers.get(header),identityId=localStorage.getItem('righelt.identity.id.v1');
   if(!identityId)throw Error('Expected initialized guest identity');
   // Standard local guest stacks may omit STORAGE_GENERATION; when the
   // server advertises a generation, preserve it exactly as the app does.
   const response=await fetch('/api/shell/scenarios/import',{method:'POST',headers:{'Content-Type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify({identityId,scenario,sourceGameId,protocolVersion:2})});
   if(!response.ok)throw Error(`Catalog terminal import failed: ${response.status}`);
   return(await response.json()).game;
  },{scenario,sourceGameId:source.id,header:STORAGE_GENERATION_HEADER});
  expect(game.moves.length).toBeGreaterThan(0);
  expect(game.board.state.outcome).toEqual({status:'p1_win',reason:'p2_commander_unsupplied'});
  expect(game.selfPlayMode).toBe(true);expect(game.selfPlayStartSide).toBe('p1');expect(game.player1.identityId).toBe(game.player2.identityId);expect(game.computer).toBeFalsy();
  await page.goto(`/#/game/${game.id}`);await expect(page.getByTestId('game-shell')).toBeVisible();await expect(page.getByTestId('game-result')).toHaveCount(0);
  await openDirectGameLink(viewer,baseURL,`#/game/${game.id}`);await joinAsViewer(viewer);
  const observerIdentity=await viewer.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));expect(observerIdentity).not.toBe(game.player1.identityId);
  const before=await read(page,game.id);
  await openResult(viewer);
  const observerResult=viewer.getByTestId('game-result');
  await expect(observerResult).toHaveAttribute('data-result-tone','neutral');await expect(observerResult).toHaveAttribute('data-winner','p1');
  await expect(observerResult.getByRole('heading',{name:'Guest 1 won',exact:true})).toBeVisible();
  await expect(observerResult.getByText('Guest 2’s commander lost its supply.',{exact:true})).toBeVisible();
  await expect(observerResult.getByRole('heading',{name:'You won',exact:true})).toHaveCount(0);
  await expect(observerResult.locator('h1 bdi')).toHaveText('Guest 1');
  // Neutral observers retain the ink mark; victory color belongs to the owner.
  await viewer.screenshot({path:info.outputPath('guest-observer-result.png')});
  await observerResult.getByRole('button',{name:'Review game',exact:true}).click();await switchGamePanel(viewer,'history');
  const inspectedMove=viewer.getByTestId('history-move-item').last();
  await inspectedMove.locator(':scope > .history-move-hit').click();await expect(observerResult).toHaveCount(0);
  // Complete the requested inspection and adjacent prefetch before a normal
  // reload. Keep strict page-error checks instead of filtering navigation errors.
  await expect(inspectedMove).toHaveClass(/is-selected/);
  await expect(inspectedMove.getByTestId('history-inline-preview').locator('.cell')).toHaveCount(100);
  await expect(viewer.getByTestId('history-load-status')).toHaveCount(0);
  await expect.poll(()=>pendingSnapshots.size,{message:'Expected observed history snapshot reads to finish before reload'}).toBe(0);
  await viewer.reload();await expect(viewer.getByTestId('game-shell')).toBeVisible();await expect(observerResult).toHaveCount(0);
  await openResult(viewer);await expect(observerResult.getByRole('heading',{name:'Guest 1 won',exact:true})).toBeVisible();
  unchanged(before,await read(page,game.id));
  await openResult(page);const ownerResult=page.getByTestId('game-result');
  await expect(ownerResult.getByRole('heading',{name:'You won',exact:true})).toBeVisible();await expect(ownerResult.getByText('You play both sides',{exact:true})).toBeVisible();
  await expect(ownerResult).toHaveAttribute('data-result-tone','victory');await expect(ownerResult).toHaveAttribute('data-winner','p1');
  await expect(ownerResult.getByText('Your Blue commander lost its supply.',{exact:true})).toBeVisible();
  await expect(ownerResult.locator('.result-stone')).toHaveCSS('fill','rgb(194, 69, 47)');
  await ownerResult.getByRole('button',{name:'Play again',exact:true}).click();const rematch=page.getByRole('dialog',{name:'Play again',exact:true});
  const opponent=rematch.locator('input[name="rematch-opponent"][value="self"]'),side=rematch.locator('input[name="rematch-side"][value="p2"]');
  await expect(opponent).toHaveAccessibleName('Play both sides');await expect(opponent).toBeChecked();await expect(rematch.locator('input[name="rematch-opponent"]:checked')).toHaveCount(1);
  await expect(side).toHaveAccessibleName('Blue');await expect(side).toBeChecked();await expect(rematch.locator('input[name="rematch-side"][value="p1"]')).toHaveAccessibleName('Red');await expect(rematch.locator('input[name="rematch-side"]:checked')).toHaveCount(1);
  await expect(rematch.getByRole('button',{name:'Start game',exact:true})).toBeEnabled();
  const freshResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');
  await rematch.getByRole('button',{name:'Start game',exact:true}).click();const response=await freshResponse;expect(response.status()).toBe(200);const fresh=(await response.json()).game;
  expect(fresh.id).not.toBe(game.id);expect(fresh.selfPlayMode).toBe(true);expect(fresh.selfPlayStartSide).toBe('p2');expect(fresh.player1.identityId).toBe(game.player1.identityId);expect(fresh.player2.identityId).toBe(game.player1.identityId);expect(fresh.moves).toEqual([]);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',fresh.id);unchanged(before,await read(page,game.id));expect(errors).toEqual([]);
 }finally{await context.close();}
});
