import {qualifyGeckoSharedEdge} from './gecko-edge-composition.mjs';
// PRIVATE per-sample witness. Empirical case domain only, never binary attestation.
const Q=n=>Math.floor(n*(65536/60)+0.5)/65536;
// Fixed inputs registered independently of any live slot/Board expected value.
const fixed=[0,...Array.from({length:15},(_,i)=>i+1),...Array.from({length:15},(_,i)=>-i-1),-15799,-5510,-61,-60,59,60,61,7679,7680,7681,15359,15360,15361];
export const CALIBRATION=Object.freeze(fixed.map((y,i)=>Object.freeze({y,height:60+(i%15),top:Math.fround(Q(y)),extent:Math.fround(Q(y+60+(i%15))-Q(y))})));
export function collectGeckoCaseDomain(main,raw){
 const doc=main.ownerDocument,win=doc.defaultView,slot=main.querySelector('.board-message-slot'),board=main.querySelector('#board'),wrap=board?.parentElement;
 const issues=[],nodes=[];
 const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom};};
 // Original data is retained before any CSS/quads/calibration reads.
 const rawCopy={...raw,slot:{...raw.slot},board:{...raw.board}};
 const relation={sameDocument:Boolean(slot&&board&&slot.ownerDocument===doc&&board.ownerDocument===doc),connected:Boolean(main.isConnected&&slot?.isConnected&&board?.isConnected),slotThenWrap:slot?.nextElementSibling===wrap,boardInWrap:wrap?.classList.contains('board-wrap')===true&&wrap.contains(board)};
 if(!Object.values(relation).every(Boolean))issues.push('relation');
 if(slot&&board){for(const [name,node] of [['slot',slot],['board',board]]){const now=rect(node);if(['x','y','width','height','top','bottom'].some(k=>now[k]!==rawCopy[name][k]))issues.push('raw-node-changed');}}
 const seen=new Set();
 for(const start of [slot,board])for(let node=start,depth=0;node;node=node.parentElement,depth++){
  if(depth>=12){issues.push('ancestor-bound');break;}if(seen.has(node))continue;seen.add(node);
  const css=win.getComputedStyle(node),properties=['display','position','transform','offset-path','translate','rotate','scale','zoom','filter','perspective','writing-mode','column-count','column-width','margin-top','margin-bottom','padding-top','padding-bottom','border-top-width','border-bottom-width','box-sizing','overflow-x','overflow-y'];
  const values=Object.fromEntries(properties.map(k=>[k,css.getPropertyValue(k)]));const fragments=node.getClientRects().length;
  nodes.push({tag:node.localName,slot:node===slot,board:node===board,wrap:node===wrap,fragments,scrollTop:node.scrollTop,scrollLeft:node.scrollLeft,css:values});
  if(fragments!==1||!['none',''].includes(values.transform)||!['none',''].includes(values['offset-path'])||!['none',''].includes(values.translate)||!['none',''].includes(values.rotate)||!['none',''].includes(values.scale)||!['1','normal',''].includes(values.zoom)||!['none',''].includes(values.filter)||!['none',''].includes(values.perspective)||['fixed','sticky','absolute'].includes(values.position)||values['writing-mode']!=='horizontal-tb'||!['auto','1'].includes(values['column-count'])||values['column-width']!=='auto')issues.push('unsupported-layout');
  if(node.scrollTop!==0||node.scrollLeft!==0)issues.push('nested-scroll');
  if(node.getAnimations?.().some(a=>a.pending||a.playState==='running'))issues.push('animation');
  if(node.namespaceURI!=='http://www.w3.org/1999/xhtml')issues.push('non-html');
 }
 // Border-box slot padding is INSIDE the measured slot bottom; it is not a gap.
 const boundaryOwnership={};
 if(slot&&wrap&&board){
  const slotCss=win.getComputedStyle(slot),wrapCss=win.getComputedStyle(wrap),boardCss=win.getComputedStyle(board),mainCss=win.getComputedStyle(main);
  boundaryOwnership.slot={boxSizing:slotCss.boxSizing,paddingTop:slotCss.paddingTop,paddingBottom:slotCss.paddingBottom,marginBottom:slotCss.marginBottom};
  boundaryOwnership.wrap={marginTop:wrapCss.marginTop,borderTopWidth:wrapCss.borderTopWidth,paddingTop:wrapCss.paddingTop};
  boundaryOwnership.board={marginTop:boardCss.marginTop};
  if(slotCss.boxSizing!=='border-box')issues.push('slot-box-contract');
  if(slot.parentElement!==main||wrap.parentElement!==main||wrap.firstElementChild!==board||mainCss.display!=='block'||wrapCss.display!=='block'||!['block','grid'].includes(boardCss.display)||!['block','grid'].includes(slotCss.display))issues.push('unsupported-boundary-chain');
  if([slotCss.marginBottom,wrapCss.marginTop,wrapCss.borderTopWidth,wrapCss.paddingTop,boardCss.marginTop].some(v=>parseFloat(v)!==0))issues.push('interedge-inset');
 }

 if(win.scrollX!==0||win.scrollY!==0||(win.visualViewport&& (win.visualViewport.scale!==1||win.visualViewport.offsetTop!==0||win.visualViewport.offsetLeft!==0)))issues.push('viewport-origin');
 return {schema:1,raw:rawCopy,relation,boundaryOwnership,nodes,viewport:{scrollX:win.scrollX,scrollY:win.scrollY,innerWidth:win.innerWidth,innerHeight:win.innerHeight,visualScale:win.visualViewport?.scale??null,visualOffsetTop:win.visualViewport?.offsetTop??null,visualOffsetLeft:win.visualViewport?.offsetLeft??null},qualified:issues.length===0,incomplete:issues.length>0,issues:[...new Set(issues)]};
}
export function calibrateGeckoCase(main,raw){
 const doc=main.ownerDocument,win=doc.defaultView,root=doc.documentElement;
 const footprint=()=>({width:root.scrollWidth,height:root.scrollHeight,scrollX:win.scrollX,scrollY:win.scrollY,slot:main.querySelector('.board-message-slot').getBoundingClientRect().toJSON(),board:main.querySelector('#board').getBoundingClientRect().toJSON(),active:doc.activeElement});
 const before=footprint(),host=doc.createElement('div'),rows=[],issues=[];let removed=false;
 host.setAttribute('aria-hidden','true');host.inert=true;host.style.cssText='all:initial;position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;contain:strict;visibility:hidden;pointer-events:none;transform:none;zoom:1;';
 try{
  doc.body.append(host);
  for(const input of CALIBRATION){const node=doc.createElement('div');node.style.cssText=`all:initial;position:absolute;left:0;top:${input.y/60}px;width:1px;height:${input.height/60}px;margin:0;padding:0;border:0;transform:none;zoom:1;box-sizing:border-box;`;host.append(node);const r=node.getBoundingClientRect();rows.push({input:{...input},actual:{top:r.top,height:r.height,bottom:r.bottom},match:r.top===input.top&&r.height===input.extent&&r.bottom===input.top+input.extent});node.remove();}
 }catch{issues.push('calibration-error');}finally{try{host.remove();}catch{issues.push('cleanup-error');}removed=!host.isConnected;}
 let after;try{after=footprint();}catch{issues.push('footprint-read');}
 const same=Boolean(after)&&before.width===after.width&&before.height===after.height&&before.scrollX===after.scrollX&&before.scrollY===after.scrollY&&before.active===after.active&&JSON.stringify(before.slot)===JSON.stringify(after.slot)&&JSON.stringify(before.board)===JSON.stringify(after.board);
 if(!same)issues.push('footprint-changed');if(!removed)issues.push('probe-not-removed');if(rows.length!==CALIBRATION.length||rows.some(row=>!row.match))issues.push('forward-pipeline-mismatch');
 // Drop active DOM reference; the record is scalar data only.
 const clean=x=>x?({width:x.width,height:x.height,scrollX:x.scrollX,scrollY:x.scrollY,slot:x.slot,board:x.board}):null;
 return {schema:1,purpose:'fixed independent source-pipeline witness, NOT live expected geometry',originalRaw:raw,before:clean(before),after:clean(after),rows,removed,qualified:issues.length===0,incomplete:issues.length>0,issues};
}

