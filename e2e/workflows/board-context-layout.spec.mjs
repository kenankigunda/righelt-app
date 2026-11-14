import {test,expect} from '@playwright/test';

// Browser integration of the production renderer, fixed-height controller and
// complete stylesheet chain. Real game positioning is covered separately by
// human-opponent-replay, never inferred from this controlled geometry fixture.
for(const width of [320,390,1440])test(`finite Board prompt geometry and required context stay accessible at ${width}px`,async({page,baseURL},info)=>{
 await page.setViewportSize({width,height:600});
 await page.route('**/board-context-layout-fixture',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/shell/shell.css"><link rel="stylesheet" href="/shell/refresh.css"><link rel="stylesheet" href="/shell/board-ux.css"></head><body><main id="fixture" style="margin:16px;width:calc(100% - 32px);max-width:640px"></main></body></html>`}));
 await page.goto(`${baseURL}/board-context-layout-fixture`);
 await page.evaluate(async()=>{
  const [{renderBoardMessageSlot},{boardPromptSizingModels,isMappedBoardPromptHtml},{renderBoardMessageHtml},{createMessageHeightController},{renderBoardContext},{createBoardContextLayout}]=await Promise.all([
   import('/shell/board-message-layout.js'),import('/board/prompt-models.js'),import('/board/message-presentation.js'),import('/board/message-height.js'),import('/shell/board-context.js'),import('/shell/board-context-layout.js'),
  ]);
  const root=document.getElementById('fixture');root.innerHTML=renderBoardMessageSlot({id:'shell-board-preview-label'})+'<div id="geometry-board" style="height:200px;width:100%;background:#ddd"></div>';
  const label=document.getElementById('shell-board-preview-label'),controller=createMessageHeightController(label),layout=createBoardContextLayout(document);
  const contextHost=document.querySelector('[data-board-context-details]');
  window.promptFixture={models:boardPromptSizingModels(),showContext(html){label.hidden=true;label.textContent='';contextHost.innerHTML=html;layout.sync();},overflow(){this.showContext(renderBoardContext({key:'overflow',message:{text:'Board explanation'}},{placement:'board'}));},publish(index){label.hidden=false;const html=renderBoardMessageHtml(this.models[index]);label.innerHTML=html;label.toggleAttribute('data-prompt-unmapped',!isMappedBoardPromptHtml(html));},required(){
   const coordinates=Array.from({length:30},(_,index)=>({row:Math.floor(index/10),col:index%10,chipClass:'board-preview-coordinate-chip-rush-blocker'}));
   this.showContext(renderBoardContext({key:'required',mandatory:true,message:{text:'Restore supply for pieces at '+coordinates.map(p=>`(${p.row}, ${p.col})`).join(', '),coordinates}},{placement:'board'}));
  },destroy(){controller.destroy();layout.destroy();}};
 });
 const records=[];
 for(const font of [16,32])for(const family of ['primary','fallback']){
  const fonts=await page.evaluate(async({font,family})=>{
   document.documentElement.style.fontSize=font+'px';const root=document.getElementById('fixture');
   root.style.removeProperty('--font-family');
   const fallback=getComputedStyle(root).getPropertyValue('--font-family-fallback').trim();
   if(family==='fallback')root.style.setProperty('--font-family',fallback);
   else await document.fonts.load(`${font}px Manrope`);
   await document.fonts.ready;
   return {family:getComputedStyle(document.querySelector('.board-message-slot')).fontFamily,fallback,manropeReady:document.fonts.check(`${font}px Manrope`)};
  },{font,family});
  expect(fonts.fallback).not.toBe('');if(family==='primary'){expect(fonts.family).toContain('Manrope');expect(fonts.manropeReady).toBe(true);}else expect(fonts.family).not.toContain('Manrope');
  const result=await page.evaluate(async()=>{
   const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const box=()=>{const r=document.getElementById('geometry-board').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
   const rows=[];await frame();const baseline=box();
   for(let index=0;index<window.promptFixture.models.length;index++){
    window.promptFixture.publish(index);await frame();
    const slot=document.querySelector('.board-message-slot'),label=document.getElementById('shell-board-preview-label'),actual=box(),slotBox=slot.getBoundingClientRect();
    rows.push({index,baseline,actual,slot:{x:slotBox.x,y:slotBox.y,width:slotBox.width,height:slotBox.height},unmapped:label.hasAttribute('data-prompt-unmapped'),overflow:slot.hasAttribute('data-prompt-overflow'),buttons:[...label.querySelectorAll('button')].map(button=>{const b=button.getBoundingClientRect(),s=slot.getBoundingClientRect();const style=getComputedStyle(button),pseudo=getComputedStyle(button,'::before'),matrix=new DOMMatrixReadOnly(pseudo.transform==='none'?undefined:pseudo.transform);
      const border={left:parseFloat(style.borderLeftWidth)||0,right:parseFloat(style.borderRightWidth)||0,top:parseFloat(style.borderTopWidth)||0,bottom:parseFloat(style.borderBottomWidth)||0};
      const pseudoRect={left:b.left+border.left+(parseFloat(pseudo.left)||0)+matrix.m41,top:b.top+border.top+(parseFloat(pseudo.top)||0)+matrix.m42,width:parseFloat(pseudo.width)||0,height:parseFloat(pseudo.height)||0};
      pseudoRect.right=pseudoRect.left+pseudoRect.width;pseudoRect.bottom=pseudoRect.top+pseudoRect.height;
      const legacyHeight=Math.max(b.height,pseudoRect.height),legacyTop=b.top+b.height/2-legacyHeight/2;
      const owner=(x,y)=>{const hit=document.elementFromPoint(x,y);return {owned:hit===button||button.contains(hit),tag:hit?.tagName??null,className:typeof hit?.className==='string'?hit.className:null};};
      const corners=rect=>[[rect.left+.5,rect.top+.5],[rect.right-.5,rect.top+.5],[rect.left+.5,rect.bottom-.5],[rect.right-.5,rect.bottom-.5]].map(([x,y])=>owner(x,y));
      const centerX=pseudoRect.left+pseudoRect.width/2,centerY=pseudoRect.top+pseudoRect.height/2;
      const minimumRect={left:centerX-22,right:centerX+22,top:centerY-22,bottom:centerY+22};
      // Overlap uses the full observed effective extent, never the smaller
      // minimum target rectangle used to verify the public44x44 contract.
      const effectiveRect={left:Math.min(b.left,pseudoRect.left),right:Math.max(b.right,pseudoRect.right),top:Math.min(b.top,pseudoRect.top),bottom:Math.max(b.bottom,pseudoRect.bottom)};
      return{visualWidth:b.width,visualHeight:b.height,border,pseudo:{left:pseudo.left,right:pseudo.right,top:pseudo.top,width:pseudo.width,height:pseudo.height,transform:pseudo.transform},pseudoRect,effectiveRect,minimumRect,legacyCorners:corners({left:b.left,right:b.right,top:legacyTop,bottom:legacyTop+legacyHeight}),contained:effectiveRect.left>=s.left&&effectiveRect.right<=s.right&&effectiveRect.top>=s.top&&effectiveRect.bottom<=s.bottom,topHit:owner(centerX,minimumRect.top+.5).owned,bottomHit:owner(centerX,minimumRect.bottom-.5).owned,corners:corners(minimumRect).map(point=>point.owned)};})});
   }
   return rows;
  });
  records.push({width,font,family,fonts,rows:result});
  // Persist raw bounds before the oracle can fail, including failed models.
  await info.attach(`Finite grammar raw geometry ${width}-${font}-${family}`,{body:JSON.stringify({width,font,family,fonts,rows:result}),contentType:'application/json'});
  for(const row of result){expect(row.unmapped,`unmapped model ${row.index}`).toBe(false);expect(row.overflow,`overflow model ${row.index}`).toBe(false);expect(row.actual).toEqual(row.baseline);for(const button of row.buttons){expect(button.pseudoRect.width).toBeGreaterThanOrEqual(44);expect(button.pseudoRect.height).toBeGreaterThanOrEqual(44);expect(button.contained).toBe(true);expect(button.topHit).toBe(true);expect(button.bottomHit).toBe(true);expect(button.corners).toEqual([true,true,true,true]);}
   for(let a=0;a<row.buttons.length;a++)for(let b=a+1;b<row.buttons.length;b++){const x=row.buttons[a].effectiveRect,y=row.buttons[b].effectiveRect;expect(Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left))*Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top))).toBe(0);}}
 }

 // A changing natural inner box must update overflow even while the capped
 // scrollport's border box remains the same. No app/status refresh intervenes.
 await page.evaluate(()=>{document.documentElement.style.fontSize='16px';return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 await expect.poll(()=>page.locator('.board-message-slot').evaluate(slot=>slot.getAnimations({subtree:false}).length)).toBe(0);
 const boardBeforeContext=await page.locator('#geometry-board').boundingBox();
 await page.evaluate(()=>{window.promptFixture.overflow();window.beforeOverflowFocus=document.activeElement;window.beforeOverflowScroll=scrollY;});
 const explanation=page.getByRole('region',{name:'Board explanation',exact:true});await expect(explanation).toHaveAttribute('tabindex','-1');
 await expect.poll(async()=>Math.abs((await page.locator('#geometry-board').boundingBox()).y-boardBeforeContext.y)).toBeLessThanOrEqual(1);
 // Compare the same DOMRect height primitive on both observations.
 // The protocol bounding box can derive height from separately rounded edges.
 // This oracle compares the settled scrollport inside the managed guidance slot.
 // Use the existing expect budget. Keep the actual owner identity across both reads.
 const entryOwner=await explanation.evaluateHandle(node=>node.closest('.board-context-detail'));
 let entryPrimary;
 try{
 let entryInvalid;
 await expect.poll(async()=>{
  if(entryInvalid)return entryInvalid;
  const state=await entryOwner.evaluate(owner=>owner?.isConnected&&owner.matches('.board-context-detail[data-board-context="overflow"]')?{settled:owner.getAnimations({subtree:false}).length===0}:{settled:false,reason:'missing-or-replaced-owner'});
  if(state.reason)entryInvalid=state;
  return state;
 },{message:'Original Board context must settle inside the guidance slot'}).toEqual({settled:true});
 const cappedRecord=await explanation.evaluate((node,entryOwner)=>{
  // Preserve the scalar from this single original DOMRect read. Metadata follows it.
  const rect=node.getBoundingClientRect(),height=rect.height;
  const record={height,rect:{x:rect.x,y:rect.y,top:rect.top,right:rect.right,bottom:rect.bottom,left:rect.left,width:rect.width,height},at:performance.now(),incomplete:false};
  try{
   const style=getComputedStyle(node),notice=node.closest('.board-context-detail');
   record.entrySettled=notice===entryOwner&&notice?.isConnected===true&&notice.getAnimations({subtree:false}).length===0;
   record.scroll={x:scrollX,y:scrollY,nodeTop:node.scrollTop,nodeLeft:node.scrollLeft,scrollHeight:node.scrollHeight,scrollWidth:node.scrollWidth,clientHeight:node.clientHeight,clientWidth:node.clientWidth};
   record.viewport={width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visual:visualViewport?{offsetTop:visualViewport.offsetTop,offsetLeft:visualViewport.offsetLeft,pageTop:visualViewport.pageTop,pageLeft:visualViewport.pageLeft,scale:visualViewport.scale}:null};
   record.box=Object.fromEntries(['height','width','minBlockSize','maxBlockSize','boxSizing','paddingTop','paddingBottom','borderTopWidth','borderBottomWidth','overflowX','overflowY','scrollbarGutter','writingMode','position','transform','transformOrigin','translate','rotate','scale','zoom'].map(key=>[key,style[key]]));
   record.font={family:style.fontFamily,size:style.fontSize,lineHeight:style.lineHeight,weight:style.fontWeight,letterSpacing:style.letterSpacing,status:document.fonts.status};
   record.cap={tabindex:node.getAttribute('tabindex'),overflow:notice?.getAttribute('data-context-overflow')??null,contextKey:notice?.getAttribute('data-board-context')??null,inlineStyle:node.getAttribute('style')};
   record.ancestors=[];let current=node;
   while(current&&record.ancestors.length<16){const computed=getComputedStyle(current);record.ancestors.push({tag:current.tagName,id:current.id,className:typeof current.className==='string'?current.className:null,transform:computed.transform,transformOrigin:computed.transformOrigin,translate:computed.translate,rotate:computed.rotate,scale:computed.scale,zoom:computed.zoom,position:computed.position,scrollTop:current.scrollTop,scrollLeft:current.scrollLeft});current=current.parentElement;}
   record.ancestorTruncated=!!current;
   const animations=document.getAnimations();record.animationCount=animations.length;record.animationTruncated=animations.length>8;
   record.animations=animations.slice(0,8).map(animation=>{const target=animation.effect?.target;return{playState:animation.playState,currentTime:typeof animation.currentTime==='number'?animation.currentTime:null,playbackRate:animation.playbackRate,target:target?{tag:target.tagName,id:target.id,className:typeof target.className==='string'?target.className:null}:null,timing:animation.effect?.getComputedTiming()??null};});
   record.incomplete=record.ancestorTruncated||record.animationTruncated;record.finishedAt=performance.now();
  }catch(error){record.incomplete=true;record.error={name:error?.name??null,message:error?.message??null};}
  return record;
 },entryOwner);
 const capped=cappedRecord.height;
 await explanation.locator('.board-context-content').evaluate(content=>content.textContent+=' '+Array(60).fill('Coordinate guidance').join(' '));
 await expect(explanation).toHaveAttribute('tabindex','0');await expect(page.locator('[data-context-overflow="true"] .board-context-scroll-cue')).toBeVisible();
 const changedRecord=await explanation.evaluate((node,entryOwner)=>{
  // Preserve the scalar from this single original DOMRect read. Metadata follows it.
  const rect=node.getBoundingClientRect(),height=rect.height;
  const record={height,rect:{x:rect.x,y:rect.y,top:rect.top,right:rect.right,bottom:rect.bottom,left:rect.left,width:rect.width,height},at:performance.now(),incomplete:false};
  try{
   const style=getComputedStyle(node),notice=node.closest('.board-context-detail');
   record.entrySettled=notice===entryOwner&&notice?.isConnected===true&&notice.getAnimations({subtree:false}).length===0;
   record.scroll={x:scrollX,y:scrollY,nodeTop:node.scrollTop,nodeLeft:node.scrollLeft,scrollHeight:node.scrollHeight,scrollWidth:node.scrollWidth,clientHeight:node.clientHeight,clientWidth:node.clientWidth};
   record.viewport={width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visual:visualViewport?{offsetTop:visualViewport.offsetTop,offsetLeft:visualViewport.offsetLeft,pageTop:visualViewport.pageTop,pageLeft:visualViewport.pageLeft,scale:visualViewport.scale}:null};
   record.box=Object.fromEntries(['height','width','minBlockSize','maxBlockSize','boxSizing','paddingTop','paddingBottom','borderTopWidth','borderBottomWidth','overflowX','overflowY','scrollbarGutter','writingMode','position','transform','transformOrigin','translate','rotate','scale','zoom'].map(key=>[key,style[key]]));
   record.font={family:style.fontFamily,size:style.fontSize,lineHeight:style.lineHeight,weight:style.fontWeight,letterSpacing:style.letterSpacing,status:document.fonts.status};
   record.cap={tabindex:node.getAttribute('tabindex'),overflow:notice?.getAttribute('data-context-overflow')??null,contextKey:notice?.getAttribute('data-board-context')??null,inlineStyle:node.getAttribute('style')};
   record.ancestors=[];let current=node;
   while(current&&record.ancestors.length<16){const computed=getComputedStyle(current);record.ancestors.push({tag:current.tagName,id:current.id,className:typeof current.className==='string'?current.className:null,transform:computed.transform,transformOrigin:computed.transformOrigin,translate:computed.translate,rotate:computed.rotate,scale:computed.scale,zoom:computed.zoom,position:computed.position,scrollTop:current.scrollTop,scrollLeft:current.scrollLeft});current=current.parentElement;}
   record.ancestorTruncated=!!current;
   const animations=document.getAnimations();record.animationCount=animations.length;record.animationTruncated=animations.length>8;
   record.animations=animations.slice(0,8).map(animation=>{const target=animation.effect?.target;return{playState:animation.playState,currentTime:typeof animation.currentTime==='number'?animation.currentTime:null,playbackRate:animation.playbackRate,target:target?{tag:target.tagName,id:target.id,className:typeof target.className==='string'?target.className:null}:null,timing:animation.effect?.getComputedTiming()??null};});
   record.incomplete=record.ancestorTruncated||record.animationTruncated;record.finishedAt=performance.now();
  }catch(error){record.incomplete=true;record.error={name:error?.name??null,message:error?.message??null};}
  return record;
 },entryOwner);
 let observationError;
 try{await info.attach(`Original paired context height observations ${width}px`,{body:JSON.stringify({width,before:cappedRecord,after:changedRecord}),contentType:'application/json'});}catch(error){observationError=error;}
 const geometryTolerance=Math.max(0.5,1/(changedRecord.viewport.dpr||1));
 const heightDelta=Math.abs(changedRecord.height-capped);
 expect(heightDelta,'Context expands when its complete message genuinely needs another line').toBeGreaterThan(geometryTolerance);
 expect(changedRecord.height,'Long context remains inside its bounded three-line scrollport').toBeLessThanOrEqual(parseFloat(changedRecord.box.maxBlockSize)+geometryTolerance);
 // Perturb the real measured element so the relaxed oracle proves that it still
 // rejects a meaningful physical regression, then restore the owned DOM state.
 const displacedHeight=await explanation.evaluate(node=>{
  const value=node.style.getPropertyValue('transform'),priority=node.style.getPropertyPriority('transform');
  try{node.style.setProperty('transform','scaleY(1.05)','important');return node.getBoundingClientRect().height;}
  finally{if(value)node.style.setProperty('transform',value,priority);else node.style.removeProperty('transform');}
 });
 expect(Math.abs(displacedHeight-changedRecord.height),'A greater-than-2px physical displacement is outside the rendering tolerance').toBeGreaterThan(2);
 if(observationError)throw observationError;
 expect(cappedRecord.incomplete||changedRecord.incomplete,'Paired height observation must be complete').toBe(false);
 expect(cappedRecord.entrySettled&&changedRecord.entrySettled,'Same Board context must remain settled at both original reads').toBe(true);
 }catch(error){entryPrimary=error;throw error;}finally{try{await entryOwner.dispose();}catch(error){if(!entryPrimary)throw error;}}
 expect(await page.evaluate(()=>({sameFocus:document.activeElement===window.beforeOverflowFocus,sameScroll:scrollY===window.beforeOverflowScroll}))).toEqual({sameFocus:true,sameScroll:true});
 await page.evaluate(()=>document.documentElement.style.fontSize='32px');await expect(explanation).toHaveAttribute('tabindex','0');await expect(page.locator('[data-context-overflow="true"] .board-context-scroll-cue')).toBeVisible();
 await page.evaluate(()=>window.promptFixture.required());
 const body=page.getByRole('region',{name:'Required piece coordinates',exact:true});await expect(body).toHaveAttribute('tabindex','0');
 await expect(page.getByRole('button',{name:'Dismiss Board context',exact:true})).toHaveCount(0);
 const before=await body.evaluate(el=>({top:el.scrollTop,max:el.scrollHeight-el.clientHeight}));expect(before.max).toBeGreaterThan(0);
 await body.focus();await page.keyboard.press('End');
 await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThan(before.top);
 const last=body.locator('.board-preview-coordinate-chip').last();
 await expect.poll(()=>last.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.board-context-body').getBoundingClientRect();return a.bottom<=b.bottom+1&&a.top>=b.top-1;})).toBe(true);
 await page.screenshot({path:info.outputPath(`required-context-${width}.png`)});
 await info.attach('Finite grammar raw geometry',{body:JSON.stringify(records),contentType:'application/json'});
 await page.evaluate(()=>window.promptFixture.destroy());
});
