import { test, expect } from "@playwright/test";
import { runScopedAxeScan } from "../support/ux.mjs";
import { createGameFromHome, makeAnyLegalMove } from "../support/app.mjs";

for (const width of [901, 900, 899, 390]) test(`recovery overlay and storage gate at ${width}px`, async ({page}) => {
 await page.setViewportSize({width,height:1000});
 await page.emulateMedia({reducedMotion:"reduce"});
 const {gameId}=await createGameFromHome(page);
 await page.getByRole("button",{name:"Play as both players",exact:true}).dispatchEvent("click");
 await expect(page.getByRole("button",{name:"Play as both players",exact:true})).toHaveCount(0);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 await makeAnyLegalMove(page);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 const geometry=()=>page.locator('[data-testid="game-board"]').evaluate(el=>{const b=el.getBoundingClientRect();return {x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height};});
 let before;
 await page.evaluate(()=>{
   window.savedIDBAdd=IDBObjectStore.prototype.add;
   IDBObjectStore.prototype.add=function(){throw new DOMException("Test quota", "QuotaExceededError");};
   window.announcements=[];
   window.announcementNode=document.getElementById("shell-sync-announcement");
   new MutationObserver(()=>window.announcements.push(window.announcementNode.textContent)).observe(window.announcementNode,{childList:true,subtree:true,characterData:true});
 });
 // Choose a legal action through the real board without waiting for rejected optimistic publication.
 const action=await page.evaluate(async gameId=>{
   const identityId=localStorage.getItem("righelt.identity.id.v1");
   const body=await (await fetch(`/api/shell/games/${gameId}?identityId=${identityId}`)).json();
   return body.game.legalActions.find(a=>a.from&&a.to);
 },gameId);
 expect(action).toBeTruthy();
 const from=page.locator(`.cell[data-row="${action.from.row}"][data-col="${action.from.col}"]`).first();
 const to=page.locator(`.cell[data-row="${action.to.row}"][data-col="${action.to.col}"]`).first();
 await from.click();await to.hover();before=await geometry();await to.click();
 const banner=page.getByTestId("sync-recovery-banner");
 await expect(banner).toContainText("Your browser couldn't save this move. It wasn't sent.");
 expect((await runScopedAxeScan({page,include:'[data-testid="sync-recovery-banner"]'})).violations).toEqual([]);
 expect(await banner.evaluate(el=>getComputedStyle(el).animationName)).toBe("none");
 await page.getByRole("button",{name:"Retry saving"}).evaluate(el=>el.focus({preventScroll:true}));
 const focusBefore=await page.evaluate(()=>({active:document.activeElement.textContent,scroll:window.scrollY}));
 await page.waitForTimeout(5500); // A real acknowledged heartbeat must not rebuild or reannounce this notice.
 expect(await page.evaluate(()=>({active:document.activeElement.textContent,scroll:window.scrollY}))).toEqual(focusBefore);
 const after=await geometry();expect(Math.abs(after.y-before.y)).toBeLessThanOrEqual(1);expect(Math.abs(after.x-before.x)).toBeLessThanOrEqual(1);
 const box=await banner.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
 const placement=await page.locator('[data-shell-alert-zone]').evaluate(el=>getComputedStyle(el).position);
 expect(placement).toBe(width<=900?"fixed":"absolute");
 await page.getByRole("button",{name:"Dismiss",exact:true}).click();
 await expect(page.getByRole("button",{name:"Retry saving"})).toBeVisible();
 await expect(page.getByTestId("sync-recovery-banner")).toContainText("Saving is paused.");
 // Dismissal leaves the shared controls gated, including synthetic keyboard/click paths.
 const gated=page.locator('[data-action="undo-last-move"]');
 if(await gated.count()) await expect(gated).toBeDisabled();
 await page.evaluate(()=>{IDBObjectStore.prototype.add=window.savedIDBAdd;});
 await page.getByRole("button",{name:"Retry saving"}).click();
 await expect(banner).toHaveCount(0);
 expect(await page.evaluate(()=>document.getElementById("shell-sync-announcement")===window.announcementNode)).toBe(true);
 const announcements=await page.evaluate(()=>window.announcements.filter(Boolean));
 expect(announcements.filter(x=>x.includes("couldn't save this move")).length).toBe(1);
 if(await gated.count()) await expect(gated).toBeEnabled();
 await makeAnyLegalMove(page);
});

test("pending feedback reaches overdue once, then clears or explains definitive conflict", async ({page}) => {
 await page.setViewportSize({width:1440,height:1100});
 const {gameId}=await createGameFromHome(page);
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 let mode="hold";
 await page.route(`**/api/shell/games/${gameId}/apply`,async route=>{
  if(mode==="hold"){await route.abort();return;}
  if(mode==="accept"){await route.continue();return;}
  const command=route.request().postDataJSON();
  const response=await page.request.get(`/api/shell/games/${gameId}?identityId=${command.identityId}`);
  const current=await response.json();
  await route.fulfill({json:{...current,protocolVersion:2,gameId,gameplayRevision:current.game.gameplayRevision,
   commandOutcomes:[{gameId,identityId:command.identityId,clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,
    outcome:"rejected",reason:"stale_state",eventSeq:current.eventSeq,gameplayRevision:current.game.gameplayRevision}]}});
 });
 const action=await page.evaluate(async gameId=>{
   const identityId=localStorage.getItem("righelt.identity.id.v1");
   const body=await (await fetch(`/api/shell/games/${gameId}?identityId=${identityId}`)).json();
   return body.game.legalActions.find(a=>a.from&&a.to);
 },gameId);
 const source=page.locator(`.cell[data-row="${action.from.row}"][data-col="${action.from.col}"]`).first();
 const target=page.locator(`.cell[data-row="${action.to.row}"][data-col="${action.to.col}"]`).first();
 await source.click();await target.hover();await target.click();
 await expect(page.getByTestId("sync-recovery-banner")).toContainText("Checking your move…");
 await expect(page.getByTestId("sync-recovery-banner")).toContainText("Your move is still being checked.",{timeout:20000});
 const board=await page.getByTestId("game-board").innerHTML();
 mode="reject";
 await expect(page.getByTestId("sync-failure-banner")).toContainText("The game changed before your move could be completed. Check the board and try again.",{timeout:10000});
 await expect(page.getByTestId("sync-recovery-banner")).toHaveCount(0);
 await expect(page.locator("#shell-sync-announcement")).toContainText("The game changed before your move");
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
 await page.route(`**/api/shell/games/${gameId}/apply`,async route=>{
  const response=await route.fetch();await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({response});
 });
 await makeAnyLegalMove(page);
 await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
 expect(await page.evaluate(()=>window.healthyAnnouncements.filter(Boolean))).toEqual([]);
});
