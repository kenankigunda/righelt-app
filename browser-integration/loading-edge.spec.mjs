import {writeFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';
const ready=async page=>{await page.goto('/browser-integration/support/loading-edge.html');await page.waitForFunction(()=>window.edgeReady);await expect(page.locator('.loading-edge-frame')).toHaveCount(1);};
test('edge cut protects real labels, axes, controls and grid at every board format',async({page},info)=>{
 for(const [width,scale] of [[320,100],[320,200],[390,200],[768,100],[932,100],[933,100],[944,200],[1440,100]]){
  await page.setViewportSize({width,height:800});await ready(page);
  const rect=()=>page.locator('[data-shell-panel="board"]').evaluate(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
  await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,scale);await page.evaluate(()=>{document.fonts.dispatchEvent(new Event('loadingdone'));return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const before=await rect();await expect(page.locator('.axis-label')).not.toHaveCount(0);
  expect(await page.locator('.axis-label').evaluateAll(nodes=>nodes.every(node=>{const b=node.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth;}))).toBe(true);
  const geometry=await page.locator('.loading-edge-frame').evaluate(svg=>{
   const s=svg.getBoundingClientRect(),cuts=[...svg.querySelectorAll('mask rect')].slice(1).map(node=>Object.fromEntries(['x','y','width','height'].map(key=>[key,Number(node.getAttribute(key))])));
   return {width:document.documentElement.scrollWidth,pointer:getComputedStyle(svg.parentElement).pointerEvents,inert:svg.parentElement.inert,
    protected:[...document.querySelectorAll('h2,p,button,.board,.axis-label,.overlay-key')].filter(node=>!node.closest('[inert]')&&node.getClientRects().length).map(node=>{const b=node.getBoundingClientRect();return cuts.some(c=>c.x<=b.left-s.left-1.9&&c.y<=b.top-s.top-1.9&&c.x+c.width>=b.right-s.left+1.9&&c.y+c.height>=b.bottom-s.top+1.9);}),
    colors:[...svg.querySelectorAll('g polygon')].map(node=>getComputedStyle(node).stroke),opacity:[...svg.querySelectorAll('g polygon')].map(node=>getComputedStyle(node).opacity)};
  });
  expect(geometry.width).toBeLessThanOrEqual(width);expect(geometry.protected.every(Boolean)).toBe(true);expect(geometry.pointer).toBe('none');expect(geometry.inert).toBe(true);expect(new Set(geometry.colors).size).toBe(2);expect(geometry.opacity).toEqual(['1','1']);
  await page.evaluate(()=>{window.edgePath=document.querySelector('.loading-edge-p1');window.edgeClock=window.edgePath.getAnimations()[0];window.dispatchEvent(new Event('resize'));});
  await expect.poll(()=>page.evaluate(()=>window.edgePath===document.querySelector('.loading-edge-p1')&&window.edgeClock===window.edgePath.getAnimations()[0])).toBe(true);
  const clock=await page.evaluate(()=>window.edgeClock.currentTime);await expect.poll(()=>page.evaluate(()=>window.edgeClock.currentTime)).toBeGreaterThan(clock);
  await page.getByRole('button',{name:'Commander',exact:true}).evaluate(node=>node.focus({preventScroll:true}));await expect(page.getByRole('button',{name:'Commander',exact:true})).toBeFocused();
  expect(await rect()).toEqual(before);
  if((width===390&&info.project.name==='webkit')||(width===1440&&info.project.name==='chromium'))await page.screenshot({path:info.outputPath(`edge-${width}-${scale}.png`),fullPage:true});
  await page.evaluate(()=>document.querySelector('.board-wrap').dataset.loadingState='idle');await expect(page.locator('.loading-edge-frame')).toHaveCount(0);expect(await rect()).toEqual(before);
 }
});
test('edge lifecycle removes stale geometry and preserves static reduced-motion feedback',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{const label=document.querySelector('#fixture-text');label.className='axis-label';label.style.cssText='position:absolute;left:50px;top:5px;white-space:nowrap';label.textContent='A';});
 await expect.poll(()=>page.locator('.loading-edge-frame mask rect').count()).toBeGreaterThan(1);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const cutWidth=()=>page.locator('.loading-edge-frame').evaluate(svg=>{const s=svg.getBoundingClientRect(),label=document.querySelector('#fixture-text').getBoundingClientRect();return [...svg.querySelectorAll('mask rect')].slice(1).filter(c=>Math.abs(Number(c.getAttribute('x'))-(label.left-s.left-2))<.1&&Math.abs(Number(c.getAttribute('y'))-(label.top-s.top-2))<.1).map(c=>Number(c.getAttribute('width'))).sort((a,b)=>b-a)[0]??0;});
 const small=await cutWidth();
 await page.evaluate(()=>{window.edgePath=document.querySelector('.loading-edge-p1');window.edgeClock=window.edgePath.getAnimations()[0];document.querySelector('#fixture-text').firstChild.nodeValue='A deliberately longer label';});
 await expect.poll(cutWidth).toBeGreaterThan(small+50);
 expect(await page.evaluate(()=>window.edgePath===document.querySelector('.loading-edge-p1')&&window.edgeClock===window.edgePath.getAnimations()[0])).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.loading-edge-p1')).toHaveCSS('animation-name','none');
 await page.evaluate(()=>{document.querySelector('[data-shell-panel="board"]').style.setProperty('--stone-outline','none');window.dispatchEvent(new Event('resize'));});await expect(page.locator('.loading-edge-frame')).toHaveCount(0);
 await page.evaluate(()=>{document.querySelector('[data-shell-panel="board"]').style.removeProperty('--stone-outline');window.dispatchEvent(new Event('resize'));});await expect(page.locator('.loading-edge-frame')).toHaveCount(1);
 await page.evaluate(()=>window.edgeDispose());await expect(page.locator('.loading-edge-layer')).toHaveCount(0);
});

for(const productionSwipe of [false,true])test(`a reconnecting narrow track keeps its edge clipped and aligned through ${productionSwipe?'production swipe':'native motion'}, finish and cancel`,async({page},info)=>{
 await page.setViewportSize({width:390,height:800});await ready(page);
 const nativeFrames=await page.evaluate(productionSwipe=>{
  const panel=document.querySelector('[data-shell-panel="board"]'),frame=panel.parentElement;
  const viewport=document.createElement('div');viewport.className='game-shell-track-wrap';
  const track=document.createElement('div');track.className='game-shell-track';track.dataset.gameShellTrack='';track.dataset.transitionState='forward';if(!productionSwipe)track.style.setProperty('--shell-mobile-panel-transition','1200ms linear');
  const mobile=document.createElement('div');mobile.className='game-shell-mobile-panel';mobile.dataset.mobilePanel='board';
  frame.append(viewport);viewport.append(track);track.append(mobile);mobile.append(panel);
  document.querySelector('#app').style.setProperty('--shell-game-panel-index','0');
  window.edgePath=document.querySelector('.loading-edge-p1');window.edgeClock=window.edgePath.getAnimations()[0];
  window.edgeTrack=track;track.getBoundingClientRect();track.style.transform=`translateX(-${productionSwipe?viewport.getBoundingClientRect().width:72}px)`;
  track.getBoundingClientRect();window.trackMotion=track.getAnimations().find(animation=>animation.transitionProperty==='transform');
  if(!window.trackMotion)throw Error('Actual narrow track must expose its native transform transition');
  window.trackMotion.pause();
  window.trackDuration=window.trackMotion.effect.getComputedTiming().duration;
  return {prepaintHidden:getComputedStyle(document.querySelector('.loading-edge-layer')).visibility==='hidden',frames:window.trackMotion.effect.getKeyframes(),duration:window.trackDuration,distance:productionSwipe?viewport.getBoundingClientRect().width:72,cssDuration:getComputedStyle(track).transitionDuration,cssTiming:getComputedStyle(track).transitionTimingFunction};
 },productionSwipe);
 // Record the engine's actual CSS-transition endpoints; implicit endpoints
 // must be diagnosed rather than replaced with guessed transform values.
 const keyframesPath=info.outputPath('native-track-keyframes.json');await writeFile(keyframesPath,JSON.stringify(nativeFrames,null,2));
 await info.attach('native-track-keyframes',{path:keyframesPath,contentType:'application/json'});
 expect(nativeFrames.prepaintHidden).toBe(true);
 expect(new Set(nativeFrames.frames.map(frame=>frame.transform).filter(value=>value!==undefined)).size).toBeGreaterThan(1);
 const observations=[];
 await page.evaluate(()=>{window.edgeSnapshot=(full=true)=>{
  const measurementStartedAt=performance.now();
  const panel=document.querySelector('[data-shell-panel="board"]'),svg=document.querySelector('.loading-edge-frame'),viewport=document.querySelector('.game-shell-track-wrap');
  const p=panel.getBoundingClientRect(),s=svg.getBoundingClientRect(),v=viewport.getBoundingClientRect();
  const values=getComputedStyle(svg).clipPath.match(/-?[\d.]+px/g)?.map(parseFloat)??[];
  const inset=values.length===1?[values[0],values[0],values[0],values[0]]:values.length===2?[values[0],values[1],values[0],values[1]]:values.length===3?[values[0],values[1],values[2],values[1]]:values;
  let failingTargets=null;
  if(full){
   const cuts=[...svg.querySelectorAll('mask rect')].slice(1).map(node=>Object.fromEntries(['x','y','width','height'].map(key=>[key,Number(node.getAttribute(key))])));
   const protectedNodes=[...panel.querySelectorAll('h2,p,button,.board,.axis-label,.overlay-key')].filter(node=>!node.closest('[inert]')&&(!node.closest('.board')||node.matches('.board,.axis-label'))&&node.getClientRects().length);
   failingTargets=protectedNodes.filter(node=>{const b=node.getBoundingClientRect();return !cuts.some(c=>c.x<=b.left-s.left-1.9&&c.y<=b.top-s.top-1.9&&c.x+c.width>=b.right-s.left+1.9&&c.y+c.height>=b.bottom-s.top+1.9);}).map(node=>({tag:node.tagName,className:node.className,text:node.textContent.slice(0,100),rect:node.getBoundingClientRect().toJSON()}));
  }
  const sample={full,time:window.trackMotion.currentTime,duration:window.trackMotion.effect.getComputedTiming().duration,state:window.trackMotion.playState,navigation:window.edgeTrack.dataset.transitionState,visible:getComputedStyle(svg).visibility!=='hidden',moving:svg.hasAttribute('data-edge-moving'),strokeTime:window.edgeClock?.currentTime,inset,panel:full?p.toJSON():{left:p.left},frame:full?s.toJSON():null,viewport:full?v.toJSON():null,failingTargets,alignment:Math.max(Math.abs(s.left-(p.left-2)),Math.abs(s.top-(p.top-2))),
   clipped:inset.length===4&&s.left+inset[3]>=v.left-.1&&s.right-inset[1]<=v.right+.1&&s.top+inset[0]>=v.top-.1&&s.bottom-inset[2]<=v.bottom+.1,
   clear:full?failingTargets.length===0:null,
   same:window.edgePath===svg.querySelector('.loading-edge-p1')&&window.edgeClock===window.edgePath.getAnimations()[0]};
  const measurementCompletedAt=performance.now();
  return {...sample,measurementStartedAt,measurementCompletedAt,measurementCostMs:measurementCompletedAt-measurementStartedAt};
 };});
 const sample=async()=>{const result=await page.evaluate(()=>window.edgeSnapshot());observations.push(result);return result;};
 try{
 // Paused animations intentionally have no continuous measurement loop. Each
 // explicit time sample therefore invalidates layout just as resize/font work does.
 for(const fraction of [1/12,5/12,10/12]){
  await page.evaluate(fraction=>{window.trackMotion.currentTime=window.trackDuration*fraction;window.dispatchEvent(new Event('resize'));},fraction);
  await expect.poll(async()=>{const s=await sample();return s.alignment<.1&&s.clipped&&s.clear&&s.same&&!s.visible;}).toBe(true);
  if(fraction===5/12)await page.screenshot({path:info.outputPath('edge-native-track-midpoint.png'),fullPage:true});
 }
 await page.evaluate(()=>{window.trackMotion.currentTime=window.trackDuration/6;window.dispatchEvent(new Event('resize'));});
 await expect.poll(async()=> (await sample()).alignment).toBeLessThan(.1);
 // Observe native state/geometry/suppression, not painted FPS. The production
 // transition uses bounded native timers because CI can coalesce frame
 // callbacks; sparse native clock progress must still fail the same gates.
 const active=await page.evaluate(productionSwipe=>new Promise(resolve=>{
  const samples=[],accepted=[];let previousTime=window.trackMotion.currentTime,previousLeft=Infinity;
  const duration=window.trackDuration,deadline=duration-Math.min(100,duration*.1),step=Math.min(80,duration*.15);
  let timer=null,raf=null,done=false,previousCallback=null;
  const callbackSource=productionSwipe?'native-timer-8ms':'requestAnimationFrame';
  const finish=result=>{if(done)return;done=true;if(timer!==null)clearTimeout(timer);if(raf!==null)cancelAnimationFrame(raf);window.removeEventListener('pagehide',leave);if(window.edgeObservationCancel===cancel)delete window.edgeObservationCancel;resolve({...result,callbackSource});};
  const leave=()=>finish({ok:false,samples,accepted,deadline,reason:'Page left during native observation'});
  const cancel=()=>finish({ok:false,samples,accepted,deadline,reason:'Test retired native observation'});window.edgeObservationCancel=cancel;
  window.addEventListener('pagehide',leave,{once:true});
  const schedule=()=>{if(done)return;if(productionSwipe)timer=setTimeout(tick,8);else raf=requestAnimationFrame(tick);};
  const tick=()=>{
   timer=null;raf=null;
   const callbackAt=performance.now(),wallGapMs=previousCallback===null?null:callbackAt-previousCallback;previousCallback=callbackAt;
   const snapshot=full=>({...window.edgeSnapshot(full),callbackSource,callbackAt,wallGapMs});
   try{
   let sample=snapshot(false);samples.push(sample);
   if(sample.state!=='running'||sample.time>=deadline){finish({ok:false,samples,accepted,deadline,reason:'No three valid checkpoints before native end'});return;}
   if(sample.visible){finish({ok:false,samples,accepted,deadline,reason:'Decorative stroke became visible during navigation'});return;}
   if(sample.time>previousTime+step&&sample.clipped&&sample.same&&!sample.visible){
    // Full geometry is freshly measured only at eligible checkpoints. The
    // transition can advance during that work, so recheck every gate against
    // this new full sample rather than accepting the earlier light sample.
    sample=snapshot(true);samples.push(sample);
    if(sample.state!=='running'||sample.time>=deadline){finish({ok:false,samples,accepted,deadline,reason:'No three valid checkpoints before native end'});return;}
    if(sample.visible){finish({ok:false,samples,accepted,deadline,reason:'Decorative stroke became visible during navigation'});return;}
    if(sample.time>previousTime+step&&sample.clipped&&sample.same&&!sample.visible){
     if(sample.panel.left>=previousLeft){finish({ok:false,samples,accepted,deadline,reason:'Panel failed to progress in swipe direction'});return;}
     accepted.push(sample);previousLeft=sample.panel.left;previousTime=sample.time;
     if(accepted.length===1)window.edgeTrack.dataset.transitionState='';
     if(accepted.length===3){finish({ok:true,samples,accepted,deadline});return;}
    }
   }
   schedule();
   }catch(error){finish({ok:false,samples,accepted,deadline,reason:'Native observation threw',error:String(error)});}
  };
  raf=requestAnimationFrame(()=>{raf=null;try{window.trackMotion.play();window.dispatchEvent(new Event('resize'));schedule();}catch(error){finish({ok:false,samples,accepted,deadline,reason:'Native observation could not start',error:String(error)});}});
 }),productionSwipe);
 observations.push(...active.samples);
 expect(active.ok,JSON.stringify(active)).toBe(true);expect(active.accepted).toHaveLength(3);expect(active.accepted.every(sample=>sample.full)).toBe(true);
 expect(active.accepted[2].navigation).toBe('');
 expect(active.accepted[2].strokeTime).toBeGreaterThan(active.accepted[0].strokeTime);
 // The UI flag may clear before the native transition. Actual geometric
 // motion must continue suppressing decoration until its own end/cancel.
 await page.evaluate(()=>{window.edgeTrack.dataset.transitionState='';});
 await page.evaluate(()=>window.trackMotion.finished);
 await expect.poll(async()=>{const s=await sample();return s.alignment<.1&&s.clipped&&s.clear&&s.same&&s.visible&&!s.moving;}).toBe(true);
 await page.evaluate(()=>{
  window.edgeTrack.dataset.transitionState='backward';window.edgeTrack.style.transform='translateX(60px)';window.edgeTrack.getBoundingClientRect();
  const animation=window.edgeTrack.getAnimations().find(animation=>animation.transitionProperty==='transform');
  if(!animation)throw Error('Cancellation regression requires a real native transition');
  animation.pause();animation.currentTime=window.trackDuration/4;window.dispatchEvent(new Event('resize'));
 });
 await expect.poll(async()=> (await sample()).alignment).toBeLessThan(.1);
 await page.evaluate(()=>{window.edgeTrack.getAnimations().forEach(animation=>animation.cancel());window.edgeTrack.dataset.transitionState='';});
 await expect.poll(async()=>{const s=await sample();return s.alignment<.1&&s.clipped&&s.clear&&s.same&&s.visible&&!s.moving;}).toBe(true);
 expect(await page.evaluate(()=>window.edgeTrack.getAnimations().length)).toBe(0);
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(page.locator('.loading-edge-p1')).toHaveCSS('animation-name','none');
 await page.evaluate(()=>{window.edgeTrack.style.transition='none';window.edgeTrack.style.transform='translateX(0px)';});
 await expect.poll(async()=>{const s=await sample();return s.alignment<.1&&s.clipped&&s.clear&&s.visible&&!s.moving;}).toBe(true);
 await page.evaluate(()=>window.edgeDispose());await expect(page.locator('.loading-edge-layer')).toHaveCount(0);
 }finally{await page.evaluate(()=>window.edgeObservationCancel?.()).catch(()=>{});const path=info.outputPath('edge-track-geometry-samples.json');await writeFile(path,JSON.stringify(observations,null,2));await info.attach('edge-track-geometry-samples',{path,contentType:'application/json'});}
});
