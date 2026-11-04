import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {settledMessage} from './support/message-semantic-geometry.mjs';
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
for(const scale of [100,200])test(`shared narrow heading and prompt slots reclaim only redundant spacing at ${scale}%`,async({page},info)=>{
 await page.setViewportSize({width:390,height:740});await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async scale=>{document.documentElement.style.fontSize=`${scale}%`;const {renderBoardHeadingSlot}=await import('/apps/web/shell/board-message-layout.js');document.querySelector('main > h2').outerHTML=renderBoardHeadingSlot({loading:true});await document.fonts.ready;await window.boardFixture.setup('pass',false);},scale);
 await settledMessage(page);
 const samples=await page.evaluate(async()=>{
  const {renderBoardHeadingSlot}=await import('/apps/web/shell/board-message-layout.js');
  const samples=[];
  for(const phase of ['loading-heading','live-heading','replay','pass']){
   const previous=document.querySelector('main > .board-heading-slot,main > h2');previous.outerHTML=renderBoardHeadingSlot({loading:phase==='loading-heading'});
   const turn=document.querySelector('#shell-board-turn-indicator');if(turn)turn.textContent='Your turn to play';
   window.boardFixture.message(phase==='replay'?{text:'Watch replay',action:{id:'replay-stop',label:'Stop replay'}}:{text:'Select a piece or',action:{id:'pass',label:'Pass'}});
   const rect=node=>node.getBoundingClientRect().toJSON(),slot=document.querySelector('.board-message-slot'),board=document.querySelector('#board'),button=document.querySelector('#preview button'),r=button.getBoundingClientRect(),center=r.top+r.height/2,half=Math.max(44,r.height)/2;
   const cells=[...board.children].map(cell=>({width:cell.getBoundingClientRect().width,height:cell.getBoundingClientRect().height}));
   samples.push({phase,heading:rect(document.querySelector('.board-heading:not([aria-hidden])')),headingSlot:rect(document.querySelector('.board-heading-slot')),slot:rect(slot),board:rect(board),cells,
    target:{width:r.width,top:center-half,bottom:center+half,lowerHit:document.elementFromPoint(r.left+r.width/2,center+Math.min(21,half-1))?.closest('button')===button},
    overflow:slot.dataset.promptOverflow??null,unmapped:document.querySelector('#preview').dataset.promptUnmapped??null});
  }
  return samples;
 });
 await info.attach('Shared narrow slot geometry',{body:JSON.stringify({scale,samples}),contentType:'application/json'});
 for(const sample of samples){
  expect(sample.heading.bottom).toBe(sample.headingSlot.bottom);expect(sample.slot.top).toBe(sample.headingSlot.bottom);expect(sample.board.top).toBe(sample.slot.bottom);
  expect(sample.board).toEqual(samples[0].board);expect(sample.cells).toHaveLength(100);expect(sample.cells).toEqual(samples[0].cells);
  expect(sample.target.width).toBeGreaterThanOrEqual(44);expect(sample.target.top).toBeGreaterThanOrEqual(sample.slot.top);expect(sample.target.bottom).toBeLessThanOrEqual(sample.slot.bottom);expect(sample.target.lowerHit).toBe(true);
  expect(sample.overflow).toBeNull();expect(sample.unmapped).toBeNull();
 }
});
for(const scale of [100,200])test(`native fixed prompt changes keep board paint and hits separate at ${scale}%`,async({page},info)=>{
 const evidence={scope:'Fixed finite grammar before/after native rendering, with independent real paint-interception negative',scale,samples:[]};
 const persist=async()=>{try{await writeFile(info.outputPath('paint-containment.json'),JSON.stringify(evidence,null,2));}catch(error){console.error(JSON.stringify({kind:'paint-evidence-incomplete',name:error?.name??'Error'}));}};
 try{
  await page.setViewportSize({width:320,height:1000});await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async scale=>{document.documentElement.style.fontSize=`${scale}%`;const faces=await document.fonts.load('16px "Manrope"');await document.fonts.ready;if(!faces.some(face=>face.family.includes('Manrope')&&face.status==='loaded'))throw Error('Actual Manrope face missing');await window.boardFixture.setup('pass',false);},scale);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const sample=()=>page.evaluate(()=>{
   const slot=document.querySelector('.board-message-slot'),live=document.querySelector('.board-message-live'),board=document.querySelector('#board');
   const probes=[...board.querySelectorAll('.cell')].map(cell=>{const rect=cell.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;if(x<0||x>=innerWidth||y<0||y>=innerHeight)return null;const hit=document.elementFromPoint(x,y);return{x,y,coveredByMessage:Boolean(hit&&live.contains(hit))};}).filter(Boolean);
   return {slot:slot.getBoundingClientRect().toJSON(),board:board.getBoundingClientRect().toJSON(),probes,animations:slot.getAnimations().filter(a=>a.pending||a.playState==='running').length,overflow:slot.dataset.promptOverflow??null,unmapped:document.querySelector('#preview').dataset.promptUnmapped??null};
  });
  const before=await sample();
  for(const phase of ['replay','pass']){
   await page.evaluate(phase=>window.boardFixture.message(phase==='replay'?{text:'Watch replay',action:{id:'replay-stop',label:'Stop replay'}}:{text:'Select a piece or',action:{id:'pass',label:'Pass'}}),phase);
   const synchronous=await sample();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));const painted=await sample();
   evidence.samples.push({phase,synchronous,painted});await persist();
   for(const actual of [synchronous,painted]){expect(actual.slot).toEqual(before.slot);expect(actual.board).toEqual(before.board);expect(actual.animations).toBe(0);expect(actual.overflow).toBeNull();expect(actual.unmapped).toBeNull();expect(actual.probes.length).toBeGreaterThan(0);expect(actual.probes.filter(p=>p.coveredByMessage)).toEqual([]);}
   const action=page.getByRole('button',{name:phase==='replay'?'Stop replay':'Pass',exact:true});await expect(action).toBeVisible();
   const hit=await action.evaluate(button=>{const r=button.getBoundingClientRect(),x=r.x+r.width/2;const y=r.height<44?r.y+r.height/2+20:r.y+r.height/2;return{width:r.width,reachable:document.elementFromPoint(x,y)?.closest('button')===button};});expect(hit.width).toBeGreaterThanOrEqual(44);expect(hit.reachable).toBe(true);
   await page.screenshot({path:info.outputPath(`fixed-${phase}-${scale}.png`)});
  }
  // Move the SAME measured message owner outside its clipping slot. This is
  // an independent invalid overlay, not a product clipping-rule change.
  await page.evaluate(()=>{const live=document.querySelector('.board-message-live'),board=document.querySelector('#board'),rect=board.getBoundingClientRect();window.paintOwnerRestore={parent:live.parentNode,next:live.nextSibling,style:live.style.cssText};document.body.append(live);live.style.cssText=`position:fixed;z-index:100;left:${rect.left}px;top:${rect.top+4}px;width:${rect.width}px`;});
  evidence.negative=await sample();await persist();expect(evidence.negative.probes.some(p=>p.coveredByMessage),'The same native hit oracle must detect an independent real overlay over Board cells').toBe(true);
  await page.evaluate(()=>{const live=document.querySelector('.board-message-live'),saved=window.paintOwnerRestore;saved.parent.insertBefore(live,saved.next);live.style.cssText=saved.style;});expect(await sample()).toEqual(before);
  expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);evidence.status='complete';
 }catch(error){evidence.failure=String(error);throw error;}finally{await persist();}
});

