import {writeFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';
const ready=async page=>{await page.goto('/browser-integration/support/loading-edge.html');await page.waitForFunction(()=>window.edgeReady);await expect(page.locator('.loading-edge-frame')).toHaveCount(1);};
for(const [width,scale] of [[320,100],[320,200],[390,200],[768,100],[932,100],[933,100],[944,200],[1440,100]])
test(`edge cut protects real labels, axes, controls and grid at every board format: ${width}px at ${scale}%`,async({page},info)=>{
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
  const sample={full,time:window.trackMotion.currentTime,duration:window.trackMotion.effect.getComputedTiming().duration,state:window.trackMotion.playState,pending:window.trackMotion.pending,playbackRate:window.trackMotion.playbackRate,navigation:window.edgeTrack.dataset.transitionState,visible:getComputedStyle(svg).visibility!=='hidden',moving:svg.hasAttribute('data-edge-moving'),strokeTime:window.edgeClock?.currentTime,inset,panel:full?p.toJSON():{left:p.left},frame:full?s.toJSON():null,viewport:full?v.toJSON():null,failingTargets,alignment:Math.max(Math.abs(s.left-(p.left-2)),Math.abs(s.top-(p.top-2))),
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
 {
  // Hold each real CSS transition's native clock, while retaining
  // its running state. Three progressive geometry checkpoints must not depend
  // on how many callbacks CI delivers inside the unchanged native duration.
  await page.evaluate(async()=>{window.trackMotion.playbackRate=0;window.trackMotion.play();await window.trackMotion.ready;});
  const held=[];
  for(const fraction of [1/12,5/12,10/12]){
   await page.evaluate(fraction=>{window.trackMotion.currentTime=window.trackDuration*fraction;window.edgeTrack.dataset.transitionState=fraction===1/12?'forward':'';window.dispatchEvent(new Event('resize'));},fraction);
   let checkpoint;
   await expect.poll(async()=>{checkpoint=await sample();return checkpoint.state==='running'&&!checkpoint.pending&&checkpoint.playbackRate===0&&checkpoint.moving&&!checkpoint.visible&&checkpoint.alignment<.1&&checkpoint.clipped&&checkpoint.clear&&checkpoint.same;}).toBe(true);
   held.push(checkpoint);
  }
  expect(held).toHaveLength(3);expect(held.every(checkpoint=>checkpoint.full)).toBe(true);
  expect(held[1].navigation).toBe('');expect(held[2].navigation).toBe('');
  expect(held[1].panel.left).toBeLessThan(held[0].panel.left);expect(held[2].panel.left).toBeLessThan(held[1].panel.left);
  expect(held[2].strokeTime).toBeGreaterThan(held[0].strokeTime);
  observations.push(...held);
 }
 await page.evaluate(async()=>{window.trackMotion.pause();await window.trackMotion.ready;window.trackMotion.playbackRate=1;window.trackMotion.currentTime=window.trackDuration/6;window.edgeTrack.dataset.transitionState='forward';window.dispatchEvent(new Event('resize'));});
 const prepared=await sample();expect(prepared.state).toBe('paused');expect(prepared.pending).toBe(false);expect(prepared.time).toBeCloseTo(nativeFrames.duration/6,1);
 await expect.poll(async()=> (await sample()).alignment).toBeLessThan(.1);
 // The native transition now runs freely at its original rate/duration.
 // Inspect every delivered active callback, but require semantic lifecycle
 // and endpoint progress rather than a particular callback throughput.
 // WebKit can advance compositor positions between DOM rectangle reads while
 // currentTime stays unchanged. Held native checkpoints above prove exact
 // mask geometry; during free motion the stroke must stay hidden, then all
 // geometry must be correct again before the settled stroke is restored.
 // Both durations retain three progressive held-running checkpoints above.
 const active=await page.evaluate(()=>new Promise(resolve=>{
  const samples=[];let start=null,raf=null,done=false;
  const finish=result=>{if(done)return;done=true;if(raf!==null)cancelAnimationFrame(raf);window.removeEventListener('pagehide',leave);if(window.edgeObservationCancel===cancel)delete window.edgeObservationCancel;resolve({...result,samples,start,mode:'free-running-native',callbackSource:'requestAnimationFrame'});};
  const leave=()=>finish({ok:false,reason:'Page left during native observation'});
  const cancel=()=>finish({ok:false,reason:'Test retired native observation'});window.edgeObservationCancel=cancel;
  window.addEventListener('pagehide',leave,{once:true});
  const tick=()=>{
   raf=null;
   try{
    const sample=window.edgeSnapshot();samples.push(sample);
    if(sample.state==='running'&&sample.time<sample.duration){
     if(sample.visible||!sample.same||!sample.moving){finish({ok:false,reason:'Native active sample failed suppression or animation identity'});return;}
     window.edgeTrack.dataset.transitionState='';
    }
    if(!done)raf=requestAnimationFrame(tick);
   }catch(error){finish({ok:false,reason:'Native observation threw',error:String(error)});}
  };
  try{
   window.trackMotion.play();window.dispatchEvent(new Event('resize'));
   window.trackMotion.ready.then(()=>{
    if(done)return;start=window.edgeSnapshot();
    const running=start.state==='running'&&!start.pending&&start.time<start.duration;
    if(!running){finish({ok:false,reason:'Native transition must be actively running after play readiness'});return;}
    window.trackMotion.finished.then(()=>finish({ok:true,running,end:window.edgeSnapshot()}),error=>finish({ok:false,reason:'Native transition did not finish',error:String(error)}));
    raf=requestAnimationFrame(tick);
   },error=>finish({ok:false,reason:'Native play readiness failed',error:String(error)}));
  }catch(error){finish({ok:false,reason:'Native observation could not start',error:String(error)});}
 }));
 observations.push(...active.samples);
 expect(active.ok,JSON.stringify(active)).toBe(true);
 expect(active.running).toBe(true);expect(active.start.playbackRate).toBe(1);expect(active.end.playbackRate).toBe(1);
 expect(active.end.state).toBe('finished');expect(active.end.time).toBeGreaterThanOrEqual(nativeFrames.duration);
 expect(active.end.panel.left).toBeLessThan(active.start.panel.left);expect(active.end.strokeTime).toBeGreaterThan(active.start.strokeTime);
 expect(active.samples.filter(sample=>sample.state==='running'&&sample.time<sample.duration).every(sample=>!sample.visible)).toBe(true);
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
