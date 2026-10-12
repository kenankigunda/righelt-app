import {test,expect} from '@playwright/test';

for(const reduced of [false,true]) test(`story motion follows its source card with reduced motion ${reduced}`,async({page})=>{
 await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
 await page.addInitScript(()=>{
  window.overlayMotions=[];
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(frames,options){
   if(this.matches('.opponent-story-modal') && Array.isArray(frames) && frames.some(frame=>frame.transform?.includes('scale('))) window.overlayMotions.push({exit:this.classList.contains('overlay-exit-copy'),frames,surface:this.getBoundingClientRect().toJSON(),source:document.querySelector('button[data-opponent="babs"]').getBoundingClientRect().toJSON()});
   return animate.call(this,frames,options);
  };
 });
 const homeLoaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games' && response.ok());
 await page.goto('/');await (await homeLoaded).finished();
 const source=page.locator('button[data-opponent="babs"]');await source.click();
 const dialog=page.getByRole('dialog',{name:'Babs',exact:true});await expect(dialog).toBeVisible();
 await expect.poll(()=>dialog.evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 await dialog.getByRole('button',{name:'Close opponent story'}).click();await expect(dialog).not.toBeVisible();await expect(source).toBeFocused();
 const motions=await page.evaluate(()=>window.overlayMotions);
 if(reduced)expect(motions).toEqual([]);
 else {
  expect(motions).toHaveLength(2);expect(motions[0].exit).toBe(false);expect(motions[1].exit).toBe(true);
  for(const motion of motions){
   const small=motion.frames[motion.exit?1:0],full=motion.frames[motion.exit?0:1];
   expect(full).toEqual({transform:'translate(0px, 0px) scale(1)',opacity:1});expect(small.opacity).toBe(0);
   const [x,y,scale]=small.transform.match(/-?[\d.]+/g).map(Number);
   expect(x+motion.surface.left+motion.surface.width/2).toBeCloseTo(motion.source.left+motion.source.width/2,1);
   expect(y+motion.surface.top+motion.surface.height/2).toBeCloseTo(motion.source.top+motion.source.height/2,1);
   expect(scale).toBeLessThan(1);expect(scale).toBeGreaterThan(0);
  }
 }
 await expect(page.locator('.overlay-exit-copy')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.style.overflow)).not.toBe('hidden');
});
