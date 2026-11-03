import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
// DOMRect edges are composed from the measured top/height primitives. Only
// actual float32-representable primitives contribute representational error.
const primitiveError=value=>value!==0&&Math.fround(value)===value?2**(Math.floor(Math.log2(Math.abs(value)))-24):0;
const focusedFootprint=sample=>{
 expect(sample.slot.bottom).toBe(sample.slot.top+sample.slot.height);
 expect(sample.control.bottom).toBe(sample.control.top+sample.control.height);
 const {control,slot,ring}=sample;
 const center=control.top+control.height/2,half=Math.max(44,control.height)/2;
 const top=Math.min(center-half,control.top-ring),bottom=Math.max(center+half,control.top+control.height+ring);
 const lowerPrimitives=[control.top,control.height,slot.top];
 const upperPrimitives=[control.top,control.height,slot.top,slot.height];
 const lowerBound=lowerPrimitives.reduce((sum,value)=>sum+primitiveError(value),0);
 const upperBound=upperPrimitives.reduce((sum,value)=>sum+primitiveError(value),0);
 return{top,bottom,lowerPrimitives,upperPrimitives,lowerBound,upperBound,fits:top>=slot.top-lowerBound&&bottom<=slot.bottom+upperBound};
};
for(const scale of [100,200])test(`native message expansion and collapse keep board paint and hits separate at ${scale}%`,async({page},info)=>{
 const evidence={scope:'Held real native animation/hit containment; screenshots need actual paint review, not elapsed-time/performance proof',scale,samples:[]};
 const persist=async()=>{try{await writeFile(info.outputPath('paint-containment.json'),JSON.stringify(evidence,null,2));}catch(error){console.error(JSON.stringify({kind:'paint-evidence-incomplete',name:error?.name??'Error'}));}};
 try{
  await page.setViewportSize({width:320,height:1000});await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async scale=>{document.documentElement.style.fontSize=`${scale}%`;const faces=await document.fonts.load('16px "Manrope"');await document.fonts.ready;if(!faces.some(face=>face.family.includes('Manrope')&&face.status==='loaded'))throw Error('Actual Manrope face missing');await window.boardFixture.setup('pass',false);},scale);
  const settled=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>!document.querySelector('.board-message-slot').getAnimations().some(a=>a.pending||a.playState==='running'));};await settled();
  await page.evaluate(()=>{const slot=document.querySelector('.board-message-slot'),animate=slot.animate;window.paintAnimation=null;slot.animate=function(...args){const result=animate.apply(this,args);window.paintAnimation=result;result.pause();return result;};window.paintShort={text:'Select a piece or',action:{id:'pass',label:'Pass'}};window.paintLong={text:'The selected piece cannot move because it had no command connection at the start of this rush.',action:{id:'replay-next',label:'Next'}};});
  for(const direction of ['expand','collapse']){
   await page.evaluate(direction=>{window.paintAnimation=null;window.boardFixture.message(direction==='expand'?window.paintLong:window.paintShort);},direction);
   await page.waitForFunction(()=>window.paintAnimation!==null);await page.evaluate(()=>window.paintAnimation.ready);
   const duration=await page.evaluate(()=>window.paintAnimation.effect.getTiming().duration);expect(duration).toBe(direction==='expand'?450:280);
   for(const clock of direction==='expand'?[0,1,90,225,449]:[0,1,56,140,279]){
    const sample=await page.evaluate(({clock,direction})=>{const animation=window.paintAnimation;animation.currentTime=clock;const slot=document.querySelector('.board-message-slot'),live=slot.querySelector('.board-message-live'),board=document.querySelector('#board');const r=slot.getBoundingClientRect();const probes=[...board.querySelectorAll('.cell')].map(cell=>{const rect=cell.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;if(x<0||x>=innerWidth||y<0||y>=innerHeight)return null;const hit=document.elementFromPoint(x,y);return{x,y,coveredByMessage:Boolean(hit&&live.contains(hit))};}).filter(Boolean);const fragments=[];const walker=document.createTreeWalker(live,NodeFilter.SHOW_TEXT);for(let node;node=walker.nextNode();){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects()){const x=rect.x+rect.width/2,y=rect.y+rect.height/2;if(rect.bottom>r.bottom&&y>=board.getBoundingClientRect().top&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight){const hits=document.elementsFromPoint(x,y);fragments.push({rect:rect.toJSON(),x,y,messageHit:hits.some(hit=>live.contains(hit))});}}}return{direction,clock,duration:animation.effect.getTiming().duration,state:animation.playState,pending:animation.pending,slot:r.toJSON(),board:board.getBoundingClientRect().toJSON(),live:live.getBoundingClientRect().toJSON(),probes,fragments};},{clock,direction});
    evidence.samples.push(sample);await persist();await page.screenshot({path:info.outputPath(`${direction}-${scale}-${clock}.png`)});
    expect(sample.probes.length).toBeGreaterThan(0);if(direction==='expand'&&clock<=1)expect(sample.fragments.length,'early held frames must exercise real overflowing text fragments').toBeGreaterThan(0);expect(sample.fragments.filter(fragment=>fragment.messageHit),'Overflowing text must not own board-region hit tests').toEqual([]);expect(sample.probes.filter(probe=>probe.coveredByMessage),'Message paint/hit region must not occupy the board during native height movement').toEqual([]);
   }
   await page.evaluate(async()=>{window.paintAnimation.play();await window.paintAnimation.ready;await window.paintAnimation.finished;});await settled();
   const action=page.getByRole('button',{name:direction==='expand'?'Next':'Pass',exact:true});await expect(action).toBeVisible();
   const hit=await action.evaluate(button=>{const r=button.getBoundingClientRect(),x=r.x+r.width/2;const y=r.height<44?r.y+r.height/2+20:r.y+r.height/2;return{width:r.width,reachable:document.elementFromPoint(x,y)?.closest('button')===button};});expect(hit.width).toBeGreaterThanOrEqual(44);expect(hit.reachable).toBe(true);
  }
  expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);evidence.status='complete';
 }catch(error){evidence.failure=String(error);throw error;}finally{await persist();}
});

