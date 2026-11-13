import {test,expect} from '@playwright/test';
import {isOperationRequest} from '../support/shared-request.mjs';
import {createGameFromHome,switchGamePanel} from '../support/app.mjs';

test('terminal recovery stops automatic work and Retry creates a fresh authoritative episode',async({page})=>{
 test.slow();
 await page.setViewportSize({width:390,height:844});
 await page.clock.install();
 let phase='idle',releaseOld,releaseFresh,seenOld,seenFresh,settleOld,firstSocket,oldHeld=false,freshHeld=false;
 const oldGate=new Promise(resolve=>releaseOld=resolve),freshGate=new Promise(resolve=>releaseFresh=resolve);
 const oldWaiting=new Promise(resolve=>seenOld=resolve),freshWaiting=new Promise(resolve=>seenFresh=resolve);
 const oldSettled=new Promise(resolve=>settleOld=resolve);
 let reconcileRequests=0,socketCount=0;
 await page.routeWebSocket(/\/api\/shell\/games\//,socket=>{
  socketCount++;firstSocket??=socket;const server=socket.connectToServer();
  server.onMessage(message=>{if(phase==='idle')socket.send(message);});
 });
 const {gameId}=await createGameFromHome(page);await switchGamePanel(page,'board');
 await expect(page.locator('[data-board-preview-action="pass"]')).toBeEnabled();
 await page.route(`**/api/shell/games/${gameId}/**`,async route=>{
  if(!isOperationRequest(route.request(),'reconcile')){await route.continue();return;}
  reconcileRequests++;const response=await route.fetch({maxRetries:1});
  if(phase==='old'&&!oldHeld){
   oldHeld=true;seenOld();await oldGate;
   try{await route.fulfill({response});settleOld('delivered');}
   catch{settleOld('retired');}
   return;
  }
  else if(phase==='retry'&&!freshHeld){freshHeld=true;seenFresh();await freshGate;}
  await route.fulfill({response});
 });
 try{
  const frozenAt=await page.evaluate(()=>Date.now());await page.clock.setFixedTime(frozenAt);await page.clock.pauseAt(frozenAt);await page.clock.setSystemTime(frozenAt);
  phase='old';await firstSocket.close({code:1012,reason:'Terminal recovery acceptance'});
  await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toBeVisible();await oldWaiting;
  const started=await page.evaluate(async()=>{
   const timeline=(await import('/shell/recovery-telemetry.js')).recoveryTimelineSnapshot();
   return timeline.findLast(event=>event.type==='recovery_started'&&event.activeEpisodeRelation==='active');
  });
  expect(started?.episodeId).toBeTruthy();
  await page.clock.runFor(59_999);
  await expect(page.getByText('Connection failed. Retry to keep playing or view details.',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(async()=>{
   const timeline=(await import('/shell/recovery-telemetry.js')).recoveryTimelineSnapshot();
   return timeline.some(event=>event.type==='recovery_blocked'&&event.terminalFailure===true);
  })).toBe(false);
  await page.clock.runFor(1);
  await expect(page.getByTestId('sync-recovery-banner').getByText('Connection failed. Retry to keep playing or view details.',{exact:true})).toBeVisible();
  await expect(page.locator('[data-board-preview-action]:enabled')).toHaveCount(0);
  const alert=page.getByTestId('sync-recovery-banner'),retry=alert.getByRole('button',{name:'Retry connection',exact:true});
  const reload=alert.getByRole('button',{name:'Reload game',exact:true}),home=alert.getByRole('link',{name:'Home',exact:true}),details=alert.getByRole('button',{name:'Details',exact:true});
  for(const control of [retry,reload,home,details])await expect(control).toBeVisible();
  await expect(alert).toHaveClass(/is-terminal-recovery/);
  // The complete responsive geometry matrix lives in the native
  // browser-integration/recovery-alert.spec.mjs contract. Keep this real-stack
  // proof focused on the same structural hierarchy at constrained, 200% text.
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  expect(await alert.evaluate(node=>[...node.querySelector('.shell-game-alert-actions').children].map(child=>child.textContent.trim()))).toEqual(['Retry connection','Reload game','Home']);
  expect(await details.evaluate(node=>node.closest('.shell-game-alert-actions'))).toBeNull();
  const actionBox=await alert.locator('.shell-game-alert-actions').boundingBox(),detailsBox=await details.boundingBox();
  expect(detailsBox.y).toBeGreaterThanOrEqual(actionBox.y+actionBox.height);
  const terminal=await page.evaluate(async()=>{
   const timeline=(await import('/shell/recovery-telemetry.js')).recoveryTimelineSnapshot();
   return timeline.findLast(event=>event.type==='recovery_blocked'&&event.terminalFailure===true);
  });
  expect(terminal).toMatchObject({activeEpisodeRelation:'active',result:'terminal_failure',terminalFailure:true});expect(terminal.episodeId).toBeTruthy();
  const stopped={reconcileRequests,socketCount};await page.clock.runFor(60_000);expect({reconcileRequests,socketCount}).toEqual(stopped);

  phase='retry';await retry.click();await freshWaiting;
  const retried=await page.evaluate(async episodeId=>{
   const timeline=(await import('/shell/recovery-telemetry.js')).recoveryTimelineSnapshot();
   const manual=timeline.find(event=>event.type==='health'&&event.manualRetry===true);
   const fresh=timeline.findLast(event=>event.type==='recovery_started'&&event.episodeId!==episodeId);
   return {manual,fresh};
  },terminal.episodeId);
  expect(retried.manual).toBeTruthy();expect(retried.fresh?.episodeId).toBeTruthy();expect(retried.fresh.episodeId).not.toBe(terminal.episodeId);
  expect(socketCount).toBeGreaterThan(stopped.socketCount);
  releaseOld();expect(['delivered','retired']).toContain(await oldSettled);
  await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toBeVisible();
  await expect(page.locator('[data-board-preview-action]:enabled')).toHaveCount(0);
  expect(await page.evaluate(async episodeId=>{
   const timeline=(await import('/shell/recovery-telemetry.js')).recoveryTimelineSnapshot();
   const latestStart=timeline.findLast(event=>event.type==='recovery_started');
   return {
    latestEpisodeId:latestStart?.episodeId,
    completed:timeline.some(event=>event.type==='recovery_completed'&&event.episodeId===episodeId),
    terminal:timeline.some(event=>event.type==='recovery_blocked'&&event.episodeId===episodeId&&event.terminalFailure===true)
   };
  },retried.fresh.episodeId)).toEqual({latestEpisodeId:retried.fresh.episodeId,completed:false,terminal:false});
  phase='idle';releaseFresh();await page.clock.resume();
  await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0,{timeout:15_000});
  await expect(page.locator('[data-board-preview-action="pass"]')).toBeEnabled();
  const ready=await page.evaluate(async episodeId=>{
   const timeline=(await import('/shell/recovery-telemetry.js')).recoveryTimelineSnapshot();
   return timeline.findLast(event=>event.type==='readiness'&&event.gate==='ready'&&event.episodeId===episodeId);
  },retried.fresh.episodeId);
  expect(ready?.socketGeneration).toBeGreaterThan(1);
 }finally{
  phase='idle';releaseOld();releaseFresh();await page.clock.resume();await page.unrouteAll({behavior:'ignoreErrors'});
 }
});