test('focused surviving action fits its reservation before the next animation frame',async({page},info)=>{
 const evidence={scope:'Unsupported-producer safe-reflow focused same-action publication boundary, not normal fixed-grammar acceptance or gameplay proof'};
 const persist=async()=>{try{await writeFile(info.outputPath('focused-publication.json'),JSON.stringify(evidence,null,2));}catch(error){console.error(JSON.stringify({kind:'paint-evidence-incomplete',name:error?.name??'Error'}));}};
 try{
  await page.setViewportSize({width:320,height:1000});await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async()=>{document.documentElement.style.fontSize='200%';const faces=await document.fonts.load('16px "Manrope"');await document.fonts.ready;if(!faces.some(face=>face.family.includes('Manrope')&&face.status==='loaded'))throw Error('Actual Manrope face missing');await window.boardFixture.setup('pass',false);window.boardFixture.message({text:'Recorded move',action:{id:'replay-next',label:'Next'}});});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>!document.querySelector('.board-message-slot').getAnimations().some(a=>a.pending||a.playState==='running'));
  const next=page.getByRole('button',{name:'Next',exact:true});await next.focus();await expect(next).toBeFocused();
  evidence.sample=await page.evaluate(()=>{const control=document.activeElement,slot=control.closest('.board-message-slot'),old=control;window.boardFixture.message({text:'The selected piece cannot move because it had no command connection at the start of this rush.',action:{id:'replay-next',label:'Next'}});const rect=control.getBoundingClientRect(),reserved=slot.getBoundingClientRect(),style=getComputedStyle(control);const ring=parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset),halfHit=Math.max(44,rect.height)/2;return{same:old===document.querySelector('[data-board-message-action="replay-next"]'),focused:document.activeElement===old,focusVisible:old.matches(':focus-visible'),slot:reserved.toJSON(),control:rect.toJSON(),ring,hitTop:rect.y+rect.height/2-halfHit,hitBottom:rect.y+rect.height/2+halfHit,paintTop:rect.top-ring,paintBottom:rect.bottom+ring,animationStates:slot.getAnimations().map(a=>({state:a.playState,pending:a.pending}))};});
  await persist();await page.screenshot({path:info.outputPath('focused-publication-before-raf.png')});
  expect(await page.locator('#preview').getAttribute('data-prompt-unmapped')).toBe('true');
  expect(evidence.sample.same).toBe(true);expect(evidence.sample.focused).toBe(true);expect(evidence.sample.focusVisible).toBe(true);expect(evidence.sample.ring).toBe(4);
  evidence.positive=focusedFootprint(evidence.sample);await persist();
  expect(evidence.positive.fits,'Existing focused action must fit synchronously within its measured primitive representation bound').toBe(true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForFunction(()=>!document.querySelector('.board-message-slot').getAnimations().some(animation=>animation.pending||animation.playState==='running'));
  evidence.settledBaseline=await page.evaluate(()=>{const control=document.activeElement,slot=control.closest('.board-message-slot'),live=control.closest('.board-message-live'),actions=control.closest('.board-message-actions');const snapshot=node=>node?{rect:node.getBoundingClientRect().toJSON(),scrollTop:node.scrollTop,computedMarginTop:getComputedStyle(node).marginTop}:null;const style=getComputedStyle(control);return {control:control.getBoundingClientRect().toJSON(),slot:slot.getBoundingClientRect().toJSON(),ring:parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset),focused:control===document.querySelector('[data-board-message-action="replay-next"]'),focusVisible:control.matches(':focus-visible'),live:snapshot(live),actions:snapshot(actions),windowScroll:{x:scrollX,y:scrollY}};});
  evidence.settledBaseline.comparison=focusedFootprint(evidence.settledBaseline);await persist();
  expect(evidence.settledBaseline.focused).toBe(true);expect(evidence.settledBaseline.focusVisible).toBe(true);
  expect(evidence.settledBaseline.comparison.fits,'Settled focused baseline must fit before applying the independent negative perturbation').toBe(true);
  const negative=await page.evaluate(()=>{const control=document.activeElement,slot=control.closest('.board-message-slot'),previous=control.style.top,before=control.getBoundingClientRect();const footprintBottom=Math.max(before.top+before.height/2+Math.max(44,before.height)/2,before.bottom+4);const requested=Math.max(1,slot.getBoundingClientRect().bottom-footprintBottom+1);control.style.top=`${requested}px`;const moved=control.getBoundingClientRect();const reserved=slot.getBoundingClientRect(),style=getComputedStyle(control),sample={control:moved.toJSON(),slot:reserved.toJSON(),ring:parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset)};control.style.top=previous;return{sample,requested,actual:moved.top-before.top,restored:control.getBoundingClientRect().toJSON(),before:before.toJSON()};});
  evidence.negative={...negative,comparison:focusedFootprint(negative.sample)};await persist();
  expect(negative.actual).toBeGreaterThan(0);expect(evidence.negative.comparison.fits,'The same footprint helper must reject independent real downward movement').toBe(false);expect(negative.restored).toEqual(negative.before);
  expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);evidence.status='complete';
 }catch(error){evidence.failure=String(error);throw error;}finally{await persist();}
});