test('focused surviving action fits its reservation before the next animation frame',async({page},info)=>{
 const evidence={scope:'Focused same-action publication boundary, no gameplay or elapsed-time proof'};
 const persist=async()=>{try{await writeFile(info.outputPath('focused-publication.json'),JSON.stringify(evidence,null,2));}catch(error){console.error(JSON.stringify({kind:'paint-evidence-incomplete',name:error?.name??'Error'}));}};
 try{
  await page.setViewportSize({width:320,height:1000});await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async()=>{document.documentElement.style.fontSize='200%';const faces=await document.fonts.load('16px "Manrope"');await document.fonts.ready;if(!faces.some(face=>face.family.includes('Manrope')&&face.status==='loaded'))throw Error('Actual Manrope face missing');await window.boardFixture.setup('pass',false);window.boardFixture.message({text:'Recorded move',action:{id:'replay-next',label:'Next'}});});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>!document.querySelector('.board-message-slot').getAnimations().some(a=>a.pending||a.playState==='running'));
  const next=page.getByRole('button',{name:'Next',exact:true});await next.focus();await expect(next).toBeFocused();
  evidence.sample=await page.evaluate(()=>{const control=document.activeElement,slot=control.closest('.board-message-slot'),old=control;window.boardFixture.message({text:'The selected piece cannot move because it had no command connection at the start of this rush.',action:{id:'replay-next',label:'Next'}});const rect=control.getBoundingClientRect(),reserved=slot.getBoundingClientRect(),style=getComputedStyle(control);const ring=parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset),halfHit=Math.max(44,rect.height)/2;return{same:old===document.querySelector('[data-board-message-action="replay-next"]'),focused:document.activeElement===old,focusVisible:old.matches(':focus-visible'),slot:reserved.toJSON(),control:rect.toJSON(),ring,hitTop:rect.y+rect.height/2-halfHit,hitBottom:rect.y+rect.height/2+halfHit,paintTop:rect.top-ring,paintBottom:rect.bottom+ring,animationStates:slot.getAnimations().map(a=>({state:a.playState,pending:a.pending}))};});
  await persist();await page.screenshot({path:info.outputPath('focused-publication-before-raf.png')});
  expect(evidence.sample.same).toBe(true);expect(evidence.sample.focused).toBe(true);expect(evidence.sample.focusVisible).toBe(true);expect(evidence.sample.ring).toBe(4);
  evidence.positive=focusedFootprint(evidence.sample);await persist();
  expect(evidence.positive.fits,'Existing focused action must fit synchronously within its measured primitive representation bound').toBe(true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForFunction(()=>!document.querySelector('.board-message-slot').getAnimations().some(animation=>animation.pending||animation.playState==='running'));
  evidence.settledBaseline=await page.evaluate(()=>{const control=document.activeElement,slot=control.closest('.board-message-slot'),live=control.closest('.board-message-live'),actions=control.closest('.board-message-actions');const snapshot=node=>node?{rect:node.getBoundingClientRect().toJSON(),scrollTop:node.scrollTop,computedMarginTop:getComputedStyle(node).marginTop}:null;const style=getComputedStyle(control);return {control:control.getBoundingClientRect().toJSON(),slot:slot.getBoundingClientRect().toJSON(),ring:parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset),focused:control===document.querySelector('[data-board-message-action="replay-next"]'),focusVisible:control.matches(':focus-visible'),live:snapshot(live),actions:snapshot(actions),windowScroll:{x:scrollX,y:scrollY}};});
  evidence.settledBaseline.comparison=focusedFootprint(evidence.settledBaseline);await persist();
  expect(evidence.settledBaseline.focused).toBe(true);expect(evidence.settledBaseline.focusVisible).toBe(true);
  expect(evidence.settledBaseline.comparison.fits,'Settled focused baseline must fit before applying the independent negative perturbation').toBe(true);
  const negative=await page.evaluate(()=>{const control=document.activeElement,slot=control.closest('.board-message-slot'),previous=control.style.top,before=control.getBoundingClientRect();control.style.top='0.015625px';let moved=control.getBoundingClientRect();let requested=.015625;if(moved.top===before.top){requested=1;control.style.top='1px';moved=control.getBoundingClientRect();}const reserved=slot.getBoundingClientRect(),style=getComputedStyle(control),sample={control:moved.toJSON(),slot:reserved.toJSON(),ring:parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset)};control.style.top=previous;return{sample,requested,actual:moved.top-before.top,restored:control.getBoundingClientRect().toJSON(),before:before.toJSON()};});
  evidence.negative={...negative,comparison:focusedFootprint(negative.sample)};await persist();
  expect(negative.actual).toBeGreaterThan(0);expect(evidence.negative.comparison.fits,'The same footprint helper must reject independent real downward movement').toBe(false);expect(negative.restored).toEqual(negative.before);
  expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);evidence.status='complete';
 }catch(error){evidence.failure=String(error);throw error;}finally{await persist();}
});
