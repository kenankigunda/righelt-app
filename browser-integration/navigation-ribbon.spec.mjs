import {test,expect} from '@playwright/test';

for(const width of [390,1440])test(`Dense ribbon mirrors its edges and facets at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.goto('/browser-integration/support/navigation-ribbon.html');await page.waitForFunction(()=>window.fixtureReady);
 const layer=page.locator('.shell-route-transition-layer'),frames=[];
 for(const direction of ['forward','back']){
  const metrics=await layer.evaluate(async(node,direction)=>{
   // Start and capture the actual finite animation in one browser task.
   node.dataset.phase='idle';node.dataset.direction=direction;void node.offsetWidth;
   node.dataset.phase='covering';
   const motion=node.getAnimations({subtree:true}).filter(animation=>animation.animationName==='shell-game-entry-swipe-in');
   if(motion.length!==1)throw Error('Actual finite Dense ribbon animation missing');
   motion[0].pause();motion[0].currentTime=60;await motion[0].ready;
   const timing=motion[0].effect.getComputedTiming();
   if(timing.duration!==160||timing.endTime!==160||timing.iterations!==1||motion[0].playState!=='paused'||motion[0].currentTime!==60)throw Error('Dense ribbon checkpoint is not the paused original160ms animation');
   const swipe=node.querySelector('.shell-route-transition-layer-swipe'),style=getComputedStyle(swipe);
   const bounds=swipe.getBoundingClientRect();
   return {left:bounds.left,right:bounds.right,opacity:style.opacity,scale:style.scale,clip:style.clipPath,facet:getComputedStyle(swipe,'::after').clipPath,duration:style.animationDuration};
  },direction);
  frames.push(metrics);
  expect(metrics.opacity).toBe('0.94');expect(metrics.duration).toBe('0.16s');
  expect(metrics.scale).toBe(direction==='back'?'-1 1':'none');
  expect(metrics.clip).toBe('polygon(9% 0px, 100% 0px, 91% 100%, 0px 100%)');
  expect(metrics.facet).toBe('polygon(75% 0px, 100% 0px, 100% 100%, 50% 100%)');
  await page.screenshot({path:info.outputPath(`dense-ribbon-${direction}-${width}.png`)});
 }
 // Percentage layout may round the two bounds differently by a fraction of a pixel.
 expect(Math.abs(frames[0].left+frames[1].right-width),'The back ribbon must mirror around the viewport center').toBeLessThanOrEqual(.5);
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(layer).toBeHidden();
 expect(await layer.evaluate(node=>node.getAnimations({subtree:true}).length)).toBe(0);
});
