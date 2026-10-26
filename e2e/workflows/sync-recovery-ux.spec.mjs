import {mkdir,writeFile} from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { runScopedAxeScan } from "../support/ux.mjs";
import { createGameFromHome, makeAnyLegalMove, submitPlayableAction, selectPlayableAction, switchGamePanel } from "../support/app.mjs";
import {isOperationRequest,operationValues} from '../support/shared-request.mjs';

for (const width of [933, 932, 901, 900, 899, 390]) test(`recovery overlay and storage gate at ${width}px`, async ({page},info) => {
 const metrics={requests:0,snapshots:0,applicationPayloadBytes:0};
 page.on('request',request=>{if(request.url().includes('/api/shell/'))metrics.requests++;});
 page.on('response',async response=>{if(!response.url().includes('/api/shell/'))return;try{const body=await response.body();metrics.applicationPayloadBytes+=body.length;if(JSON.parse(body)?.game)metrics.snapshots++;}catch{}});
 page.on('websocket',socket=>socket.on('framereceived',({payload})=>{metrics.applicationPayloadBytes+=Buffer.byteLength(payload);try{if(JSON.parse(payload)?.game)metrics.snapshots++;}catch{}}));
 await page.setViewportSize({width,height:1000});
 await page.emulateMedia({reducedMotion:"reduce"});
 const {gameId}=await createGameFromHome(page);
 await switchGamePanel(page,"players");
 await page.getByRole("button",{name:"Play both sides",exact:true}).click();
 await expect(page.getByRole("button",{name:"Play both sides",exact:true})).toHaveCount(0);
 await switchGamePanel(page,"board");
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 await makeAnyLegalMove(page);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 const geometry=()=>page.locator('[data-testid="game-board"]').evaluate(el=>{const b=el.getBoundingClientRect();return {x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height};});
 let before;
 metrics.requests=0;metrics.snapshots=0;metrics.applicationPayloadBytes=0;
 await page.evaluate(()=>{
   window.savedIDBAdd=IDBObjectStore.prototype.add;
   IDBObjectStore.prototype.add=function(){throw new DOMException("Test quota", "QuotaExceededError");};
   window.announcements=[];
   window.announcementNode=document.getElementById("shell-sync-announcement");
   new MutationObserver(()=>window.announcements.push(window.announcementNode.textContent)).observe(window.announcementNode,{childList:true,subtree:true,characterData:true});
 });
 // Choose a legal action through the real board without waiting for rejected optimistic publication.
 const {action,revisionBeforeRejectedMove}=await page.evaluate(async gameId=>{
   const identityId=localStorage.getItem("righelt.identity.id.v1");
   const body=await (await fetch(`/api/shell/games/${gameId}?identityId=${identityId}`)).json();
   return {action:body.game.legalActions.find(a=>a.from&&a.to),revisionBeforeRejectedMove:body.game.gameplayRevision};
 },gameId);
 expect(action).toBeTruthy();
 const to=await selectPlayableAction(page,action);
 before=await geometry();await to.click();
 const banner=page.getByTestId("sync-recovery-banner");
 await expect(banner).toContainText("We couldn’t save your move. Please try again.");
 expect((await runScopedAxeScan({page,include:'[data-testid="sync-recovery-banner"]'})).violations).toEqual([]);
 expect(await banner.evaluate(el=>getComputedStyle(el).animationName)).toBe("none");
 await page.getByRole("button",{name:"Retry saving"}).evaluate(el=>el.focus({preventScroll:true}));
 const focusBefore=await page.evaluate(()=>({active:document.activeElement.textContent,scroll:window.scrollY}));
 await page.waitForTimeout(5500); // A real acknowledged heartbeat must not rebuild or reannounce this notice.
 expect(await page.evaluate(()=>({active:document.activeElement.textContent,scroll:window.scrollY}))).toEqual(focusBefore);
 const after=await geometry();expect(Math.abs(after.y-before.y)).toBeLessThanOrEqual(1);expect(Math.abs(after.x-before.x)).toBeLessThanOrEqual(1);
 const box=await banner.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
 if(width===390){
  const caret=banner.getByRole("button",{name:"Diagnostic details"});
  expect(await caret.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  const hit=await caret.boundingBox();expect(hit.width).toBeGreaterThanOrEqual(44);expect(hit.height).toBeGreaterThanOrEqual(44);
  await caret.click();await expect(caret).toHaveAttribute("aria-expanded","true");
  await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw Error("Unavailable")}}}));
  await banner.getByRole("button",{name:"Copy",exact:true}).click();
  await expect(banner).toContainText("Copy the details below");
  await expect(banner.locator("pre")).toContainText('"schemaVersion"');
  const details=await banner.locator(".issue-details").boundingBox();const expanded=await banner.boundingBox();
  expect(details.y+details.height).toBeLessThanOrEqual(expanded.y+expanded.height+1);
  await page.mouse.move(0,0);
  await page.screenshot({path:info.outputPath("diagnostics-mobile.png")});
  await caret.click();await expect(caret).toHaveAttribute("aria-expanded","false");
 }
 const placement=await page.locator('[data-shell-alert-zone]').evaluate(el=>getComputedStyle(el).position);
 await expect(page.locator("#app")).toHaveAttribute("data-shell-layout-mode",width<933?"narrow":"wide");
 expect(placement).toBe(width<933?"fixed":"absolute");
 await page.getByRole("button",{name:"Dismiss",exact:true}).click();
 await expect(page.getByRole("button",{name:"Retry saving"})).toBeVisible();
 await expect(page.getByTestId("sync-recovery-banner")).toContainText("Saving is paused.");
 // Dismissal leaves the shared controls gated, including synthetic keyboard/click paths.
 const gated=page.locator('[data-action="undo-last-move"]');
 if(await gated.count()) await expect(gated).toBeDisabled();
 const restoredAt=Date.now();
 await page.evaluate(()=>{IDBObjectStore.prototype.add=window.savedIDBAdd;});
 await page.getByRole("button",{name:"Retry saving"}).click();
 await expect(banner).toHaveCount(0);
 expect(await page.evaluate(()=>document.getElementById("shell-sync-announcement")===window.announcementNode)).toBe(true);
 const announcements=await page.evaluate(()=>window.announcements.filter(Boolean));
 expect(announcements.filter(x=>x.includes("We couldn’t save your move")).length).toBe(1);
 if(await gated.count()) await expect(gated).toBeEnabled();
 // The next helper chooses from the server's legal actions. Wait for the retried
 // original move to reach that authority instead of reading its old position
 // while the healthy client already displays the optimistic next position.
 await expect.poll(()=>page.evaluate(async({gameId})=>{
  const identityId=localStorage.getItem("righelt.identity.id.v1");
  const {game}=await (await fetch(`/api/shell/games/${gameId}?identityId=${identityId}`)).json();
  return {revision:game.gameplayRevision,action:game.moves.at(-1)?.action};
 },{gameId})).toEqual({revision:revisionBeforeRejectedMove+1,action});
 await makeAnyLegalMove(page);
 const result={fault:`storage-${width}px`,restoredAt:new Date(restoredAt).toISOString(),convergenceMs:Date.now()-restoredAt,...metrics};
 expect(result.convergenceMs).toBeLessThanOrEqual(25000);
 await mkdir('test-results/sync-recovery',{recursive:true});
 await writeFile(`test-results/sync-recovery/${info.project.name}-storage-${width}.json`,JSON.stringify(result,null,2));
 await info.attach('storage-recovery',{body:JSON.stringify(result),contentType:'application/json'});
});

