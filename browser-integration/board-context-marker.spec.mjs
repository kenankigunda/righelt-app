import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
for(const width of [390,1440])for(const scale of [100,200])test(`Board context marker clears text at ${width}px and ${scale}%`,async({page},info)=>{
 const records=[];
 await page.setViewportSize({width,height:900});
 await page.route('**/context-marker-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="stylesheet" href="/apps/web/styles.css"><link rel="stylesheet" href="/apps/web/shell/shell.css"><link rel="stylesheet" href="/apps/web/shell/refresh.css"><link rel="stylesheet" href="/apps/web/shell/board-ux.css"></head><body><main id="marker-fixture" style="width:calc(100% - 16px);max-width:640px;margin:8px"></main></body></html>'}));
 await page.goto('/context-marker-fixture');
 await page.evaluate(async scale=>{document.documentElement.style.fontSize=scale+'%';await document.fonts.load(`${16*scale/100}px Manrope`);await document.fonts.ready;},scale);
 try{
  for(const kind of ['acknowledged','required']){
   await page.evaluate(async kind=>{
    const {renderBoardContext}=await import('/apps/web/shell/board-context.js');
    const coordinates=Array.from({length:30},(_,index)=>({row:Math.floor(index/10),col:index%10}));
    const message=kind==='acknowledged'?{text:'Your opponent moved a piece from (3, 6) to (2, 6)',coordinates:[{row:3,col:6},{row:2,col:6}]}:{text:'Restore supply for pieces at '+coordinates.map(point=>`(${point.row}, ${point.col})`).join(', '),coordinates};
    document.getElementById('marker-fixture').innerHTML=renderBoardContext({key:kind,gameId:'fixture',mandatory:kind==='required',message,replay:kind==='acknowledged'?{}:null},{replayEnabled:true});
    const notice=document.querySelector('[data-board-context]');await Promise.allSettled(notice.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished));
   },kind);
   const result=await page.locator('[data-board-context]').evaluate(notice=>{
    const box=notice.getBoundingClientRect(),style=getComputedStyle(notice),pseudo=getComputedStyle(notice,'::before'),matrix=new DOMMatrixReadOnly(pseudo.transform==='none'?undefined:pseudo.transform),origin=pseudo.transformOrigin.split(' ').map(parseFloat),w=parseFloat(pseudo.width),h=parseFloat(pseudo.height);
    const base={x:box.left+parseFloat(style.borderLeftWidth)+parseFloat(pseudo.left),y:box.top+parseFloat(style.borderTopWidth)+parseFloat(pseudo.top)};
    const vertices=[[0,0],[w,0],[0,h],[w,h]].map(([x,y])=>{const p=matrix.transformPoint({x:x-origin[0],y:y-origin[1]});return{x:base.x+origin[0]+p.x,y:base.y+origin[1]+p.y};});
    const marker={left:Math.min(...vertices.map(p=>p.x)),right:Math.max(...vertices.map(p=>p.x)),top:Math.min(...vertices.map(p=>p.y)),bottom:Math.max(...vertices.map(p=>p.y))};
    const content=notice.querySelector('.board-context-content'),walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())&&!node.textContent.trim()){}
    if(!node)throw Error('Missing actual context text');
    const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);const text=range.getBoundingClientRect(),font=getComputedStyle(node.parentElement),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=`${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;const ink=ctx.measureText(node.textContent[0]);
    const body=notice.querySelector('.board-context-body'),close=notice.querySelector('.board-context-dismiss'),replay=notice.querySelector('.board-context-replay');
    return {notice:box.toJSON(),marker,pseudo:{left:pseudo.left,top:pseudo.top,width:pseudo.width,height:pseudo.height,transform:pseudo.transform,origin:pseudo.transformOrigin},paddingLeft:style.paddingLeft,text:{rect:text.toJSON(),font:ctx.font,character:node.textContent[0],actualBoundingBoxLeft:ink.actualBoundingBoxLeft,inkLeft:text.left-ink.actualBoundingBoxLeft},body:body.getBoundingClientRect().toJSON(),coordinates:content.querySelectorAll('.board-preview-coordinate-chip').length,dismiss:close?.getBoundingClientRect().toJSON()??null,replay:replay?.getBoundingClientRect().toJSON()??null,fonts:document.fonts.status};
   });
   records.push({kind,...result});
   // Retain failed marker/text bounds before either spacing oracle can stop.
   await info.attach(`Marker and text ${kind}`,{body:JSON.stringify(result),contentType:'application/json'});
   expect(result.fonts).toBe('loaded');expect(result.paddingLeft).toBe('16px');
   expect(result.marker.left).toBeGreaterThanOrEqual(result.notice.left+2);
   expect(result.marker.right+2,'Context marker must clear actual first-glyph ink and layout').toBeLessThanOrEqual(Math.min(result.text.rect.left,result.text.inkLeft));
   if(kind==='acknowledged'){expect(result.dismiss.width).toBeGreaterThanOrEqual(44);expect(result.dismiss.height).toBeGreaterThanOrEqual(44);expect(result.replay.width).toBeGreaterThanOrEqual(44);expect(result.replay.height).toBeGreaterThanOrEqual(44);expect(result.coordinates).toBe(2);}
   else{expect(result.dismiss).toBe(null);expect(result.coordinates).toBe(30);}
   await page.screenshot({path:info.outputPath(`marker-${kind}-${width}-${scale}.png`)});
  }
 }finally{const path=info.outputPath('marker-geometry.json');await writeFile(path,JSON.stringify({width,scale,records},null,2));await info.attach('Marker geometry',{path,contentType:'application/json'});}
});