export function qualifyObservedGeckoSample(main,raw,profile){
 // Never cache or reuse this witness across samples, especially transformed negatives.
 const domain=collectGeckoCaseDomain(main,raw);
 if(!domain.qualified)return {qualified:false,incomplete:true,domain,reason:'sample-domain'};
 let calibration;try{calibration=calibrateGeckoCase(main,domain.raw);}catch{return {qualified:false,incomplete:true,domain,reason:'calibration-unavailable'};}
 const sourceBound=profile?.engine==='firefox'&&profile.version==='148.0.2'&&profile.upstreamRevision==='d0f4d17d5aefe7ca5aa97afbcafcdc641cbd9f93'&&profile.officialSourceManifestSha256==='bce7a096c337db1f2f1cf0ea58403b66494b21d11e60bf5fb95ac16ea0943a2b';
 if(!sourceBound||!calibration.qualified)return {qualified:false,incomplete:true,domain,calibration,reason:'source-profile-calibration'};
 const proof=qualifyGeckoSharedEdge({boardTop:raw.board.top,slotTop:raw.slot.top,slotHeight:raw.slot.height,slotBottom:raw.slot.bottom,profile:{...profile,sourceQualified:true}});
 return {...proof,domain,calibration,profileScope:'Empirical current-case domain and fixed input source-pipeline witness only; not global or binary attestation'};
}
