import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

for(const scale of [100,200])for(const action of [{id:"pass",label:"Pass"},{id:"end-turn",label:"End turn"},{id:"replay-computer",label:"Show me again"}])for(const fallback of [false,true])test(`${action.label} and compact-coordinate text share the ${fallback?"fallback":"primary"} prose baseline at ${scale}%`,async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/browser-integration/support/message-font-admission.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async ({scale,action,fallback})=>{
  document.documentElement.style.fontSize=`${scale}%`;await document.fonts.ready;
  const {renderBoardInlineAction}=await import('/apps/web/board/message-presentation.js');
  const {renderCoordinateChip}=await import('/apps/web/board/coordinate-chip.js');
  const label=document.querySelector('#font-message');if(fallback)label.style.fontFamily='var(--font-family-fallback)';label.innerHTML=`Prose <span data-baseline="prose"></span> ${renderCoordinateChip({row:9,col:9})} ${renderBoardInlineAction(action)}`;
  const chip=label.querySelector('.board-preview-coordinate-chip');chip.innerHTML=`<span>${chip.textContent}<span data-baseline="chip"></span></span>`;
  label.querySelector('.board-inline-action-label').insertAdjacentHTML('beforeend','<span data-baseline="action"></span>');
  for(const probe of label.querySelectorAll('[data-baseline]'))probe.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';
 },{scale,action,fallback});
 const proof=await page.locator('#font-message').evaluate(label=>{
  const button=label.querySelector('button'),chip=label.querySelector('.board-preview-coordinate-chip'),style=getComputedStyle(button),chipStyle=getComputedStyle(chip);
  return {proseSize:parseFloat(getComputedStyle(label).fontSize),fontSize:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight),paddingTop:parseFloat(style.paddingTop),paddingBottom:parseFloat(style.paddingBottom),paddingLeft:parseFloat(style.paddingLeft),border:parseFloat(style.borderTopWidth),height:button.getBoundingClientRect().height,chipHeight:chip.getBoundingClientRect().height,chipSize:parseFloat(chipStyle.fontSize),baselines:Object.fromEntries([...label.querySelectorAll('[data-baseline]')].map(el=>[el.dataset.baseline,el.getBoundingClientRect().y]))};
 });
 expect(proof.fontSize).toBeCloseTo(proof.proseSize*.88,1);expect(proof.lineHeight).toBeCloseTo(proof.fontSize*1.5,1);
 expect(proof.paddingTop).toBeCloseTo(proof.fontSize*.2,1);expect(proof.paddingBottom).toBeCloseTo(proof.fontSize*.2,1);expect(proof.paddingLeft).toBeCloseTo(proof.fontSize*.48,1);expect(proof.border).toBe(1);
 expect(proof.height).toBeCloseTo(proof.fontSize*1.9+2,1);expect(proof.chipHeight).toBeCloseTo(proof.chipSize*1.25,1);
 expect(Math.abs(proof.baselines.action-proof.baselines.prose)).toBeLessThanOrEqual(.1);expect(Math.abs(proof.baselines.chip-proof.baselines.prose)).toBeLessThanOrEqual(.1);
 await page.screenshot({path:info.outputPath(`shared-baseline-${action.id}-${fallback}-${scale}.png`)});
});

for(const width of [320,390])for(const scale of [100,200])test(`wrapped action targets stay separate at ${width}px and ${scale}%`,async({page},info)=>{
 await page.setViewportSize({width,height:1200});await page.goto('/browser-integration/support/message-font-admission.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async scale=>{
  document.documentElement.style.fontSize=`${scale}%`;await document.fonts.ready;
  const {renderBoardMessageHtml}=await import('/apps/web/board/message-presentation.js');document.querySelector('#font-message').innerHTML=renderBoardMessageHtml({rows:[{text:'Your opponent pushed (9, 9) and had several pieces follow',coordinates:[{row:9,col:9}],action:{id:'replay-computer',label:'Show me again'}},{text:'Select a piece or',action:{id:'pass',label:'Pass'}}]});
 },scale);
 const proof=await page.locator('#font-message').evaluate(label=>{
  const board=document.querySelector('#font-board').getBoundingClientRect(),slot=label.closest('.board-message-slot').getBoundingClientRect();
  const targets=[...label.querySelectorAll('button')].map(button=>{const rect=button.getBoundingClientRect(),height=Math.max(44,rect.height),top=rect.y+(rect.height-height)/2;return {text:button.textContent,width:rect.width,rect:rect.toJSON(),pseudo:{height:getComputedStyle(button,'::before').height,top:getComputedStyle(button,'::before').top,transform:getComputedStyle(button,'::before').transform,boxSizing:getComputedStyle(button,'::before').boxSizing},top,bottom:top+height,height,points:[top+1,top+height-1].map(y=>({y,owns:document.elementFromPoint(rect.x+rect.width/2,y)?.closest('button')===button,hit:document.elementFromPoint(rect.x+rect.width/2,y)?.outerHTML.slice(0,200)}))};});
  return {targets,slot:{top:slot.top,bottom:slot.bottom},boardTop:board.top,overflow:document.documentElement.scrollWidth>innerWidth,scrollWidth:document.documentElement.scrollWidth,overflowNodes:[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,cls:el.className,rect:el.getBoundingClientRect().toJSON()})).filter(row=>row.rect.right>innerWidth+.1).slice(0,12)};
 });
 await writeFile(info.outputPath('hit-regions.json'),JSON.stringify(proof,null,2));
 await info.attach('hit-regions',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
 expect(proof.targets).toHaveLength(2);for(const target of proof.targets){expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);expect(target.points.every(point=>point.owns),target.text).toBe(true);expect(target.top).toBeGreaterThanOrEqual(proof.slot.top-.1);expect(target.bottom).toBeLessThanOrEqual(proof.slot.bottom+.1);expect(target.bottom).toBeLessThan(proof.boardTop);}
 expect(proof.targets[0].bottom).toBeLessThanOrEqual(proof.targets[1].top+.1);expect(proof.overflow).toBe(false);
 await page.screenshot({path:info.outputPath(`wrapped-actions-${width}-${scale}.png`)});
});
