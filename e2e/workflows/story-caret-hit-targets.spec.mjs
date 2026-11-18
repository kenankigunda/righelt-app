import {test,expect} from '@playwright/test';
import {waitForOverlayEntry} from '../support/overlay-motion.mjs';

// Hit testing and clipping are native browser contracts. The actual Home route,
// story renderer, stylesheet and animation controller run unchanged here.
test('story carets remain usable through draw-back, slide and reversal',async({page},info)=>{
 test.setTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const settle=async dialog=>expect.poll(()=>dialog.locator('[data-story-image]').evaluateAll(ns=>ns.flatMap(n=>n.getAnimations()).length)).toBe(0);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:900});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/');await page.locator('button[data-opponent="babs"]').click();
  const dialog=page.getByRole('dialog',{name:'Babs',exact:true});await waitForOverlayEntry(dialog);
  // Visit lazy images through normal controls before checking motion geometry.
  for(const index of [2,1,0]){await dialog.getByRole('button',{name:'Previous story image',exact:true}).click();await expect(dialog.locator('[data-story-image]').nth(index)).toHaveAttribute('data-active','true');await settle(dialog);}
  await expect.poll(()=>dialog.locator('[data-story-image]').evaluateAll(ns=>ns.every(n=>n.complete&&n.naturalWidth>0))).toBe(true);
  for(const [step,index,outgoing] of [[1,1,0],[-1,0,1]]){
   if(step<0){await dialog.getByRole('button',{name:'Next story image',exact:true}).click();await settle(dialog);}
   const before=await dialog.evaluate(el=>[...el.querySelectorAll('.story-copy,[data-story-step],.story-modal-actions')].map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
   // Hold real WAAPI animations at contract boundaries, without replacing frames.
   await dialog.evaluate((el,step)=>{el.querySelector('[data-story-step="'+step+'"]').click();for(const n of el.querySelectorAll('[data-story-image]'))for(const a of n.getAnimations())a.pause();},step);
   await expect(dialog.locator('[data-story-image]').nth(index)).toHaveAttribute('data-active','true');
   for(const time of [0,76,152,380,684]){
    const sample=await dialog.evaluate(async(el,time)=>{
     const animations=[...el.querySelectorAll('[data-story-image]')].flatMap(n=>n.getAnimations());await Promise.all(animations.map(a=>a.ready));for(const a of animations)a.currentTime=time;
     const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
     return {count:animations.length,art:rect(el.querySelector('.story-art')),modal:rect(el),content:(()=>{const n=el.querySelector('.modal-content'),r=n.getBoundingClientRect(),left=r.left+n.clientLeft;return {left,right:left+n.clientWidth};})(),images:[...el.querySelectorAll('[data-story-image]')].map(rect),fixed:[...el.querySelectorAll('.story-copy,[data-story-step],.story-modal-actions')].map(rect),carets:[...el.querySelectorAll('[data-story-step]')].map(n=>{const r=rect(n);return {...r,hits:[[.5,.5],[.02,.5],[.98,.5],[.5,.02],[.5,.98]].map(([x,y])=>n.contains(document.elementFromPoint(r.left+r.width*x,r.top+r.height*y)))};})};
    },time);
    expect(sample.count).toBe(2);
    for(const c of sample.carets){expect(c.width).toBeGreaterThanOrEqual(44);expect(c.height).toBeGreaterThanOrEqual(44);expect(c.left).toBeGreaterThanOrEqual(sample.content.left-.5);expect(c.right).toBeLessThanOrEqual(sample.content.right+.5);expect(c.hits,`native caret hits at ${width}px, step ${step}, ${time}ms`).toEqual([true,true,true,true,true]);}
    for(let i=0;i<before.length;i++)for(const k of ['x','y','width','height'])expect(sample.fixed[i][k]).toBeCloseTo(before[i][k],0);
    const image=sample.images[outgoing];expect(image.width).toBeCloseTo(sample.art.width,1);expect(image.height).toBeCloseTo(sample.art.height,1);
    if(time<=152){expect(image.left).toBeGreaterThanOrEqual(sample.art.left-sample.art.width*.08-1);expect(image.right).toBeLessThanOrEqual(sample.art.right+sample.art.width*.08+1);expect(image.left).toBeGreaterThanOrEqual(sample.modal.left-1);expect(image.right).toBeLessThanOrEqual(sample.modal.right+1);}
    if(time===152)await dialog.screenshot({path:info.outputPath(`story-drawback-${width}-${step}.png`)});
   }
   // A real pointer at the target edge must reverse the in-flight transition.
   const opposite=dialog.locator('[data-story-step="'+(-step)+'"]');const box=await opposite.boundingBox();await page.mouse.click(box.x+box.width*.1,box.y+box.height*.1);
   await expect(dialog.locator('[data-story-image]').nth(outgoing)).toHaveAttribute('data-active','true');await settle(dialog);
  }
  // Preference changes retire an in-flight effect; subsequent selection is instant.
  await dialog.evaluate(el=>el.querySelector('[data-story-step="1"]').click());
  await page.emulateMedia({reducedMotion:'reduce'});await settle(dialog);
  await dialog.getByRole('button',{name:'Previous story image',exact:true}).click();await settle(dialog);
  await dialog.getByRole('button',{name:'Close opponent story',exact:true}).click();await expect(dialog).toBeHidden();
 }
 expect(errors).toEqual([]);
});
