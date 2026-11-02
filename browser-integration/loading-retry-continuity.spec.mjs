import {test,expect} from '@playwright/test';

test('same pending loading key keeps its mounted cue and animation through a fresh skeleton patch',async({page},info)=>{
 await page.goto('/browser-integration/support/loading.html');
 await page.waitForFunction(()=>window.fixtureReady);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{
  const region=document.querySelector('#region');
  region.dataset.loadingState='pending';region.setAttribute('aria-busy','true');
  // Capture the renderer's static pending markup before its observer adds
  // presentation-owned children. A retry renders this same pending operation.
  window.retryFreshSkeleton=region.cloneNode(true);
 });
 const region=page.locator('#region');
 await expect(region).toHaveAttribute('data-loading-phase','visible');
 await expect(region.locator(':scope > .loading-pieces')).toBeVisible();
 await expect.poll(()=>region.evaluate(node=>{const clock=node.querySelector(':scope > .loading-pieces i')?.getAnimations()[0];return {playState:clock?.playState,pending:clock?.pending,hasTime:clock?.currentTime!==null&&clock?.currentTime!==undefined};})).toEqual({playState:'running',pending:false,hasTime:true});
 const before=await region.evaluate(node=>{
  const cue=node.querySelector(':scope > .loading-pieces');
  const clock=cue.querySelector('i').getAnimations()[0];
  window.retryLoadingIdentity={node,cue,clock,key:node.dataset.loadingKey};
  return {key:node.dataset.loadingKey,hasAnimation:Boolean(clock),playState:clock?.playState,pending:clock?.pending,time:clock?.currentTime};
 });
 expect(before.hasAnimation).toBe(true);expect(before.playState).toBe('running');expect(before.pending).toBe(false);expect(before.time).not.toBeNull();
 await page.evaluate(async()=>{
  const {patchSectionContent}=await import('/apps/web/shell/dom-patch.js');
  patchSectionContent(document.querySelector('#region'),window.retryFreshSkeleton);
 });
 // Let the actual loading observer reconcile the patched DOM; no animation
 // substitution, clock override or synthetic user event participates.
 await expect(region).toHaveAttribute('data-loading-phase','visible');
 const after=await region.evaluate(node=>{
  const old=window.retryLoadingIdentity,cue=node.querySelector(':scope > .loading-pieces');
  return {sameRegion:node===old.node,sameKey:node.dataset.loadingKey===old.key,
   sameCue:cue===old.cue,sameAnimation:cue?.querySelector('i').getAnimations()[0]===old.clock,
   oldClockTime:old.clock.currentTime,currentTime:cue?.querySelector('i').getAnimations()[0]?.currentTime};
 });
 await info.attach('same-key-loading-retry',{body:JSON.stringify({before,after}),contentType:'application/json'});
 expect(after.sameRegion).toBe(true);expect(after.sameKey).toBe(true);
 expect(after.sameCue).toBe(true);expect(after.sameAnimation).toBe(true);
 expect(after.oldClockTime).not.toBeNull();
 await page.evaluate(()=>{document.querySelector('#region').dataset.loadingState='idle';});
 await expect(region.locator(':scope > .loading-pieces')).toHaveCount(0);
});

for (const change of ['idle','different-key','static-content']) test(`loading cue retention respects ${change}`,async({page},info)=>{
 await page.goto('/browser-integration/support/loading.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(()=>{const region=document.querySelector('#region');region.dataset.loadingState='pending';region.setAttribute('aria-busy','true');window.retryFreshSkeleton=region.cloneNode(true);});
 const region=page.locator('#region');await expect(region).toHaveAttribute('data-loading-phase','visible');
 await expect(region.locator(':scope > .loading-pieces')).toBeVisible();
 const result=await page.evaluate(async change=>{
  const {patchSectionContent}=await import('/apps/web/shell/dom-patch.js');
  const node=document.querySelector('#region'),cue=node.querySelector(':scope > .loading-pieces'),fresh=window.retryFreshSkeleton;
  if(change==='idle'){fresh.dataset.loadingState='idle';fresh.removeAttribute('aria-busy');}
  if(change==='different-key')fresh.dataset.loadingKey='different-operation';
  if(change==='static-content'){fresh.querySelector('h2').textContent='Updated board';fresh.setAttribute('data-static-update','yes');}
  patchSectionContent(node,fresh);
  return {oldCueConnected:cue.isConnected,sameCue:node.querySelector(':scope > .loading-pieces')===cue,key:node.dataset.loadingKey,state:node.dataset.loadingState,heading:node.querySelector('h2').textContent,staticUpdate:node.getAttribute('data-static-update')};
 },change);
 await info.attach('loading-retention-boundary',{body:JSON.stringify({change,result}),contentType:'application/json'});
 if(change==='static-content'){expect(result.sameCue).toBe(true);expect(result.heading).toBe('Updated board');expect(result.staticUpdate).toBe('yes');}
 else {expect(result.oldCueConnected).toBe(false);expect(result.sameCue).toBe(false);}
 if(change==='idle')await expect(region.locator(':scope > .loading-pieces')).toHaveCount(0);
 if(change==='different-key')await expect(region).toHaveAttribute('data-loading-key','different-operation');
});
