import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {candidateCapabilities} from '../scripts/validation/capabilities.mjs';
import {makeValidationMove} from '../scripts/validation/browser-move.mjs';
import {proof} from '../scripts/validation/proof.mjs';
import {historySnapshot,assertHistoryPreserved} from '../scripts/validation/history-continuity.mjs';
import {createGameFromHome,openDirectGameLink,joinAsViewer,getHistoryMoveCount,setOfflineState} from '../e2e/support/app.mjs';
const capabilities=await candidateCapabilities(process.env.RIGHELT_VALIDATION_TARGET_ROOT||process.cwd());
async function geometry(page){await expect(page.getByTestId('game-board')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);}
async function authoritativeGame(page){return page.evaluate(async()=>{
 const id=decodeURIComponent(location.hash.match(/^#\/game\/([^?]+)/)[1]);
 const identity=localStorage.getItem('righelt.identity.id.v1');
 if(!identity)throw Error('Retained guest identity is missing');
 const response=await fetch(`/api/shell/games/${encodeURIComponent(id)}?identityId=${encodeURIComponent(identity)}`,{cache:'no-store'});
 if(!response.ok)throw Error(`Authoritative guest history: ${response.status}`);
 return (await response.json()).game;
});}

test('create, move, viewer live update, reload and reconnect',async({page,context,browser,baseURL},info)=>{
 if(info.project.use.hasTouch)expect(await page.evaluate(()=>navigator.maxTouchPoints>0&&!matchMedia('(any-hover: hover)').matches)).toBe(true);
 const options=info.project.use;const viewerContext=await browser.newContext({baseURL,viewport:options.viewport,isMobile:options.isMobile,hasTouch:options.hasTouch});const viewer=await viewerContext.newPage();
 try{
  const {gameHash}=await createGameFromHome(page);
  const players=page.locator('[data-action="switch-game-panel"][data-panel="players"]');if(await players.isVisible())await players.click();
  await page.getByRole('button',{name:'Play as both players',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play as both players',exact:true})).toHaveCount(0);
  const board=page.locator('[data-action="switch-game-panel"][data-panel="board"]');if(await board.isVisible())await board.click();
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  await geometry(page);await proof(page,info,'created',page.getByTestId('game-board'));
  if(info.project.use.hasTouch)expect(await page.evaluate(()=>navigator.maxTouchPoints>0&&!matchMedia('(any-hover: hover)').matches)).toBe(true);
  await openDirectGameLink(viewer,baseURL,gameHash);await joinAsViewer(viewer);const before=await getHistoryMoveCount(viewer);
  await makeValidationMove(page,capabilities);await expect.poll(()=>getHistoryMoveCount(viewer)).toBeGreaterThan(before);
  await viewer.reload();await expect.poll(()=>getHistoryMoveCount(viewer)).toBeGreaterThan(before);await geometry(viewer);await proof(viewer,info,'viewer-reloaded',viewer.getByTestId('game-board'));
  await setOfflineState(viewer,true);const offlineCount=await getHistoryMoveCount(viewer);await makeValidationMove(page,capabilities,'p2');await setOfflineState(viewer,false);await expect(viewer.getByTestId('game-shell')).toBeVisible();await expect.poll(()=>getHistoryMoveCount(viewer)).toBeGreaterThan(before);
  await expect.poll(()=>getHistoryMoveCount(viewer)).toBeGreaterThan(offlineCount);
  await proof(viewer,info,'reconnected',viewer.getByTestId('game-board'));
  // Persistent synthetic fixture: the next merge stage must still hydrate this identity/game.
  if(process.env.RIGHELT_CONTINUITY_FILE&&info.project.name==='mid-wide'){
   await writeFile(process.env.RIGHELT_CONTINUITY_FILE,JSON.stringify({version:2,hash:gameHash,count:await getHistoryMoveCount(page),history:historySnapshot(await authoritativeGame(page)),role:await page.getByTestId('game-role').textContent(),storage:await context.storageState()}),{mode:0o600});
  }
 }finally{await viewerContext.close();}
});

test('previous-stage identity and game survive migrations',async({browser,baseURL},info)=>{
 const file=process.env.RIGHELT_CONTINUITY_INPUT;test.skip(!file,'Baseline has no preceding stage');
 const prior=JSON.parse(await readFile(file,'utf8'));expect(prior.version).toBe(2);const opts=info.project.use;const context=await browser.newContext({baseURL,storageState:prior.storage,viewport:opts.viewport,isMobile:opts.isMobile,hasTouch:opts.hasTouch});
 try{const page=await context.newPage();await page.goto(`/${prior.hash}`);await expect(page.getByTestId('game-role')).toHaveText(prior.role);await expect.poll(()=>getHistoryMoveCount(page)).toBe(prior.count);assertHistoryPreserved(await authoritativeGame(page),prior.history);await proof(page,info,'upgrade-retained',page.getByTestId('game-board'));}finally{await context.close();}
});
