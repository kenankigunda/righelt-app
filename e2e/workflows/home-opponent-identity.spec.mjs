import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {test,expect} from '@playwright/test';
import {waitForLegacyIdentity} from '../support/app.mjs';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';

test('fresh Home cards retain configured computer identity through manual control on either side',async({page},info)=>{
 await page.goto('/');await waitForLegacyIdentity(page);
 const games=await page.evaluate(async header=>{
  const bootstrap=await fetch('/api/shell/bootstrap');if(!bootstrap.ok)throw Error(`Bootstrap ${bootstrap.status}`);
  const generation=bootstrap.headers.get(header),identityId=localStorage.getItem('righelt.identity.id.v1');
  const post=async(path,body)=>{
   const response=await fetch(`/api/shell/${path}`,{method:'POST',headers:{'content-type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify({...body,identityId,protocolVersion:2})});
   if(!response.ok)throw Error(`Identity fixture ${path}: ${response.status}`);return (await response.json()).game;
  };
  const result=[];
  for(const side of ['p1','p2']){
   let game=await post('games',{computer:{p1:null,p2:null,[side]:'horus'}});
   game=await post(`games/${game.id}/computer-control`,{action:'acquire',generation:game.computer.generation,deviceId:'home-identity-proof'});
   game=await post(`games/${game.id}/computer-control`,{action:'manual',generation:game.computer.generation,deviceId:'home-identity-proof'});
   if(!game.computer.manual||game.computerTurn!==null||game.moves.length!==0)throw Error('Expected unchanged manually controlled computer game');
   result.push({id:game.id,side});
  }
  return result;
 },STORAGE_GENERATION_HEADER);
 // A fresh page uses the actual Home list projection, not the create response.
 await page.reload();
 for(const width of [390,1440])for(const text of [100,200]){
  await page.setViewportSize({width,height:900});await page.evaluate(text=>document.documentElement.style.fontSize=`${text}%`,text);
  for(const {id,side} of games){
   const card=page.locator(`.mini-board-card-link-surface[data-game-id="${id}"]`),matchup=card.locator('.home-card-matchup');
   await expect(matchup).toHaveText('You vs. Horus');
   await expect(matchup.locator(`.player-tone-${side}`)).toHaveText('Horus');
   await expect(matchup.locator(`.player-tone-${side==='p1'?'p2':'p1'}`)).toHaveText('You');
   await expect(matchup.getByRole('img',{name:'Computer player',exact:true})).toHaveCount(1);
   await expect(matchup.locator('.is-disconnected')).toHaveCount(0);
  }
  // Retain the exact failing layout sample before any screenshot or scroll.
  // Offscreen rendered content can widen the page too. Clipped carousel tracks
  // are explicitly distinguished from exposed overflow, not silently excluded.
  const overflow=await page.evaluate(()=>{
   const root=document.documentElement,viewport={left:0,right:innerWidth,top:0,bottom:innerHeight};
   const documentOverflow=root.scrollWidth-innerWidth,records=[],indices=new Map(),computed=new Map();
   const style=node=>{if(!computed.has(node))computed.set(node,getComputedStyle(node));return computed.get(node);};
   const rect=node=>{const value=node.getBoundingClientRect();return {left:value.left,right:value.right,top:value.top,bottom:value.bottom,width:value.width,height:value.height};};
   const record=node=>{
    if(indices.has(node))return indices.get(node);
    const index=records.length,css=style(node),bounds=rect(node);indices.set(node,index);
    records.push({index,tag:node.tagName,id:node.id,classes:node.getAttribute('class'),testId:node.getAttribute('data-testid'),action:node.getAttribute('data-action'),
     ownText:[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent).join(' ').trim().slice(0,120),rect:bounds,
     clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,scrollLeft:node.scrollLeft,
     inViewport:bounds.bottom>0&&bounds.top<innerHeight&&bounds.right>0&&bounds.left<innerWidth,
     computed:Object.fromEntries(['display','position','width','minWidth','maxWidth','boxSizing','whiteSpace','overflowWrap','wordBreak','overflowX','overflowY','contain','contentVisibility','flexBasis','flexGrow','flexShrink','gridTemplateColumns','columnGap','fontFamily','fontSize','fontWeight','lineHeight','padding','borderWidth','transform','translate','clipPath','visibility'].map(name=>[name,css[name]]))});
    return index;
   };
   const suspects=[];
   for(const node of document.querySelectorAll('*')){
    if(!node.getClientRects().length)continue;
    const css=style(node),bounds=rect(node);
    if(css.display==='none'||css.visibility==='hidden'||(!bounds.width&&!bounds.height))continue;
    if(bounds.left>=-.5&&bounds.right<=innerWidth+.5&&node.scrollWidth<=node.clientWidth+.5)continue;
    const ancestry=[],clips=[];let left=bounds.left,right=bounds.right;
    for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement){
     const index=record(ancestor);ancestry.push(index);const ancestorCss=style(ancestor);
     if(['hidden','clip','auto','scroll'].includes(ancestorCss.overflowX)){
      const box=rect(ancestor),clipLeft=box.left+ancestor.clientLeft,clipRight=clipLeft+ancestor.clientWidth;
      clips.push({index,left:clipLeft,right:clipRight,overflowX:ancestorCss.overflowX});left=Math.max(left,clipLeft);right=Math.min(right,clipRight);
     }
    }
    suspects.push({index:record(node),ancestry,clips,exposedHorizontal:{left,right,empty:right<=left}});
   }
   return {documentOverflow,scrollWidth:root.scrollWidth,viewport,scroll:{x:scrollX,y:scrollY},visualViewport:visualViewport?{width:visualViewport.width,height:visualViewport.height,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop,scale:visualViewport.scale}:null,
    rootFont:style(root).fontSize,fonts:{status:document.fonts.status,faces:[...document.fonts].map(face=>({family:face.family,status:face.status,weight:face.weight,style:face.style}))},suspects,records};
  });
  const diagnosticPath=info.outputPath(`home-overflow-${info.project.name}-${width}-${text}.json`);
  await mkdir(dirname(diagnosticPath),{recursive:true});await writeFile(diagnosticPath,JSON.stringify(overflow,null,2));
  await info.attach(`home-overflow-${width}-${text}`,{path:diagnosticPath,contentType:'application/json'});
  expect(overflow.documentOverflow).toBeLessThanOrEqual(1);
  await page.locator(`.mini-board-card-link-surface[data-game-id="${games[0].id}"]`).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath(`home-manual-${width}-${text}.png`)});
 }
});