test("pending feedback reaches overdue once, then clears or explains definitive conflict", async ({page}) => {
 await page.setViewportSize({width:1440,height:1100});
 const {gameId}=await createGameFromHome(page);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 let mode="hold", unknownResponses=0;
 // A transport failure must show its error immediately. To exercise genuinely
 // pending work instead, return valid unknown receipts without applying it.
 await page.route(`**/api/shell/games/${gameId}/**`,async route=>{
  if(!isOperationRequest(route.request(),'apply')&&!isOperationRequest(route.request(),'reconcile')){await route.continue();return;}
  if(mode==="accept"){await route.continue();return;}
  const payload=route.request().postDataJSON();
  const commands=operationValues(route.request()).commands??[payload];
  const response=await page.request.get(`/api/shell/games/${gameId}?identityId=${payload.identityId}`);
  const current=await response.json();
  if(mode==="hold")unknownResponses++;
  await route.fulfill({json:{...current,protocolVersion:2,gameId,gameplayRevision:current.game.gameplayRevision,
   commandOutcomes:commands.map(command=>({gameId,identityId:command.identityId,clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,
    outcome:mode==="hold"?"unknown":"rejected",reason:mode==="hold"?null:"stale_state",eventSeq:current.eventSeq,gameplayRevision:current.game.gameplayRevision}))}});
 });
 const action=await page.evaluate(async gameId=>{
   const identityId=localStorage.getItem("righelt.identity.id.v1");
   const body=await (await fetch(`/api/shell/games/${gameId}?identityId=${identityId}`)).json();
   return body.game.legalActions.find(a=>a.from&&a.to);
 },gameId);
 await submitPlayableAction(page,action);
 await expect(page.getByTestId("sync-recovery-banner")).toContainText("Recording your move");
 await expect(page.getByTestId("sync-recovery-banner").getByRole("button",{name:"Reload game",exact:true})).toHaveCount(0);
 await expect(page.getByTestId("sync-recovery-banner")).toContainText("Still checking your move. You can retry or view details.",{timeout:20000});
 await expect(page.getByTestId("sync-recovery-banner").getByRole("button",{name:"Reload game",exact:true})).toBeVisible();
 expect(unknownResponses).toBeGreaterThan(0);
 const board=await page.getByTestId("game-board").innerHTML();
 mode="reject";
 await expect(page.getByTestId("sync-failure-banner")).toContainText("Board changed before your move was recorded. Check it and try again.",{timeout:10000});
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 await expect(page.locator("#shell-sync-announcement")).toContainText("Board changed before your move");
 expect(await page.getByTestId("game-board").innerHTML()).not.toBe(board);
 await page.getByRole("button",{name:"Dismiss",exact:true}).click();
 mode="accept";
 await makeAnyLegalMove(page);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
});

test('healthy optimistic confirmation adds no recovery announcement',async({page})=>{
 const {gameId}=await createGameFromHome(page);
 await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
 await page.evaluate(()=>{
  window.healthyAnnouncements=[];
  const node=document.getElementById('shell-sync-announcement');
  new MutationObserver(()=>window.healthyAnnouncements.push(node.textContent)).observe(node,{subtree:true,childList:true,characterData:true});
 });
 let completed,failed;
 const applied=new Promise((resolve,reject)=>{completed=resolve;failed=reject;});
 void applied.catch(()=>{});
 await page.route(`**/api/shell/games/${gameId}/**`,async route=>{
  if(!isOperationRequest(route.request(),'apply')){await route.continue();return;}
  try {
   const response=await route.fetch();await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({response});
   completed();
  } catch(error) {failed(error);}
 });
 try {
  await makeAnyLegalMove(page);
  // A socket receipt may confirm first. Keep the fixture alive until the
  // delayed HTTP reply also completes, then inspect the entire observation.
  await applied;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
  expect(await page.evaluate(()=>window.healthyAnnouncements.filter(Boolean))).toEqual([]);
 } finally {await page.unrouteAll({behavior:'wait'});}
});
