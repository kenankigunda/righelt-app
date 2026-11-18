import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const open=async page=>{
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.route('**/native-history-retarget-proof',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main id="probe" style="width:300px;height:100px"></main></body></html>'}));
 await page.goto('/native-history-retarget-proof');
};
for(const easing of ['linear','ease-out'])test(`native History retarget preserves rendered height across a frame gap (${easing})`,async({page},info)=>{
 await open(page);const observed=await page.evaluate(async easing=>{
  const {createHistorySelectionTransition}=await import('/apps/web/shell/history-selection-transition.js');
  const element=document.getElementById('probe'),owner=createHistorySelectionTransition({easing,readScroll:()=>({x:0,y:0}),restoreScroll(){}});
  try{
   const first=owner.begin('move:first'),captured=owner.capture(element);element.style.height='240px';owner.present(captured);
   const animation=element.getAnimations()[0];animation.pause();animation.currentTime=90;
   const renderedBefore=element.getBoundingClientRect().height,firstWait=owner.waitForSettled(first);
   const second=owner.begin('turn:second');const firstSettled=await firstWait;
   await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
   const heldHeight=element.getBoundingClientRect().height;
   const third=owner.begin('move:third'),staleFinish=owner.finish(second);
   const next=owner.capture(element);element.style.height='80px';owner.present(next);
   const nextAnimation=element.getAnimations()[0];nextAnimation.pause();nextAnimation.currentTime=0;
   const newStart=element.getBoundingClientRect().height;nextAnimation.finish();await owner.waitForSettled(third);
   owner.finish(third);return{renderedBefore,heldHeight,capturedFrom:next.heights[0],newStart,firstSettled,staleFinish,finalHeight:element.getBoundingClientRect().height,clipped:element.classList.contains('history-selection-transitioning')};
  }finally{owner.cancel();}
 },easing);
 writeFileSync(info.outputPath('observed.json'),JSON.stringify(observed,null,2));
 expect(observed.renderedBefore).toBeGreaterThan(100);expect(observed.renderedBefore).toBeLessThan(240);
 for(const key of ['heldHeight','capturedFrom','newStart'])expect(Math.abs(observed[key]-observed.renderedBefore),key).toBeLessThanOrEqual(1);
 expect(observed.firstSettled).toBe(false);expect(observed.staleFinish).toBe(false);expect(observed.finalHeight).toBe(80);expect(observed.clipped).toBe(false);
});

test('failed native History replacement releases deferred motion without stale reveal',async({page})=>{
 await open(page);const observed=await page.evaluate(async()=>{
  const {createHistorySelectionTransition}=await import('/apps/web/shell/history-selection-transition.js');
  const element=document.getElementById('probe'),owner=createHistorySelectionTransition();let reveals=0;
  try{
   const first=owner.begin('first'),captured=owner.capture(element);element.style.height='240px';owner.present(captured,()=>{reveals++;});
   const animation=element.getAnimations()[0];animation.pause();animation.currentTime=90;
   let error;try{await owner.run('failed',()=>{throw Error('selection unavailable');});}catch(e){error=e.message;}
   return{error,playState:animation.playState,clipped:element.classList.contains('history-selection-transitioning'),height:element.getBoundingClientRect().height,reveals};
  }finally{owner.cancel();}
 });
 expect(observed).toEqual({error:'selection unavailable',playState:'idle',clipped:false,height:240,reveals:0});
});
